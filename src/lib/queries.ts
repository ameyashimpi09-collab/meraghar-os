import "server-only";
import type { Db } from "./db";

// All queries run as the signed-in person, so the database automatically
// limits results to what that person is allowed to see.

export async function managementOverview(db: Db) {
  const r = await db.query(`
    select
      (select count(*) from projects where status = 'active' and deleted_at is null)                       as active_projects,
      (select count(*) from project_health h join projects p on p.id = h.project_id where p.status = 'active' and h.health = 'green') as on_schedule,
      (select count(*) from project_health h join projects p on p.id = h.project_id where p.status = 'active' and h.health = 'amber') as at_risk,
      (select count(*) from project_health h join projects p on p.id = h.project_id where p.status = 'active' and h.health = 'red')   as delayed,
      (select count(*) from approvals where status = 'pending' and deleted_at is null)                     as pending_approvals,
      (select count(*) from payment_milestone_balances where effective_status = 'overdue')                 as overdue_payments,
      (select coalesce(sum(outstanding_paise), 0) from payment_milestone_balances where effective_status = 'overdue') as overdue_amount,
      (select count(*) from payment_milestone_balances where effective_status in ('due', 'upcoming', 'partially_paid')
                                  and due_date between today_ist() and today_ist() + 30)                   as upcoming_payments,
      (select coalesce(sum(outstanding_paise), 0) from payment_milestone_balances where effective_status in ('due', 'upcoming', 'partially_paid')
                                  and due_date between today_ist() and today_ist() + 30)                   as upcoming_amount,
      (select count(*) from snags where status <> 'resolved' and deleted_at is null)                       as open_snags,
      (select count(*) from tasks where status not in ('completed', 'cancelled') and due_date < today_ist() and deleted_at is null) as overdue_tasks,
      (select count(*) from tasks where status not in ('completed', 'cancelled') and due_date = today_ist() and deleted_at is null) as tasks_today
  `);
  return r.rows[0] as Record<string, number>;
}

export type ActionItem = {
  kind: "task" | "approval" | "payment" | "snag" | "project";
  project_id: string;
  record_id: string | null;
  project_name: string;
  title: string;
  assignee: string | null;
  priority: "critical" | "high" | "medium" | "low";
  due_date: string | null;
  status: string;
  reason: string | null;
};

