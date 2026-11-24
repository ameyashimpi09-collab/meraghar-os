"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import { readUploads, saveFile } from "@/lib/files";
import { rupeesToPaise, todayIST } from "@/lib/format";
import { isOrgAdmin } from "@/lib/roles";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

function refresh() {
  revalidatePath("/", "layout");
}
function fail(e: unknown): FormResult {
  return { error: friendlyDbError(e) };
}
const notAllowed = () => Object.assign(new Error("You don't have permission to change this project's payments."), { code: "42501" });

export async function addMilestoneAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ project_id: id, name: z.string().trim().min(1, "Name the milestone").max(120), description: text(500), due_date: date }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const amount = rupeesToPaise(form.get("amount"));
  if (!(amount > 0)) return { error: "Enter the amount in rupees, e.g. 150000." };
  try {
    await withUser(me.id, (db) => db.query(
      `insert into payment_milestones (project_id, name, description, amount_paise, due_date, sort_order, created_by)
       values ($1, $2, $3, $4, $5, coalesce((select max(sort_order) from payment_milestones where project_id = $1 and deleted_at is null), 0) + 1, auth.uid())`,
      [p.data.project_id, p.data.name, p.data.description, amount, p.data.due_date],
    ));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Milestone added." };
}

export async function updateMilestoneAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, name: z.string().trim().min(1, "Name the milestone").max(120), description: text(500), sort_order: z.coerce.number().int().min(0).max(999) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const amount = rupeesToPaise(form.get("amount"));
  if (!(amount > 0)) return { error: "Enter the amount in rupees, e.g. 150000." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query(
        "update payment_milestones set name = $2, description = $3, amount_paise = $4, sort_order = $5 where id = $1 and deleted_at is null",
        [p.data.id, p.data.name, p.data.description, amount, p.data.sort_order],
      );
      if (!r.rowCount) throw notAllowed();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Saved." };
}

export async function changeDueDateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, new_due_date: date, reason: text(500) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a valid date." };
  try {
    await withUser(me.id, (db) => db.query("select payment_change_due_date($1, $2, $3)", [p.data.id, p.data.new_due_date, p.data.reason]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Due date changed. The client has been notified." };
}

export async function recordPaymentAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({
    milestone_id: id,
    received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the money was received"),
    method: text(60), reference: text(200), publish_receipt: z.string().optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const amount = rupeesToPaise(form.get("amount"));
  if (!(amount > 0)) return { error: "Enter the amount received in rupees." };
  if (p.data.received_on > todayIST()) return { error: "The received date cannot be in the future." };
  const up = readUploads(form, "receipt");
  if (up.error) return { error: up.error };
  try {
    await withUser(me.id, async (db) => {
      const m = (await db.query("select project_id from payment_milestones where id = $1 and deleted_at is null", [p.data.milestone_id])).rows[0];
      if (!m) throw notAllowed();
      const t = (await db.query(
        `insert into payment_transactions (milestone_id, project_id, amount_paise, received_on, method, reference, recorded_by)
         values ($1, $2, $3, $4, $5, $6, auth.uid()) returning id`,
        [p.data.milestone_id, m.project_id, amount, p.data.received_on, p.data.method, p.data.reference],
      )).rows[0];
      if (up.files[0]) {
        const f = await saveFile(db, up.files[0], { projectId: m.project_id, entityType: "payment_transaction", entityId: t.id, userId: me.id });
        await db.query("update payment_transactions set receipt_path = $2, receipt_published = $3 where id = $1", [t.id, f.id, p.data.publish_receipt === "on"]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Payment recorded. The client has been notified." };
}

export async function voidPaymentAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, reason: z.string().trim().min(3, "Give a reason for voiding this entry").max(300) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update payment_transactions set voided_at = now(), void_reason = $2 where id = $1 and voided_at is null", [p.data.id, p.data.reason]);
      if (!r.rowCount) throw notAllowed();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Entry voided. It stays in the history, marked as void." };
}

export async function receiptAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, publish: z.enum(["yes", "no"]).optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  const up = readUploads(form, "receipt");
  if (up.error) return { error: up.error };
  try {
    await withUser(me.id, async (db) => {
      const t = (await db.query("select id, project_id, receipt_path from payment_transactions where id = $1 and voided_at is null and can_manage_project(project_id)", [p.data.id])).rows[0];
      if (!t) throw notAllowed();
      let path = t.receipt_path as string | null;
      if (up.files[0]) path = (await saveFile(db, up.files[0], { projectId: t.project_id, entityType: "payment_transaction", entityId: t.id, userId: me.id })).id;
      await db.query("update payment_transactions set receipt_path = $2, receipt_published = $3 where id = $1",
        [t.id, path, p.data.publish ? p.data.publish === "yes" && !!path : false]);
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.publish === "yes" ? "Receipt shared with the client." : up.files[0] ? "Receipt uploaded." : "Receipt hidden from the client." };
}

export async function holdAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, hold: z.enum(["on", "off"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update payment_milestones set status = $2 where id = $1 and deleted_at is null", [p.data.id, p.data.hold === "on" ? "on_hold" : "upcoming"]);
      if (!r.rowCount) throw notAllowed();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.hold === "on" ? "Milestone put on hold. No reminders will be sent." : "Hold removed." };
}

export async function remindersAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, pause: z.enum(["on", "off"]), reason: text(300) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  if (p.data.pause === "on" && !p.data.reason) return { error: "Give a reason for pausing reminders." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query(
        "update payment_milestones set reminders_paused = $2, reminder_pause_reason = $3 where id = $1 and deleted_at is null",
        [p.data.id, p.data.pause === "on", p.data.pause === "on" ? p.data.reason : null],
      );
      if (!r.rowCount) throw notAllowed();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.pause === "on" ? "Reminders paused for this milestone." : "Reminders switched back on." };
}

export async function removeMilestoneAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("id"));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update payment_milestones set deleted_at = now() where id = $1 and deleted_at is null", [p.data]);
      if (!r.rowCount) throw notAllowed();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Milestone removed." };
}

export async function reminderSettingsAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  if (!isOrgAdmin(me.role)) return { error: "Only an owner or admin can change reminder settings." };
  const n = Number(form.get("limit"));
  if (!Number.isInteger(n) || n < 0 || n > 30) return { error: "Choose a number from 0 to 30." };
  try {
    await withUser(me.id, (db) => db.query(
      "update organisations set settings = settings || jsonb_build_object('overdue_reminder_limit', $1::int) where id = my_org_id()", [n]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Saved." };
}

export async function runRemindersAction(): Promise<FormResult> {
  const me = await requireUser("management");
  if (!isOrgAdmin(me.role)) return { error: "Only an owner or admin can run reminders." };
  let n = 0;
  try {
    n = await withUser(me.id, async (db) => (await db.query("select run_reminders() as n")).rows[0].n);
  } catch (e) { return fail(e); }
  refresh();
  return { ok: n ? `${n} reminder${n === 1 ? "" : "s"} sent.` : "Done. No reminders were due today (each one is only ever sent once)." };
}
