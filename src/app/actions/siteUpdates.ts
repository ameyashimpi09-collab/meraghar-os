"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import { readUploads, saveFile } from "@/lib/files";
import { isManagement } from "@/lib/roles";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optId = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const fail = (e: unknown): FormResult => ({ error: friendlyDbError(e) });
const refresh = () => revalidatePath("/", "layout");
const denied = (msg = "You can't change this update.") => Object.assign(new Error(msg), { code: "42501" });

const Fields = z.object({
  title: z.string().trim().min(3, "Give the update a short headline, e.g. “Kitchen carpentry underway”").max(120),
  site_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the site visit date"),
  site_time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  area: text(80), work_category: text(80), stage_id: optId,
  work_completed: z.string().trim().min(3, "Describe the work completed").max(3000),
  current_activity: text(2000), next_activity: text(2000), blockers: text(2000),
});

async function addPhotos(db: Parameters<Parameters<typeof withUser>[1]>[0], form: FormData, u: { id: string; project_id: string }, userId: string, area: string | null) {
  const up = readUploads(form, "photos");
  if (up.error) throw Object.assign(new Error(up.error), { code: "P0001" });
  const internal = form.get("photos_internal") === "on";
  let order = (await db.query("select coalesce(max(sort_order), 0) as n from site_update_media where site_update_id = $1", [u.id])).rows[0].n as number;
  for (const f of up.files) {
    const saved = await saveFile(db, f, { projectId: u.project_id, entityType: "site_update", entityId: u.id, userId });
    await db.query(
      `insert into site_update_media (site_update_id, project_id, storage_path, media_type, area, client_visible, sort_order, uploaded_by, file_name, mime_type)
       values ($1, $2, $3, $4, $5, $6, $7, auth.uid(), $8, $9)`,
      [u.id, u.project_id, saved.id, f.type.startsWith("image/") ? "image" : "document", area, !internal, ++order, saved.name, saved.mime],
    );
  }
  return up.files.length;
}

/**
 * Create or edit an update. The button pressed decides what happens:
 *  draft    – save, keep working on it
 *  review   – send to the project manager to share with the client
 *  internal – record it for the team only
 *  share    – (project manager) share it with the client now
 */
export async function saveSiteUpdateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  if (me.role === "client") return { error: "Not allowed." };
  const intent = String(form.get("intent") ?? "draft");
  const p = Fields.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const updateId = String(form.get("id") ?? "");
  const projectId = String(form.get("project_id") ?? "");
  if (!updateId && !id.safeParse(projectId).success) return { error: "Choose the project." };
  const when = `${p.data.site_date}T${p.data.site_time || "12:00"}:00+05:30`;
  const keep = intent === "keep" && !!updateId; // save edits, leave who-can-see-it unchanged
  const status = keep ? null : intent === "review" ? "pending_review" : intent === "internal" ? "published" : intent === "share" ? "published" : "draft";
  const clientVisible = keep ? null : intent === "share" || intent === "review";
  let newId = "";
  try {
    newId = await withUser(me.id, async (db) => {
      const vals = [p.data.title, when, p.data.area, p.data.work_category, p.data.stage_id, p.data.work_completed, p.data.current_activity, p.data.next_activity, p.data.blockers];
      let u: { id: string; project_id: string };
      if (updateId) {
        if (!id.safeParse(updateId).success) throw denied();
        const r = await db.query(
          `update site_updates set title = $2, site_datetime = $3, area = $4, work_category = $5, stage_id = $6, work_completed = $7,
                  current_activity = $8, next_activity = $9, blockers = $10, status = coalesce($11::site_update_status, status),
                  client_visible = coalesce($12::boolean, client_visible),
                  review_note = case when $11::text = 'pending_review' then null else review_note end
            where id = $1 and deleted_at is null returning id, project_id`,
          [updateId, ...vals, status, clientVisible]);
        if (!r.rowCount) throw denied();
        u = r.rows[0];
      } else {
        u = (await db.query(
          `insert into site_updates (project_id, title, site_datetime, area, work_category, stage_id, work_completed, current_activity, next_activity, blockers, status, client_visible, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, auth.uid()) returning id, project_id`,
          [projectId, ...vals, status, clientVisible])).rows[0];
      }
      if (p.data.stage_id && !(await db.query("select 1 from project_stages where id = $1 and project_id = $2", [p.data.stage_id, u.project_id])).rowCount) {
        throw Object.assign(new Error("That stage belongs to another project."), { code: "P0001" });
      }
      await addPhotos(db, form, u, me.id, p.data.area);
      if (intent === "review" || intent === "share") {
        const n = (await db.query("select count(*)::int as n from site_update_media where site_update_id = $1 and deleted_at is null and client_visible", [u.id])).rows[0].n;
        if (n === 0) throw Object.assign(new Error("Add at least one photo the client can see before sharing."), { code: "P0001" });
      }
      return u.id;
    });
  } catch (e) { return fail(e); }
  refresh();
  const base = isManagement(me.role) ? "/m" : "/e";
  if (!updateId) redirect(`${base}/updates/${newId}?saved=${intent}`);
  return { ok: intent === "review" ? "Sent to the project manager for review." : intent === "share" ? "Shared with the client. They have been notified." : intent === "internal" ? "Saved as an internal update (the client will not see it)." : keep ? "Changes saved." : "Saved as a draft." };
}