/** One prioritised list of everything that needs attention. */
export async function priorityActions(db: Db, limit = 25): Promise<ActionItem[]> {
  const r = await db.query(
    `
    with items as (
      -- Tasks overdue, due today, blocked, or critical
      select 'task' as kind, t.project_id, t.id as record_id, t.title, pr.full_name as assignee,
             case when t.status = 'blocked' or (t.due_date < today_ist() and t.priority in ('critical','high')) then 'critical'
                  when t.due_date < today_ist() then 'high' else t.priority::text end as priority,
             t.due_date,
             t.status::text as status,
             coalesce(t.blocked_reason,
               case when t.due_date < today_ist() then (today_ist() - t.due_date) || ' day(s) overdue' end) as reason
      from tasks t left join profiles pr on pr.id = t.assigned_to
      where t.deleted_at is null and t.status not in ('completed', 'cancelled')
        and (t.due_date <= today_ist() or t.status = 'blocked' or t.priority = 'critical')
      union all
      -- Client approvals overdue or due within 3 days
      select 'approval', a.project_id, a.id, 'Client approval: ' || a.title, 'Client',
             case when a.deadline < today_ist() then 'critical' when a.deadline <= today_ist() + 1 then 'high' else 'medium' end,
             a.deadline, 'Awaiting client',
             case when a.deadline < today_ist() then 'Client approval delay · ' || (today_ist() - a.deadline) || ' day(s) past deadline' end
      from approvals a
      where a.deleted_at is null and a.status in ('pending', 'query_raised')
        and (a.deadline is null or a.deadline <= today_ist() + 3)
      union all
      -- Overdue client payments
      select 'payment', b.project_id, b.id, 'Payment overdue: ' || b.name,
             (select pr.full_name from project_members m join profiles pr on pr.id = m.profile_id
               where m.project_id = b.project_id and m.member_role = 'project_manager' and m.removed_at is null limit 1),
             case when b.due_date < today_ist() - 7 then 'critical' else 'high' end,
             b.due_date, 'Overdue', b.outstanding_paise::text
      from payment_milestone_balances b where b.effective_status = 'overdue'
      union all
      -- Open snags not yet resolved
      select 'snag', s.project_id, s.id, 'Snag: ' || left(s.description, 70), coalesce(pr.full_name, 'Unassigned'),
             coalesce(s.urgency::text, 'medium'), null::date, s.status::text,
             case when s.assigned_to is null then 'Needs assignment' end
      from snags s left join profiles pr on pr.id = s.assigned_to
      where s.deleted_at is null and s.status not in ('resolved', 'awaiting_client_confirmation')
      union all
      -- Project set-up gaps and missed handovers
      select 'project', p.id, null::uuid,
             case when p.target_handover_date < today_ist() and p.actual_handover_date is null then 'Handover date missed'
                  when not exists (select 1 from project_members m where m.project_id = p.id and m.member_role = 'project_manager' and m.removed_at is null) then 'Assign a project manager'
                  else 'Add client login' end,
             null,
             case when p.target_handover_date < today_ist() and p.actual_handover_date is null then 'critical' else 'medium' end,
             p.target_handover_date, 'Needs action', null
      from projects p
      where p.deleted_at is null and p.status = 'active' and (
        (p.target_handover_date < today_ist() and p.actual_handover_date is null)
        or not exists (select 1 from project_members m where m.project_id = p.id and m.member_role = 'project_manager' and m.removed_at is null)
        or not exists (select 1 from project_members m where m.project_id = p.id and m.member_role = 'client' and m.removed_at is null))
    )
    select i.*, p.name as project_name from items i join projects p on p.id = i.project_id
    order by array_position(array['critical','high','medium','low'], i.priority), i.due_date nulls last
    limit $1`,
    [limit],
  );
  return r.rows;
}

export async function projectList(db: Db, f: { q?: string; status?: string; health?: string } = {}) {
  const r = await db.query(
    `select p.id, p.project_code, p.name, p.status, p.city, p.building_society, p.property_config,
            p.expected_start_date, p.target_handover_date,
            h.health, h.reasons,
            c.full_name as client_name,
            (select pr.full_name from project_members m join profiles pr on pr.id = m.profile_id
              where m.project_id = p.id and m.member_role = 'project_manager' and m.removed_at is null order by m.is_primary desc limit 1) as pm_name,
            (select count(*) from project_stages s where s.project_id = p.id and s.deleted_at is null and s.status <> 'skipped') as stages_total,
            (select count(*) from project_stages s where s.project_id = p.id and s.deleted_at is null and s.status = 'completed') as stages_done
       from projects p
       left join project_health h on h.project_id = p.id
       left join profiles c on c.id = p.client_id
      where p.deleted_at is null
        and ($1::text is null or p.name ilike '%' || $1 || '%' or p.project_code ilike '%' || $1 || '%' or c.full_name ilike '%' || $1 || '%' or p.building_society ilike '%' || $1 || '%')
        and ($2::text is null or p.status::text = $2)
        and ($3::text is null or h.health = $3)
      order by case h.health when 'red' then 0 when 'amber' then 1 when 'green' then 2 else 3 end, p.created_at desc`,
    [f.q || null, f.status || null, f.health || null],
  );
  return r.rows;
}

