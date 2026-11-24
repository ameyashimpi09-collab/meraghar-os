"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import { readUploads, saveFile, type StoredFile } from "@/lib/files";
import { rupeesToPaise } from "@/lib/format";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const req = (max: number, msg: string) => z.string().trim().min(1, msg).max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);

function refresh() {
  revalidatePath("/", "layout");
}

const HeaderSchema = z.object({
  title: req(150, "Give the approval a title"),
  area: req(80, "Choose the room or area"),
  category: req(80, "Choose a category"),
  item_name: req(120, "Name the item"),
  deadline: date,
});

export async function createApprovalAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const parsed = HeaderSchema.extend({ project_id: id }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let newId: string;
  try {
    newId = await withUser(me.id, async (db) => (await db.query("select approval_create($1) as id", [parsed.data])).rows[0].id);
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  redirect(`/m/approvals/${newId}`);
}

export async function updateApprovalHeaderAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const parsed = HeaderSchema.partial({ title: true, area: true, category: true, item_name: true }).extend({ id }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  try {
    const n = await withUser(me.id, async (db) => (await db.query(
      `update approvals set title = coalesce($2, title), area = coalesce($3, area), category = coalesce($4, category),
              item_name = coalesce($5, item_name), deadline = $6
        where id = $1 and deleted_at is null`,
      [v.id, v.title ?? null, v.area ?? null, v.category ?? null, v.item_name ?? null, v.deadline],
    )).rowCount);
    if (!n) return { error: "You don't have permission to change this approval." };
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "Saved." };
}

const RevisionSchema = z.object({
  approval_id: id,
  revision_id: id,
  client_description: text(4000),
  material_brand: text(120),
  material_type: text(120),
  specifications: text(2000),
  colour: text(120),
  finish: text(120),
  dimensions: text(300),
  quantity: z.string().trim().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e9), "Quantity must be a number"),
  quantity_unit: text(30),
  commercial_impact: z.string().optional(),
});

/** Saves the draft revision's content and adds any uploaded design files. */
export async function saveDraftAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const parsed = RevisionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const impact = v.commercial_impact?.trim() ? rupeesToPaise(v.commercial_impact) : null;
  if (impact !== null && Number.isNaN(impact)) return { error: "Commercial impact must be an amount in rupees, e.g. 12500 or -5000." };
  const up = readUploads(form);
  if (up.error) return { error: up.error };
  try {
    await withUser(me.id, async (db) => {
      const rev = (await db.query(
        "select id, project_id, files from approval_revisions where id = $1 and approval_id = $2 and status = 'draft'",
        [v.revision_id, v.approval_id],
      )).rows[0];
      if (!rev) throw Object.assign(new Error("This revision has already been sent and is locked. Start a new revision to make changes."), { code: "P0001" });
      const saved: StoredFile[] = [];
      for (const f of up.files) saved.push(await saveFile(db, f, { projectId: rev.project_id, entityType: "approval_revision", entityId: rev.id, userId: me.id }));
      const r = await db.query(
        `update approval_revisions set client_description = $2, material_brand = $3, material_type = $4, specifications = $5,
                colour = $6, finish = $7, dimensions = $8, quantity = $9, quantity_unit = $10, commercial_impact_paise = $11,
                files = files || $12::jsonb
          where id = $1 and status = 'draft'`,
        [rev.id, v.client_description, v.material_brand, v.material_type, v.specifications, v.colour, v.finish, v.dimensions,
         v.quantity, v.quantity_unit, impact, JSON.stringify(saved)],
      );
      if (!r.rowCount) throw Object.assign(new Error("You don't have permission to edit this approval."), { code: "42501" });
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: up.files.length ? `Saved, with ${up.files.length} file${up.files.length > 1 ? "s" : ""} added.` : "Draft saved." };
}

export async function removeDraftFileAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ revision_id: id, file_id: id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query(
        `update approval_revisions
            set files = coalesce((select jsonb_agg(f) from jsonb_array_elements(files) f where f ->> 'id' <> $2), '[]'::jsonb)
          where id = $1 and status = 'draft'`,
        [p.data.revision_id, p.data.file_id],
      );
      if (!r.rowCount) throw Object.assign(new Error("Files of a sent revision cannot be removed."), { code: "P0001" });
      // The file itself is deleted only if it was uploaded to this draft (older revisions keep theirs)
      await db.query("delete from stored_files where id = $1 and entity_type = 'approval_revision' and entity_id = $2", [p.data.file_id, p.data.revision_id]);
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "File removed." };
}

export async function publishApprovalAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("approval_id"));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, (db) => db.query("select approval_publish($1)", [p.data]));
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "Sent to the client. They have been notified." };
}

export async function newRevisionAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("approval_id"));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, (db) => db.query("select approval_new_revision($1)", [p.data]));
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "New draft revision started. Earlier revisions stay exactly as they were." };
}

export async function replyAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ approval_id: id, body: req(2000, "Write your reply first") }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await withUser(me.id, (db) => db.query("select approval_reply($1, $2)", [p.data.approval_id, p.data.body]));
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "Reply sent to the client." };
}

export async function deleteDraftApprovalAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("approval_id"));
  if (!p.success) return { error: "Invalid request." };
  let projectId: string | undefined;
  try {
    projectId = await withUser(me.id, async (db) => (await db.query(
      "update approvals set deleted_at = now() where id = $1 and current_revision_no = 0 and deleted_at is null returning project_id", [p.data],
    )).rows[0]?.project_id);
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  if (!projectId) return { error: "Only an approval that was never sent can be deleted." };
  refresh();
  redirect(`/m/projects/${projectId}`);
}

/** Internal note on an approval or payment milestone. Never shown to clients. */
export async function addNoteAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({
    project_id: id,
    entity_type: z.enum(["approval", "payment_milestone"]),
    entity_id: id,
    body: req(2000, "Write the note first"),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const visibility = p.data.entity_type === "payment_milestone" ? "management" : "staff";
  try {
    await withUser(me.id, (db) => db.query(
      `insert into internal_notes (project_id, entity_type, entity_id, visibility, body, created_by)
       select $1, $2, $3, $4, $5, auth.uid()
        where exists (select 1 from approvals where id = $3 and project_id = $1 and $2 = 'approval')
           or exists (select 1 from payment_milestones where id = $3 and project_id = $1 and $2 = 'payment_milestone')`,
      [p.data.project_id, p.data.entity_type, p.data.entity_id, visibility, p.data.body],
    ));
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "Note added." };
}
