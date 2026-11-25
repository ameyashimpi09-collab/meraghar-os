import "server-only";
import type { Db } from "./db";

// Release 3: stages, tasks, dependencies and blockers. Every query runs as
// the signed-in person, so the database limits rows to what they may see.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

const TASK_COLUMNS = `
  t.id, t.project_id, t.stage_id, t.title, t.description, t.assigned_to, t.reviewer_id, t.created_by,
  t.start_date, t.due_date, t.priority, t.status, t.blocked_reason, t.delay_type, t.requires_review,
  t.reviewed_at, t.completed_at, t.completion_notes, t.created_at, t.updated_at,
  p.name as project_name, p.project_code, s.name as stage_name,
  a.full_name as assignee_name, rv.full_name as reviewer_name,
  (t.requires_review and t.status = 'completed' and t.reviewed_at is null) as awaiting_review,
  coalesce((select json_agg(json_build_object('kind', w.kind, 'label', w.label, 'ref_id', w.ref_id, 'status', w.ref_status, 'due', w.ref_due)
                            order by w.ref_due nulls last)
              from task_waiting_on w where w.task_id = t.id and not w.met), '[]'::json) as waiting_on,
  (select count(*) from task_comments c where c.task_id = t.id and c.deleted_at is null)::int as comment_count,
  (select count(*) from task_attachments f where f.task_id = t.id and f.deleted_at is null)::int as file_count`;

const TASK_FROM = `
  from tasks t
  join projects p on p.id = t.project_id and p.deleted_at is null
  left join project_stages s on s.id = t.stage_id
  left join profiles a on a.id = t.assigned_to
  left join profiles rv on rv.id = t.reviewer_id`;

export type TaskFilter = {
  projectId?: string | null;
  assignee?: string | null; // profile id, or "none"
  view?: string | null; // open | overdue | today | review | blocked | unassigned | done | all
  q?: string | null;
  mine?: boolean;
};

function taskWhere(f: TaskFilter) {
  const where: string[] = ["t.deleted_at is null"];
  const args: unknown[] = [];
  const arg = (v: unknown) => { args.push(v); return `$${args.length}`; };
  if (f.projectId) where.push(`t.project_id = ${arg(f.projectId)}`);
  if (f.mine) where.push("t.assigned_to = auth.uid()");
  if (f.assignee === "none") where.push("t.assigned_to is null");
  else if (f.assignee) where.push(`t.assigned_to = ${arg(f.assignee)}`);
  if (f.q) { const q = arg(f.q); where.push(`(t.title ilike '%' || ${q} || '%' or p.name ilike '%' || ${q} || '%')`); }
  return { where, args };
}

const OPEN = "t.status not in ('completed', 'cancelled')";
const VIEW_SQL: Record<string, string> = {
  open: OPEN,
  overdue: `${OPEN} and t.due_date < today_ist()`,
  today: `${OPEN} and t.due_date = today_ist()`,
  review: "t.requires_review and t.status = 'completed' and t.reviewed_at is null",
  blocked: `(t.status in ('blocked', 'waiting_client', 'waiting_vendor')
             or (${OPEN} and exists (select 1 from task_waiting_on w where w.task_id = t.id and not w.met)))`,
  unassigned: `${OPEN} and t.assigned_to is null`,
  done: "t.status in ('completed', 'cancelled')",
  all: "true",
};

/** How many tasks fall in each view (for the tab counts). */
export async function taskCounts(db: Db, f: TaskFilter = {}): Promise<Record<string, number>> {
  const { where, args } = taskWhere(f);
  const cols = Object.entries(VIEW_SQL).map(([k, v]) => `count(*) filter (where ${v})::int as ${k}`).join(", ");
  const r = await db.query(`select ${cols} from tasks t join projects p on p.id = t.project_id and p.deleted_at is null where ${where.join(" and ")}`, args);
  return r.rows[0];
}

export async function taskList(db: Db, f: TaskFilter = {}): Promise<Row[]> {
  const { where, args } = taskWhere(f);
  where.push(`(${VIEW_SQL[f.view ?? "open"] ?? OPEN})`);
  const r = await db.query(
    `select ${TASK_COLUMNS} ${TASK_FROM}
      where ${where.join(" and ")}
      order by (t.status in ('completed', 'cancelled')), t.due_date nulls last,
               array_position(array['critical','high','medium','low']::priority_level[], t.priority), t.created_at
      limit 500`,
    args,
  );
  return r.rows;
}