export async function projectDetail(db: Db, id: string) {
  const p = await db.query(
    `select p.*, h.health, h.reasons, can_manage_project(p.id) as can_manage
       from projects p left join project_health h on h.project_id = p.id
      where p.id = $1 and p.deleted_at is null`,
    [id],
  );
  if (!p.rows[0]) return null;
  const [members, scope, stages] = await Promise.all([
    db.query(
      `select m.id, m.member_role, m.is_primary, pr.id as profile_id, pr.full_name, pr.email, pr.phone, pr.designation, pr.role,
              pr.secondary_contact_name, pr.secondary_contact_phone, pr.preferred_contact_method
         from project_members m join profiles pr on pr.id = m.profile_id
        where m.project_id = $1 and m.removed_at is null
        order by array_position(array['project_manager','designer','site_supervisor','execution','client']::project_member_role[], m.member_role), m.is_primary desc, pr.full_name`,
      [id],
    ),
    db.query(
      `select s.*, c.estimated_cost_paise from project_scope_items s
         left join project_scope_costs c on c.scope_item_id = s.id
        where s.project_id = $1 and s.deleted_at is null order by s.sort_order`,
      [id],
    ),
    db.query(`select * from project_stages where project_id = $1 and deleted_at is null order by sort_order`, [id]),
  ]);
  return { project: p.rows[0], members: members.rows, scope: scope.rows, stages: stages.rows };
}

export async function orgPeople(db: Db) {
  const r = await db.query(
    `select p.id, p.full_name, p.email, p.phone, p.role, p.designation, p.is_active, p.created_at,
            (select count(*) from project_members m join projects pj on pj.id = m.project_id and pj.deleted_at is null and pj.status = 'active'
              where m.profile_id = p.id and m.removed_at is null) as active_projects,
            (select count(*) from tasks t where t.assigned_to = p.id and t.deleted_at is null and t.status not in ('completed','cancelled')) as open_tasks,
            (select count(*) from tasks t where t.assigned_to = p.id and t.deleted_at is null and t.status not in ('completed','cancelled') and t.due_date < today_ist()) as overdue_tasks
       from profiles p where p.deleted_at is null
      order by array_position(array['owner','admin','project_manager','designer','site_supervisor','execution','client']::app_role[], p.role), p.full_name`,
  );
  return r.rows;
}

export async function myTasks(db: Db) {
  const r = await db.query(
    `select t.id, t.title, t.description, t.status, t.priority, t.due_date, t.blocked_reason, t.completed_at,
            p.id as project_id, p.name as project_name, s.name as stage_name,
            exists (select 1 from task_dependencies d join approvals a on a.id = d.depends_on_approval_id
                     where d.task_id = t.id and a.status <> 'approved') as waiting_on_client
       from tasks t join projects p on p.id = t.project_id
       left join project_stages s on s.id = t.stage_id
      where t.assigned_to = auth.uid() and t.deleted_at is null and p.deleted_at is null
      order by (t.status in ('completed','cancelled')), t.due_date nulls last,
               array_position(array['critical','high','medium','low']::priority_level[], t.priority)`,
  );
  return r.rows;
}

export async function myProjects(db: Db) {
  const r = await db.query(
    `select p.id, p.project_code, p.name, p.status, p.city, p.building_society, p.target_handover_date, h.health,
            string_agg(distinct m.member_role::text, ',') as my_roles,
            (select count(*) from project_stages s where s.project_id = p.id and s.deleted_at is null and s.status <> 'skipped') as stages_total,
            (select count(*) from project_stages s where s.project_id = p.id and s.deleted_at is null and s.status = 'completed') as stages_done,
            (select s.name from project_stages s where s.project_id = p.id and s.deleted_at is null and s.status in ('in_progress','delayed') order by s.sort_order limit 1) as current_stage
       from projects p
       join project_members m on m.project_id = p.id and m.profile_id = auth.uid() and m.removed_at is null
       left join project_health h on h.project_id = p.id
      where p.deleted_at is null
      group by p.id, h.health
      order by p.status, p.target_handover_date nulls last`,
  );
  return r.rows;
}
