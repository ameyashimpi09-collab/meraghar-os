"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser, type Db } from "@/lib/db";
import { readUploads, saveFile } from "@/lib/files";
import { isManagement, isStaff } from "@/lib/roles";
import type { FormResult } from "@/components/ActionForm";

// Task actions shared by the management and employee portals. Every change
// runs as the signed-in person; the database decides what they may do.

const id = z.string().uuid();
const optId = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const PRIORITY = z.enum(["critical", "high", "medium", "low"]);
const DELAY = z.enum(["company", "client_approval", "client_purchase", "vendor", "site_builder"]);

async function staff() {
  const me = await requireUser();
  if (!isStaff(me.role)) redirect("/c");
  return me;
}
function refresh() {
  revalidatePath("/", "layout");
}
const fail = (e: unknown): FormResult => ({ error: friendlyDbError(e) });
const denied = () => Object.assign(new Error("You don't have permission to change this task."), { code: "42501" });

/** Lets the database record why a date or assignment moved. */
async function withReason(db: Db, reason: string | null) {
  await db.query("select set_config('app.change_reason', $1, true)", [reason ?? ""]);
}

async function addDependencies(db: Db, taskId: string, form: FormData) {
  const ids = (k: string) => form.getAll(k).map(String).filter((v) => id.safeParse(v).success);
  for (const t of ids("dep_task")) await db.query("insert into task_dependencies (task_id, depends_on_task_id) values ($1,$2) on conflict do nothing", [taskId, t]);
  for (const a of ids("dep_approval")) await db.query("insert into task_dependencies (task_id, depends_on_approval_id) values ($1,$2) on conflict do nothing", [taskId, a]);
  for (const p of ids("dep_purchase")) await db.query("insert into task_dependencies (task_id, depends_on_purchase_id) values ($1,$2) on conflict do nothing", [taskId, p]);
}

// ---------------------------------------------------------------- manager

const TaskSchema = z.object({
  project_id: id,
  title: z.string().trim().min(1, "Give the task a title").max(200),
  description: text(4000),
  stage_id: optId,
  assigned_to: optId,
  reviewer_id: optId,
  start_date: date,
  due_date: date,
  priority: PRIORITY.default("medium"),
  requires_review: z.string().optional(),
});

export async function createTaskAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = TaskSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  if (v.start_date && v.due_date && v.due_date < v.start_date) return { error: "The deadline can't be before the start date." };
  let newId: string;
  try {
    newId = await withUser(me.id, async (db) => {
      const t = (await db.query(
        `insert into tasks (project_id, stage_id, title, description, assigned_to, reviewer_id, created_by, start_date, due_date, priority, requires_review)
         values ($1,$2,$3,$4,$5,$6,auth.uid(),$7,$8,$9,$10) returning id`,
        [v.project_id, v.stage_id, v.title, v.description, v.assigned_to, v.reviewer_id, v.start_date, v.due_date, v.priority, v.requires_review === "on"],
      )).rows[0];
      await addDependencies(db, t.id, form);
      return t.id as string;
    });
  } catch (e) { return fail(e); }
  refresh();
  if (form.get("another") === "1") return { ok: "Task created. Add the next one." };
  redirect(`/m/tasks/${newId}`);
}

export async function updateTaskDetailsAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, title: z.string().trim().min(1, "Give the task a title").max(200), description: text(4000), stage_id: optId, requires_review: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update tasks set title = $2, description = $3, stage_id = $4, requires_review = $5 where id = $1 and deleted_at is null",
        [p.data.id, p.data.title, p.data.description, p.data.stage_id, p.data.requires_review === "on"]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Saved." };
}