/** Open work per person (only people the reader may see). */
export async function workload(db: Db): Promise<Row[]> {
  const r = await db.query(`
    select pr.id, pr.full_name, pr.role, pr.designation,
      count(t.id) filter (where t.status not in ('completed', 'cancelled'))::int as open,
      count(t.id) filter (where t.status not in ('completed', 'cancelled') and t.due_date < today_ist())::int as overdue,
      count(t.id) filter (where t.status not in ('completed', 'cancelled') and t.due_date between today_ist() and today_ist() + 6)::int as this_week,
      count(t.id) filter (where t.status = 'blocked')::int as blocked,
      count(t.id) filter (where t.requires_review and t.status = 'completed' and t.reviewed_at is null)::int as in_review,
      count(t.id) filter (where t.status = 'completed' and t.completed_at > now() - interval '7 days')::int as done_7d
    from profiles pr
    left join tasks t on t.assigned_to = pr.id and t.deleted_at is null
         and exists (select 1 from projects p where p.id = t.project_id and p.deleted_at is null)
    where pr.deleted_at is null and pr.is_active and pr.role <> 'client'
    group by pr.id
    having count(t.id) > 0 or pr.role not in ('owner', 'admin')
    order by count(t.id) filter (where t.status not in ('completed', 'cancelled') and t.due_date < today_ist()) desc,
             count(t.id) filter (where t.status not in ('completed', 'cancelled')) desc, pr.full_name`);
  return r.rows;
}

export async function taskDetail(db: Db, id: string) {
  const t = (await db.query(
    `select ${TASK_COLUMNS}, cr.full_name as created_by_name, can_manage_project(t.project_id) as can_manage,
            (t.assigned_to = auth.uid()) as is_assignee
       ${TASK_FROM} left join profiles cr on cr.id = t.created_by
      where t.id = $1 and t.deleted_at is null`, [id])).rows[0];
  if (!t) return null;
  const [deps, dependents, comments, files, blockers, changes] = await Promise.all([
    db.query(`select w.*, d.id as dependency_id from task_waiting_on w join task_dependencies d on d.id = w.dependency_id
               where w.task_id = $1 order by w.met, w.ref_due nulls last`, [id]),
    db.query(`select t2.id, t2.title, t2.status, t2.due_date, pr.full_name as assignee_name
                from task_dependencies d join tasks t2 on t2.id = d.task_id and t2.deleted_at is null
                left join profiles pr on pr.id = t2.assigned_to
               where d.depends_on_task_id = $1 order by t2.due_date nulls last`, [id]),
    db.query(`select c.id, c.body, c.created_at, pr.full_name as author, pr.role as author_role
                from task_comments c join profiles pr on pr.id = c.author_id
               where c.task_id = $1 and c.deleted_at is null order by c.created_at`, [id]),
    db.query(`select f.id, f.file_name, f.mime_type, f.size_bytes, f.is_completion_evidence, f.created_at, f.storage_path,
                     pr.full_name as uploaded_by_name
                from task_attachments f left join profiles pr on pr.id = f.uploaded_by
               where f.task_id = $1 and f.deleted_at is null order by f.created_at`, [id]),
    db.query(`select b.*, r.full_name as raised_by_name, x.full_name as resolved_by_name
                from blockers b join profiles r on r.id = b.raised_by left join profiles x on x.id = b.resolved_by
               where b.task_id = $1 order by b.resolved_at is null desc, b.created_at desc`, [id]),
    db.query(`select c.*, pr.full_name as by_name from schedule_changes c left join profiles pr on pr.id = c.changed_by
               where c.entity_type = 'task' and c.entity_id = $1 order by c.created_at desc`, [id]),
  ]);
  return {
    task: t, deps: deps.rows, dependents: dependents.rows, comments: comments.rows, files: files.rows,
    blockers: blockers.rows, changes: changes.rows,
  };
}

