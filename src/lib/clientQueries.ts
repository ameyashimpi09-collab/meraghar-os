import "server-only";
import type { Db } from "./db";

/** Everything the client home needs. RLS guarantees it's only their project. */
export async function clientHome(db: Db) {
  const project = (await db.query(
    `select p.* from projects p
       join project_members m on m.project_id = p.id and m.profile_id = auth.uid() and m.member_role = 'client' and m.removed_at is null
      where p.deleted_at is null order by p.created_at desc limit 1`,
  )).rows[0];
  if (!project) return null;
  const id = project.id;
  const [stages, approvals, payments, purchases, team, totals] = await Promise.all([
    db.query(`select id, name, status, start_date, planned_end_date, actual_end_date, client_description, is_milestone, sort_order, completion_pct, delay_type
                from project_stages where project_id = $1 and deleted_at is null and status <> 'skipped' order by sort_order`, [id]),
    db.query(`select id, title, area, deadline, status from approvals
               where project_id = $1 and deleted_at is null and status in ('pending','query_raised') order by deadline nulls last`, [id]),
    db.query(`select id, name, amount_paise, outstanding_paise, due_date, effective_status from payment_milestone_balances
               where project_id = $1 and effective_status in ('due','overdue','partially_paid') order by due_date nulls last`, [id]),
    db.query(`select id, item_name, area, required_delivery_date, required_purchase_date, status from purchase_requirements
               where project_id = $1 and deleted_at is null and responsibility <> 'company'
                 and status in ('purchase_required','client_informed','delayed') order by required_purchase_date nulls last`, [id]),
    db.query(`select m.member_role, pr.full_name, pr.phone, pr.email, pr.designation from project_members m
                join profiles pr on pr.id = m.profile_id
               where m.project_id = $1 and m.removed_at is null and m.member_role in ('project_manager','designer','site_supervisor')
               order by array_position(array['project_manager','designer','site_supervisor']::project_member_role[], m.member_role)`, [id]),
    db.query(`select coalesce(sum(amount_paise),0) as total, coalesce(sum(received_paise),0) as paid,
                     coalesce(sum(outstanding_paise),0) as outstanding from payment_milestone_balances where project_id = $1`, [id]),
  ]);
  return {
    project,
    stages: stages.rows,
    approvals: approvals.rows,
    payments: payments.rows,
    purchases: purchases.rows,
    team: team.rows,
    totals: totals.rows[0] as { total: number; paid: number; outstanding: number },
  };
}
