"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser, type Db } from "@/lib/db";
import { readUploads, saveFile } from "@/lib/files";
import { isManagement } from "@/lib/roles";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const fail = (e: unknown): FormResult => ({ error: friendlyDbError(e) });
const refresh = () => revalidatePath("/", "layout");
const CATS = ["design", "workmanship", "electrical", "plumbing", "carpentry", "material", "damage", "cleaning", "other"] as const;

async function attach(db: Db, form: FormData, snagId: string, projectId: string, userId: string, kind: "report" | "resolution") {
  const up = readUploads(form, "photos");
  if (up.error) throw Object.assign(new Error(up.error), { code: "P0001" });
  for (const f of up.files) {
    const saved = await saveFile(db, f, { projectId, entityType: "snag", entityId: snagId, userId });
    await db.query(
      `insert into snag_attachments (snag_id, storage_path, media_type, kind, uploaded_by, file_name, mime_type) values ($1, $2, $3, $4, auth.uid(), $5, $6)`,
      [snagId, saved.id, f.type.startsWith("image/") ? "image" : "document", kind, saved.name, saved.mime]);
  }
  return up.files.length;
}

/** Client (or the team) raises a concern, with photos. */
export async function raiseSnagAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  const p = z.object({
    project_id: id.optional().or(z.literal("")), area: z.string().trim().min(1, "Choose the area of your home").max(80),
    category: z.enum(CATS, { errorMap: () => ({ message: "Choose a category" }) }),
    description: z.string().trim().min(5, "Describe the concern in a few words").max(3000),
    urgency: z.enum(["critical", "high", "medium", "low"]).optional().or(z.literal("")).transform((v) => v || null),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  let newId = "";
  try {
    newId = await withUser(me.id, async (db) => {
      let projectId = p.data.project_id || null;
      if (me.role === "client") {
        projectId = (await db.query(
          `select p.id from projects p join project_members m on m.project_id = p.id and m.profile_id = auth.uid() and m.member_role = 'client' and m.removed_at is null
            where p.deleted_at is null order by p.created_at desc limit 1`)).rows[0]?.id ?? null;
      }
      if (!projectId) throw Object.assign(new Error("Choose the project."), { code: "P0001" });
      const s = (await db.query(
        `insert into snags (project_id, area, category, description, urgency, raised_by) values ($1, $2, $3, $4, $5, auth.uid()) returning id`,
        [projectId, p.data.area, p.data.category, p.data.description, p.data.urgency])).rows[0];
      await attach(db, form, s.id, projectId, me.id, "report");
      return s.id as string;
    });
  } catch (e) { return fail(e); }
  refresh();
  redirect(me.role === "client" ? `/c/snags/${newId}?new=1` : `${isManagement(me.role) ? "/m" : "/e"}/snags/${newId}`);
}

export async function snagCommentAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  const p = z.object({ snag_id: id, body: z.string().trim().min(1, "Write a message").max(2000), internal: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await withUser(me.id, async (db) => {
      const s = (await db.query("select id, project_id from snags where id = $1 and deleted_at is null", [p.data.snag_id])).rows[0];
      if (!s) throw Object.assign(new Error("Not found."), { code: "42501" });
      await db.query("insert into snag_comments (snag_id, author_id, body, is_internal) values ($1, auth.uid(), $2, $3)",
        [s.id, p.data.body, me.role !== "client" && p.data.internal === "on"]);
      await attach(db, form, s.id, s.project_id, me.id, me.role === "client" ? "report" : "report");
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Sent." };
}

/** Workflow steps. Each database function checks who may do it. */
export async function snagStepAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  const p = z.object({
    snag_id: id,
    step: z.enum(["review", "assign", "start", "submit", "accept", "send_back", "confirm", "reopen"]),
    assignee: id.optional().or(z.literal("")), note: text(2000),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  const { snag_id: sid, step, note } = p.data;
  if (step === "assign" && !p.data.assignee) return { error: "Choose who will handle it." };
  try {
    await withUser(me.id, async (db) => {
      if (step === "submit") {
        const s = (await db.query("select project_id from snags where id = $1", [sid])).rows[0];
        if (!s) throw Object.assign(new Error("Not found."), { code: "42501" });
        await attach(db, form, sid, s.project_id, me.id, "resolution");
      }
      if (step === "accept" && me.role !== "client") {
        const s = (await db.query("select project_id from snags where id = $1", [sid])).rows[0];
        if (s) await attach(db, form, sid, s.project_id, me.id, "resolution");
      }
      switch (step) {
        case "review": await db.query("select snag_review($1)", [sid]); break;
        case "assign": await db.query("select snag_assign($1, $2, $3)", [sid, p.data.assignee, note]); break;
        case "start": await db.query("select snag_start($1)", [sid]); break;
        case "submit": await db.query("select snag_submit_resolution($1, $2)", [sid, note]); break;
        case "accept": await db.query("select snag_resolve($1, true, $2)", [sid, note]); break;
        case "send_back": await db.query("select snag_resolve($1, false, $2)", [sid, note]); break;
        case "confirm": await db.query("select snag_client_confirm($1)", [sid]); break;
        case "reopen": await db.query("select snag_client_reopen($1, $2)", [sid, note]); break;
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  const msg: Record<string, string> = {
    review: "Marked as under review.", assign: "Assigned. They have been notified.", start: "Marked as in progress.",
    submit: "Fix submitted. The project manager will check it.", accept: "Resolved. The client has been asked to confirm.",
    send_back: "Sent back with your note.", confirm: "Thank you for confirming.", reopen: "Reopened. Our team has been told.",
  };
  return { ok: msg[step] };
}
