import "server-only";
import type { Db } from "./db";

// Balances and statuses are always worked out from recorded payments
// (payment_milestone_balances view), never typed in.

export async function projectPayments(db: Db, projectId: string, opts: { management: boolean }) {
  const [milestones, txns, changes, notes, totals] = await Promise.all([
    db.query(`select * from payment_milestone_balances where project_id = $1 order by sort_order, due_date nulls last, created_at`, [projectId]),
    db.query(
      `select t.*, m.name as milestone_name, rb.full_name as recorded_by_name, vb.full_name as voided_by_name,
              f.file_name as receipt_name
         from payment_transactions t
         join payment_milestones m on m.id = t.milestone_id
         left join profiles rb on rb.id = t.recorded_by
         left join profiles vb on vb.id = t.voided_by
         left join stored_files f on f.id::text = t.receipt_path
        where t.project_id = $1
        order by t.received_on desc, t.created_at desc`, [projectId]),
    opts.management
      ? db.query(
          `select c.*, pr.full_name as by_name from payment_due_date_changes c
             join payment_milestones m on m.id = c.milestone_id and m.project_id = $1
             join profiles pr on pr.id = c.changed_by order by c.created_at desc`, [projectId])
      : Promise.resolve({ rows: [] }),
    opts.management
      ? db.query(
          `select n.*, pr.full_name as by_name from internal_notes n join profiles pr on pr.id = n.created_by
            where n.project_id = $1 and n.entity_type = 'payment_milestone' and n.deleted_at is null order by n.created_at desc`, [projectId])
      : Promise.resolve({ rows: [] }),
    db.query(
      `select coalesce(sum(amount_paise), 0) as total, coalesce(sum(received_paise), 0) as received,
              coalesce(sum(outstanding_paise), 0) as outstanding,
              coalesce(sum(outstanding_paise) filter (where effective_status = 'overdue'), 0) as overdue,
              count(*) filter (where effective_status = 'overdue') as overdue_count
         from payment_milestone_balances where project_id = $1`, [projectId]),
  ]);
  return {
    milestones: milestones.rows,
    transactions: txns.rows,
    changes: changes.rows,
    notes: notes.rows,
    totals: totals.rows[0] as { total: number; received: number; outstanding: number; overdue: number; overdue_count: number },
  };
}

export async function paymentsOverview(db: Db) {
  const [totals, attention, projects, recent] = await Promise.all([
    db.query(
      `select coalesce(sum(b.amount_paise), 0) as total, coalesce(sum(b.received_paise), 0) as received,
              coalesce(sum(b.outstanding_paise), 0) as outstanding,
              coalesce(sum(b.outstanding_paise) filter (where b.effective_status = 'overdue'), 0) as overdue,
              count(*) filter (where b.effective_status = 'overdue') as overdue_count,
              coalesce(sum(b.outstanding_paise) filter (where b.effective_status <> 'on_hold' and b.due_date between today_ist() and today_ist() + 30), 0) as next30
         from payment_milestone_balances b join projects p on p.id = b.project_id and p.deleted_at is null and p.status <> 'cancelled'`),
    db.query(
      `select b.id, b.project_id, b.name, b.due_date, b.amount_paise, b.received_paise, b.outstanding_paise, b.effective_status,
              b.reminders_paused, p.name as project_name, p.project_code
         from payment_milestone_balances b join projects p on p.id = b.project_id and p.deleted_at is null
        where b.effective_status in ('overdue', 'due', 'partially_paid')
           or (b.effective_status = 'upcoming' and b.due_date <= today_ist() + 30)
        order by case b.effective_status when 'overdue' then 0 when 'due' then 1 else 2 end, b.due_date nulls last
        limit 50`),
    db.query(
      `select p.id, p.name, p.project_code,
              coalesce(sum(b.amount_paise), 0) as total, coalesce(sum(b.received_paise), 0) as received,
              coalesce(sum(b.outstanding_paise), 0) as outstanding,
              count(b.id) filter (where b.effective_status = 'overdue') as overdue_count,
              count(b.id) as milestones
         from projects p left join payment_milestone_balances b on b.project_id = p.id
        where p.deleted_at is null and p.status in ('active', 'on_hold', 'completed') and can_manage_project(p.id)
        group by p.id order by count(b.id) filter (where b.effective_status = 'overdue') desc, p.name`),
    db.query(
      `select t.id, t.amount_paise, t.received_on, t.method, t.voided_at, m.name as milestone_name, p.name as project_name, p.id as project_id
         from payment_transactions t join payment_milestones m on m.id = t.milestone_id join projects p on p.id = t.project_id
        where p.deleted_at is null order by t.created_at desc limit 10`),
  ]);
  return { totals: totals.rows[0], attention: attention.rows, projects: projects.rows, recent: recent.rows };
}