export async function addUpdatePhotosAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  const updateId = String(form.get("id") ?? "");
  if (!id.safeParse(updateId).success) return { error: "Invalid request." };
  let n = 0;
  try {
    n = await withUser(me.id, async (db) => {
      const u = (await db.query("select id, project_id, area from site_updates where id = $1 and deleted_at is null", [updateId])).rows[0];
      if (!u) throw denied();
      return addPhotos(db, form, u, me.id, u.area);
    });
  } catch (e) { return fail(e); }
  if (!n) return { error: "Choose one or more photos first." };
  refresh();
  return { ok: `${n} file${n > 1 ? "s" : ""} added.` };
}

/** Project manager: show/hide one photo to the client, set its caption and room. */
export async function updatePhotoAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  const p = z.object({ media_id: id, caption: text(200), area: text(80), visible: z.enum(["yes", "no"]).optional(), remove: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = p.data.remove
        ? await db.query("update site_update_media set deleted_at = now() where id = $1 and deleted_at is null", [p.data.media_id])
        : await db.query("update site_update_media set caption = $2, area = $3, client_visible = coalesce($4, client_visible) where id = $1 and deleted_at is null",
            [p.data.media_id, p.data.caption, p.data.area, p.data.visible ? p.data.visible === "yes" : null]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.remove ? "Photo removed." : "Saved." };
}

/** Project manager decisions on an update. */
export async function reviewSiteUpdateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, decision: z.enum(["share", "return", "internal", "withdraw", "delete"]), note: text(1000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  if (p.data.decision === "return" && !p.data.note) return { error: "Write a note so the author knows what to change." };
  try {
    await withUser(me.id, async (db) => {
      const u = (await db.query("select id, status, client_visible from site_updates where id = $1 and deleted_at is null and can_manage_project(project_id)", [p.data.id])).rows[0];
      if (!u) throw denied("Only the project manager can do this.");
      if (p.data.decision === "share") {
        const n = (await db.query("select count(*)::int as n from site_update_media where site_update_id = $1 and deleted_at is null and client_visible", [u.id])).rows[0].n;
        if (n === 0) throw Object.assign(new Error("At least one photo must be visible to the client before sharing."), { code: "P0001" });
        await db.query("update site_updates set status = 'published', client_visible = true, review_note = null where id = $1", [u.id]);
      } else if (p.data.decision === "return") {
        await db.query("update site_updates set status = 'draft', client_visible = false, review_note = $2 where id = $1", [u.id, p.data.note]);
      } else if (p.data.decision === "internal") {
        await db.query("update site_updates set status = 'published', client_visible = false where id = $1", [u.id]);
      } else if (p.data.decision === "withdraw") {
        await db.query("update site_updates set status = 'archived', client_visible = false where id = $1", [u.id]);
      } else {
        if (u.status === "published" && u.client_visible) throw Object.assign(new Error("Withdraw it from the client first."), { code: "P0001" });
        await db.query("update site_updates set deleted_at = now() where id = $1", [u.id]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  if (p.data.decision === "delete") redirect("/m/updates");
  return { ok: { share: "Shared with the client. They have been notified.", return: "Sent back to the author with your note.", internal: "Kept as an internal update.", withdraw: "Withdrawn. The client no longer sees it.", delete: "" }[p.data.decision] };
}

/** Author: delete own draft */
export async function deleteDraftUpdateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  const updateId = String(form.get("id") ?? "");
  if (!id.safeParse(updateId).success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update site_updates set deleted_at = now() where id = $1 and status = 'draft' and deleted_at is null and (created_by = auth.uid() or can_manage_project(project_id))", [updateId]);
      if (!r.rowCount) throw denied("Only a draft can be deleted.");
    });
  } catch (e) { return fail(e); }
  refresh();
  redirect(isManagement(me.role) ? "/m/updates" : "/e/updates");
}