/** Choices for a task form on one project. */
export async function taskFormOptions(db: Db, projectId: string, excludeTaskId?: string) {
  const [team, stages, tasks, approvals, purchases, reviewers] = await Promise.all([
    db.query(`select distinct on (pr.id) pr.id, pr.full_name, m.member_role
                from project_members m join profiles pr on pr.id = m.profile_id and pr.is_active and pr.deleted_at is null
               where m.project_id = $1 and m.removed_at is null and m.member_role <> 'client'
               order by pr.id, array_position(array['project_manager','designer','site_supervisor','execution']::project_member_role[], m.member_role)`, [projectId]),
    db.query(`select id, name, start_date, planned_end_date from project_stages where project_id = $1 and deleted_at is null order by sort_order`, [projectId]),
    db.query(`select id, title, status from tasks where project_id = $1 and deleted_at is null and status <> 'cancelled'
                and ($2::uuid is null or id <> $2) order by due_date nulls last, title`, [projectId, excludeTaskId ?? null]),
    db.query(`select id, title, status, deadline from approvals where project_id = $1 and deleted_at is null and status <> 'withdrawn' order by deadline nulls last`, [projectId]),
    db.query(`select id, item_name, status, required_delivery_date from purchase_requirements where project_id = $1 and deleted_at is null order by required_delivery_date nulls last`, [projectId]),
    db.query(`select pr.id, pr.full_name from profiles pr
               where pr.is_active and pr.deleted_at is null and (pr.role in ('owner','admin')
                 or exists (select 1 from project_members m where m.project_id = $1 and m.profile_id = pr.id and m.member_role = 'project_manager' and m.removed_at is null))
               order by pr.full_name`, [projectId]),
  ]);
  return {
    team: team.rows.sort((a, b) => a.full_name.localeCompare(b.full_name)),
    stages: stages.rows, tasks: tasks.rows, approvals: approvals.rows, purchases: purchases.rows, reviewers: reviewers.rows,
  };
}

/** Everything the project schedule page needs. */
export async function projectSchedule(db: Db, projectId: string) {
  const p = (await db.query(
    `select p.id, p.name, p.project_code, p.status, p.expected_start_date, p.target_handover_date, p.actual_handover_date,
            h.health, h.reasons, can_manage_project(p.id) as can_manage
       from projects p left join project_health h on h.project_id = p.id
      where p.id = $1 and p.deleted_at is null`, [projectId])).rows[0];
  if (!p) return null;
  const [stages, deps, tasks, blockers, changes, templates] = await Promise.all([
    db.query(`select s.*,
                (select count(*) from tasks t where t.stage_id = s.id and t.deleted_at is null and t.status <> 'cancelled')::int as task_count,
                (select count(*) from tasks t where t.stage_id = s.id and t.deleted_at is null and t.status = 'completed')::int as tasks_done,
                (select count(*) from task_templates tt where tt.is_active and tt.stage_template_id = coalesce(s.template_id,
                   (select st.id from stage_templates st where st.organisation_id = my_org_id() and lower(st.name) = lower(s.name) limit 1)))::int as template_tasks
                from project_stages s where s.project_id = $1 and s.deleted_at is null order by s.sort_order, s.start_date nulls last`, [projectId]),
    db.query(`select d.id, d.stage_id, d.depends_on_stage_id, d.lag_days from stage_dependencies d
                join project_stages s on s.id = d.stage_id and s.deleted_at is null
                join project_stages s2 on s2.id = d.depends_on_stage_id and s2.deleted_at is null
               where s.project_id = $1`, [projectId]),
    taskList(db, { projectId, view: "all" }),
    db.query(`select b.*, r.full_name as raised_by_name, t.title as task_title, s.name as stage_name,
                     (today_ist() - (b.created_at at time zone 'Asia/Kolkata')::date) as age_days,
                     (can_manage_project(b.project_id) or b.raised_by = auth.uid() or t.assigned_to = auth.uid()) as can_resolve
                from blockers b join profiles r on r.id = b.raised_by
                left join tasks t on t.id = b.task_id left join project_stages s on s.id = b.stage_id
               where b.project_id = $1 and b.resolved_at is null order by b.created_at`, [projectId]),
    db.query(`select c.*, pr.full_name as by_name, coalesce(s.name, t.title) as entity_name
                from schedule_changes c left join profiles pr on pr.id = c.changed_by
                left join project_stages s on c.entity_type = 'stage' and s.id = c.entity_id
                left join tasks t on c.entity_type = 'task' and t.id = c.entity_id
               where c.project_id = $1 order by c.created_at desc limit 20`, [projectId]),
    db.query(`select count(*)::int as n from stage_templates where organisation_id = my_org_id() and is_active`),
  ]);
  return {
    project: p, stages: stages.rows, deps: deps.rows, tasks, blockers: blockers.rows, changes: changes.rows,
    templateStageCount: templates.rows[0].n as number,
  };
}

