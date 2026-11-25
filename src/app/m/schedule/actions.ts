"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser, type Db } from "@/lib/db";
import { daysBetween } from "@/lib/format";
import { downstreamOf, projectSchedule as project } from "@/lib/schedule";
import { isOrgAdmin } from "@/lib/roles";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const optId = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const STATUS = z.enum(["not_started", "in_progress", "completed", "on_hold", "delayed", "skipped"]);
const DELAY = z.enum(["company", "client_approval", "client_purchase", "vendor", "site_builder"]);

function refresh() {
  revalidatePath("/", "layout");
}
const fail = (e: unknown): FormResult => ({ error: friendlyDbError(e) });
const denied = () => Object.assign(new Error("Only this project's manager can change its schedule."), { code: "42501" });

async function withReason(db: Db, reason: string | null) {
  await db.query("select set_config('app.change_reason', $1, true)", [reason ?? ""]);
}

export async function applyTemplateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ project_id: id, start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date work starts"), with_tasks: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  let n = 0;
  try {
    n = await withUser(me.id, async (db) =>
      (await db.query("select project_apply_stage_template($1, $2, $3) as n", [p.data.project_id, p.data.start_date, p.data.with_tasks === "on"])).rows[0].n);
  } catch (e) { return fail(e); }
  refresh();
  return { ok: `${n} stages added. Remove the ones this project doesn't need, and adjust dates.` };
}