/** Reassign, re-prioritise or move dates. A reason is needed when a deadline or person changes. */
export async function replanTaskAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, assigned_to: optId, reviewer_id: optId, start_date: date, due_date: date, priority: PRIORITY, reason: text(500) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  if (v.start_date && v.due_date && v.due_date < v.start_date) return { error: "The deadline can't be before the start date." };
  try {
    await withUser(me.id, async (db) => {
      await withReason(db, v.reason);
      const r = await db.query(
        "update tasks set assigned_to = $2, reviewer_id = $3, start_date = $4, due_date = $5, priority = $6 where id = $1 and deleted_at is null",
        [v.id, v.assigned_to, v.reviewer_id, v.start_date, v.due_date, v.priority]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Plan updated. The assignee has been notified." };
}

export async function addDependencyAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const taskId = id.safeParse(form.get("task_id"));
  if (!taskId.success) return { error: "Invalid request." };
  if (!["dep_task", "dep_approval", "dep_purchase"].some((k) => form.getAll(k).some((v) => id.safeParse(v).success)))
    return { error: "Choose what this task waits for." };
  try {
    await withUser(me.id, (db) => addDependencies(db, taskId.data, form));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Dependency added." };
}

export async function removeDependencyAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("id"));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("delete from task_dependencies where id = $1", [p.data]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Removed." };
}

export async function reviewTaskAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, decision: z.enum(["accept", "return"]), note: text(1000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, (db) => db.query("select task_review($1, $2, $3)", [p.data.id, p.data.decision === "accept", p.data.note]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.decision === "accept" ? "Accepted. The assignee has been told." : "Sent back for rework. The assignee has been told." };
}

export async function cancelTaskAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, reason: z.string().trim().min(3, "Give a reason for cancelling").max(500) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update tasks set status = 'cancelled' where id = $1 and deleted_at is null and status <> 'cancelled' returning id", [p.data.id]);
      if (!r.rowCount) throw denied();
      await db.query("insert into task_comments (task_id, author_id, body) values ($1, auth.uid(), $2)", [p.data.id, `Task cancelled: ${p.data.reason}`]);
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Task cancelled." };
}

// ---------------------------------------------------------------- everyone on the team

const STATUS = z.enum(["not_started", "in_progress", "waiting_client", "waiting_vendor", "completed"]);

export async function setTaskStatusAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await staff();
  const p = z.object({ id, status: STATUS }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a status. To report a blocker use “Flag a blocker”." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update tasks set status = $2 where id = $1 and deleted_at is null", [p.data.id, p.data.status]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Status updated." };
}

/** Plain form action for the quick status dropdown in task lists. */
export async function quickStatusAction(form: FormData) {
  await setTaskStatusAction(undefined, form);
}

/** Mark complete with notes and evidence (photos / documents). */
export async function completeTaskAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await staff();
  const p = z.object({ id, notes: text(2000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  const up = readUploads(form, "evidence");
  if (up.error) return { error: up.error };
  let review = false;
  try {
    await withUser(me.id, async (db) => {
      const t = (await db.query("select id, project_id, requires_review, status from tasks where id = $1 and deleted_at is null", [p.data.id])).rows[0];
      if (!t) throw denied();
      if (t.status === "blocked") throw Object.assign(new Error("Resolve the open blocker before completing this task."), { code: "P0001" });
      review = t.requires_review;
      for (const f of up.files) {
        const s = await saveFile(db, f, { projectId: t.project_id, entityType: "task", entityId: t.id, userId: me.id });
        await db.query(
          `insert into task_attachments (task_id, storage_path, file_name, mime_type, size_bytes, is_completion_evidence, uploaded_by)
           values ($1,$2,$3,$4,$5,true,auth.uid())`, [t.id, s.id, s.name, s.mime, s.size]);
      }
      const r = await db.query("update tasks set status = 'completed', completion_notes = coalesce($2, completion_notes) where id = $1", [t.id, p.data.notes]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: review ? "Marked complete and sent for review." : "Marked complete." };
}

export async function addTaskCommentAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await staff();
  const p = z.object({ task_id: id, body: z.string().trim().min(1, "Write a comment").max(2000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const up = readUploads(form, "files");
  if (up.error) return { error: up.error };
  try {
    await withUser(me.id, async (db) => {
      const t = (await db.query("select id, project_id from tasks where id = $1 and deleted_at is null", [p.data.task_id])).rows[0];
      if (!t) throw denied();
      await db.query("insert into task_comments (task_id, author_id, body) values ($1, auth.uid(), $2)", [t.id, p.data.body]);
      for (const f of up.files) {
        const s = await saveFile(db, f, { projectId: t.project_id, entityType: "task", entityId: t.id, userId: me.id });
        await db.query(
          `insert into task_attachments (task_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
           values ($1,$2,$3,$4,$5,auth.uid())`, [t.id, s.id, s.name, s.mime, s.size]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: up.files.length ? `Comment and ${up.files.length} file${up.files.length > 1 ? "s" : ""} added.` : "Comment added." };
}

export async function uploadTaskFilesAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await staff();
  const p = id.safeParse(form.get("task_id"));
  if (!p.success) return { error: "Invalid request." };
  const up = readUploads(form, "files");
  if (up.error) return { error: up.error };
  if (!up.files.length) return { error: "Choose at least one photo or document." };
  try {
    await withUser(me.id, async (db) => {
      const t = (await db.query("select id, project_id from tasks where id = $1 and deleted_at is null", [p.data])).rows[0];
      if (!t) throw denied();
      for (const f of up.files) {
        const s = await saveFile(db, f, { projectId: t.project_id, entityType: "task", entityId: t.id, userId: me.id });
        await db.query(
          `insert into task_attachments (task_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
           values ($1,$2,$3,$4,$5,auth.uid())`, [t.id, s.id, s.name, s.mime, s.size]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: `${up.files.length} file${up.files.length > 1 ? "s" : ""} uploaded.` };
}

export async function raiseBlockerAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await staff();
  const p = z.object({
    project_id: optId, task_id: optId, stage_id: optId,
    delay_type: DELAY.optional(),
    description: z.string().trim().min(3, "Describe what is blocking the work").max(1000),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!p.data.delay_type) return { error: "Choose the cause of the blocker." };
  if (!p.data.project_id && !p.data.task_id) return { error: "Choose the project." };
  try {
    await withUser(me.id, (db) => db.query("select blocker_raise($1)", [p.data]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: isManagement(me.role) ? "Blocker recorded." : "Blocker flagged. Your project manager has been notified." };
}

export async function resolveBlockerAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await staff();
  const p = z.object({ id, note: text(1000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, (db) => db.query("select blocker_resolve($1, $2)", [p.data.id, p.data.note]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Blocker resolved." };
}