/** Open blockers the reader can see (all their projects, or one). */
export async function openBlockers(db: Db, f: { projectId?: string; includeResolved?: boolean } = {}) {
  const r = await db.query(
    `select b.*, r.full_name as raised_by_name, x.full_name as resolved_by_name, t.title as task_title, t.assigned_to as task_assignee,
            a.full_name as task_assignee_name, s.name as stage_name, p.name as project_name, p.project_code,
            (today_ist() - (b.created_at at time zone 'Asia/Kolkata')::date) as age_days,
            (can_manage_project(b.project_id) or b.raised_by = auth.uid() or t.assigned_to = auth.uid()) as can_resolve
       from blockers b join projects p on p.id = b.project_id and p.deleted_at is null
       join profiles r on r.id = b.raised_by left join profiles x on x.id = b.resolved_by
       left join tasks t on t.id = b.task_id left join profiles a on a.id = t.assigned_to
       left join project_stages s on s.id = b.stage_id
      where ($1::uuid is null or b.project_id = $1) and ($2 or b.resolved_at is null)
      order by b.resolved_at is not null, b.created_at
      limit 200`,
    [f.projectId ?? null, !!f.includeResolved],
  );
  return r.rows;
}

/** Cross-project view for the Execution Schedule page. */
export async function scheduleOverview(db: Db) {
  const [projects, stages, deps, causes] = await Promise.all([
    db.query(`select p.id, p.name, p.project_code, p.target_handover_date, h.health, h.reasons,
                (select pr.full_name from project_members m join profiles pr on pr.id = m.profile_id
                  where m.project_id = p.id and m.member_role = 'project_manager' and m.removed_at is null order by m.is_primary desc limit 1) as pm_name,
                (select count(*) from blockers b where b.project_id = p.id and b.resolved_at is null)::int as open_blockers,
                (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null and t.status not in ('completed','cancelled') and t.due_date < today_ist())::int as overdue_tasks
                from projects p left join project_health h on h.project_id = p.id
               where p.deleted_at is null and p.status in ('active', 'on_hold')
               order by case h.health when 'red' then 0 when 'amber' then 1 else 2 end, p.target_handover_date nulls last`),
    db.query(`select s.id, s.project_id, s.name, s.status, s.start_date, s.planned_end_date, s.actual_end_date, s.sort_order,
                     s.is_milestone, s.completion_pct, s.delay_type, s.delay_reason
                from project_stages s join projects p on p.id = s.project_id and p.deleted_at is null and p.status in ('active','on_hold')
               where s.deleted_at is null order by s.project_id, s.sort_order`),
    db.query(`select d.stage_id, d.depends_on_stage_id, d.lag_days from stage_dependencies d
                join project_stages s on s.id = d.stage_id and s.deleted_at is null`),
    db.query(`select cause, count(*)::int as n, sum(blockers)::int as blockers, sum(stages)::int as stages, sum(tasks)::int as tasks from (
                select delay_type::text as cause, 1 as blockers, 0 as stages, 0 as tasks from blockers b
                  join projects p on p.id = b.project_id and p.deleted_at is null where b.resolved_at is null
                union all
                select delay_type::text, 0, 1, 0 from project_stages s join projects p on p.id = s.project_id and p.deleted_at is null and p.status in ('active','on_hold')
                 where s.deleted_at is null and s.status = 'delayed' and s.delay_type is not null
                union all
                select case when w.kind = 'approval' then 'client_approval' when w.kind = 'purchase' then 'client_purchase' end, 0, 0, 1
                  from task_waiting_on w join tasks t on t.id = w.task_id and t.deleted_at is null and t.status not in ('completed','cancelled')
                  join projects p on p.id = t.project_id and p.deleted_at is null
                 where not w.met and w.kind in ('approval', 'purchase') and t.due_date <= today_ist() + 7
              ) x group by cause`),
  ]);
  return { projects: projects.rows, stages: stages.rows, deps: deps.rows, causes: causes.rows };
}