export async function addStageAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({
    project_id: id, name: z.string().trim().min(1, "Name the stage").max(120), start_date: date, planned_end_date: date,
    after: optId, is_milestone: z.string().optional(), depends: z.string().optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  if (v.start_date && v.planned_end_date && v.planned_end_date < v.start_date) return { error: "The end date can't be before the start date." };
  try {
    await withUser(me.id, async (db) => {
      if (!(await db.query("select can_manage_project($1) as ok", [v.project_id])).rows[0].ok) throw denied();
      let order = 1;
      if (v.after) {
        const a = (await db.query("select sort_order from project_stages where id = $1 and project_id = $2 and deleted_at is null", [v.after, v.project_id])).rows[0];
        order = (a?.sort_order ?? 0) + 1;
      } else {
        order = (await db.query("select coalesce(max(sort_order), 0) + 1 as n from project_stages where project_id = $1 and deleted_at is null", [v.project_id])).rows[0].n;
      }
      await db.query("update project_stages set sort_order = sort_order + 1 where project_id = $1 and deleted_at is null and sort_order >= $2", [v.project_id, order]);
      const s = (await db.query(
        `insert into project_stages (project_id, name, sort_order, start_date, planned_end_date, is_milestone, created_by,
                                     template_id)
         values ($1,$2,$3,$4,$5,$6,auth.uid(),
                 (select id from stage_templates where organisation_id = my_org_id() and lower(name) = lower($2) limit 1)) returning id`,
        [v.project_id, v.name, order, v.start_date, v.planned_end_date, v.is_milestone === "on"],
      )).rows[0];
      if (v.after && v.depends === "on") {
        await db.query("insert into stage_dependencies (stage_id, depends_on_stage_id) values ($1,$2)", [s.id, v.after]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Stage added." };
}

/**
 * Saves a stage. If its dates move later and "move later stages too" is
 * ticked, every stage that waits for it is pushed by the same number of days.
 */
export async function updateStageAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({
    id, name: z.string().trim().min(1, "Name the stage").max(120), description: text(1000),
    start_date: date, planned_end_date: date, status: STATUS,
    completion_pct: z.coerce.number().int().min(0).max(100),
    assigned_team: text(200), delay_type: DELAY.optional().or(z.literal("")).transform((v) => v || null), delay_reason: text(500),
    client_description: text(1000), client_visible: z.string().optional(), is_milestone: z.string().optional(),
    reason: text(500), shift_downstream: z.string().optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  if (v.start_date && v.planned_end_date && v.planned_end_date < v.start_date) return { error: "The end date can't be before the start date." };
  if (v.status === "delayed" && !v.delay_type) return { error: "Choose the cause of the delay." };
  let shifted = 0;
  try {
    await withUser(me.id, async (db) => {
      const old = (await db.query("select * from project_stages where id = $1 and deleted_at is null", [v.id])).rows[0];
      if (!old) throw denied();
      await withReason(db, v.reason);
      const r = await db.query(
        `update project_stages set name = $2, description = $3, start_date = $4, planned_end_date = $5, status = $6,
                completion_pct = $7, assigned_team = $8, delay_type = $9, delay_reason = $10, client_description = $11,
                client_visible = $12, is_milestone = $13
          where id = $1 and deleted_at is null`,
        [v.id, v.name, v.description, v.start_date, v.planned_end_date, v.status, v.completion_pct, v.assigned_team,
         v.delay_type, v.delay_reason, v.client_description, v.client_visible === "on", v.is_milestone === "on"],
      );
      if (!r.rowCount) throw denied();
      const moved = old.planned_end_date && v.planned_end_date ? daysBetween(old.planned_end_date, v.planned_end_date) : 0;
      if (moved > 0 && v.shift_downstream === "on") {
        const deps = (await db.query(
          `select d.stage_id, d.depends_on_stage_id, d.lag_days from stage_dependencies d
             join project_stages s on s.id = d.stage_id and s.deleted_at is null where s.project_id = $1`, [old.project_id])).rows;
        const ids = downstreamOf(v.id, deps);
        if (ids.length) {
          await withReason(db, `Moved with "${v.name}" (${moved} day${moved > 1 ? "s" : ""} later)${v.reason ? `: ${v.reason}` : ""}`);
          const res = await db.query(
            `update project_stages set start_date = start_date + $2::int, planned_end_date = planned_end_date + $2::int
              where id = any($1::uuid[]) and deleted_at is null and status not in ('completed', 'skipped')`, [ids, moved]);
          shifted = res.rowCount ?? 0;
        }
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: shifted ? `Saved. ${shifted} later stage${shifted > 1 ? "s were" : " was"} moved too.` : "Saved." };
}

/** Moves every stage that is running behind onto its projected dates. */
export async function applyProjectionAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ project_id: id, reason: z.string().trim().min(3, "Give a reason, e.g. carpentry slipped because of laminate delivery").max(500) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  let n = 0;
  try {
    await withUser(me.id, async (db) => {
      if (!(await db.query("select can_manage_project($1) as ok", [p.data.project_id])).rows[0].ok) throw denied();
      const stages = (await db.query("select * from project_stages where project_id = $1 and deleted_at is null", [p.data.project_id])).rows;
      const deps = (await db.query(
        `select d.stage_id, d.depends_on_stage_id, d.lag_days from stage_dependencies d
           join project_stages s on s.id = d.stage_id and s.deleted_at is null where s.project_id = $1`, [p.data.project_id])).rows;
      const today = (await db.query("select today_ist()::text as d")).rows[0].d;
      const proj = project(stages, deps, today);
      await withReason(db, p.data.reason);
      for (const s of stages) {
        const x = proj.get(s.id);
        if (!x || ["completed", "skipped"].includes(s.status) || !x.end || !s.planned_end_date || x.slip <= 0) continue;
        await db.query("update project_stages set start_date = $2, planned_end_date = $3 where id = $1", [s.id, x.start, x.end]);
        n++;
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: n ? `${n} stage${n > 1 ? "s" : ""} moved to the new dates. The client sees the updated timeline.` : "Nothing to move. The schedule is already up to date." };
}

export async function moveStageAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, dir: z.enum(["up", "down"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const s = (await db.query("select id, project_id from project_stages where id = $1 and deleted_at is null and can_manage_project(project_id)", [p.data.id])).rows[0];
      if (!s) throw denied();
      const all = (await db.query("select id from project_stages where project_id = $1 and deleted_at is null order by sort_order, start_date nulls last, created_at", [s.project_id])).rows.map((r) => r.id as string);
      const i = all.indexOf(s.id);
      const j = p.data.dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= all.length) return;
      [all[i], all[j]] = [all[j], all[i]];
      for (const [k, sid] of all.entries()) {
        await db.query("update project_stages set sort_order = $2 where id = $1 and sort_order is distinct from $2", [sid, k + 1]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Order changed." };
}

export async function removeStageAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("id"));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const s = (await db.query("select id, project_id from project_stages where id = $1 and deleted_at is null and can_manage_project(project_id)", [p.data])).rows[0];
      if (!s) throw denied();
      // Whatever waited for this stage now waits for what it waited for
      await db.query(
        `insert into stage_dependencies (stage_id, depends_on_stage_id)
         select a.stage_id, b.depends_on_stage_id from stage_dependencies a join stage_dependencies b on b.stage_id = $1
          where a.depends_on_stage_id = $1 on conflict do nothing`, [s.id]);
      await db.query("delete from stage_dependencies where stage_id = $1 or depends_on_stage_id = $1", [s.id]);
      await db.query("update tasks set stage_id = null where stage_id = $1", [s.id]);
      await db.query("update project_stages set deleted_at = now() where id = $1", [s.id]);
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Stage removed. Its tasks are kept, without a stage." };
}

export async function addStageDependencyAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ stage_id: id, depends_on_stage_id: id, lag_days: z.coerce.number().int().min(-30).max(90).default(0) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose the stage it waits for." };
  try {
    await withUser(me.id, (db) => db.query(
      "insert into stage_dependencies (stage_id, depends_on_stage_id, lag_days) values ($1,$2,$3) on conflict (stage_id, depends_on_stage_id) do update set lag_days = excluded.lag_days",
      [p.data.stage_id, p.data.depends_on_stage_id, p.data.lag_days]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Dependency saved." };
}

export async function removeStageDependencyAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("id"));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("delete from stage_dependencies where id = $1", [p.data]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Removed." };
}

export async function addTemplateTasksAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = id.safeParse(form.get("stage_id"));
  if (!p.success) return { error: "Invalid request." };
  let n = 0;
  try {
    n = await withUser(me.id, async (db) => (await db.query("select stage_add_template_tasks($1) as n", [p.data])).rows[0].n);
  } catch (e) { return fail(e); }
  refresh();
  return { ok: n ? `${n} standard task${n > 1 ? "s" : ""} added and assigned by role.` : "All standard tasks for this stage are already added." };
}

// ---------------------------------------------------------------- settings (owner / admin)

async function admin() {
  const me = await requireUser("management");
  if (!isOrgAdmin(me.role)) throw Object.assign(new Error("Only an owner or admin can change the default stages and tasks."), { code: "42501" });
  return me;
}

export async function saveStageTemplateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const p = z.object({
    id: optId, name: z.string().trim().min(1, "Name the stage").max(120), description: text(500),
    sort_order: z.coerce.number().int().min(0).max(999), default_duration_days: z.coerce.number().int().min(1, "At least 1 day").max(365),
    is_milestone: z.string().optional(), is_active: z.string().optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  try {
    const me = await admin();
    await withUser(me.id, (db) => v.id
      ? db.query(`update stage_templates set name = $2, description = $3, sort_order = $4, default_duration_days = $5, is_milestone = $6, is_active = $7 where id = $1`,
          [v.id, v.name, v.description, v.sort_order, v.default_duration_days, v.is_milestone === "on", v.is_active === "on"])
      : db.query(`insert into stage_templates (organisation_id, name, description, sort_order, default_duration_days, is_milestone) values (my_org_id(), $1, $2, $3, $4, $5)`,
          [v.name, v.description, v.sort_order, v.default_duration_days, v.is_milestone === "on"]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: v.id ? "Saved." : "Stage added." };
}

export async function saveTaskTemplateAction(_: FormResult, form: FormData): Promise<FormResult> {
  const p = z.object({
    id: optId, stage_template_id: id, title: z.string().trim().min(1, "Give the task a title").max(200), description: text(1000),
    default_priority: z.enum(["critical", "high", "medium", "low"]),
    default_assignee_role: z.enum(["project_manager", "designer", "site_supervisor", "execution"]).optional().or(z.literal("")).transform((v) => v || null),
    offset_days: z.coerce.number().int().min(0).max(365), duration_days: z.coerce.number().int().min(1).max(365),
    requires_review: z.string().optional(), is_active: z.string().optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  try {
    const me = await admin();
    await withUser(me.id, (db) => v.id
      ? db.query(`update task_templates set title = $2, description = $3, default_priority = $4, default_assignee_role = $5, offset_days = $6,
                         duration_days = $7, requires_review = $8, is_active = $9, stage_template_id = $10 where id = $1`,
          [v.id, v.title, v.description, v.default_priority, v.default_assignee_role, v.offset_days, v.duration_days, v.requires_review === "on", v.is_active === "on", v.stage_template_id])
      : db.query(`insert into task_templates (organisation_id, stage_template_id, title, description, default_priority, default_assignee_role, offset_days, duration_days, requires_review)
                  values (my_org_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
          [v.stage_template_id, v.title, v.description, v.default_priority, v.default_assignee_role, v.offset_days, v.duration_days, v.requires_review === "on"]));
  } catch (e) { return fail(e); }
  refresh();
  return { ok: v.id ? "Saved." : "Standard task added." };
}
