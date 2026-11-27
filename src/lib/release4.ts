import "server-only";
import type { Db } from "./db";

// Release 4: site updates, client purchases, snags and documents. Every
// query runs as the signed-in person, so the database limits rows to what
// they may see (clients only get what is shared with them).

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

// ---------- Site updates ----------
const MEDIA_JSON = (alias: string) => `coalesce((
  select json_agg(json_build_object('id', m.id, 'file', m.storage_path, 'caption', m.caption, 'area', m.area,
                                    'client_visible', m.client_visible, 'mime', m.mime_type, 'name', m.file_name)
                  order by m.sort_order, m.created_at)
    from site_update_media m where m.site_update_id = ${alias}.id and m.deleted_at is null), '[]'::json) as media`;

export type UpdateFilter = { projectId?: string | null; view?: string | null; mine?: boolean };

export async function siteUpdateList(db: Db, f: UpdateFilter = {}) {
  const where = ["u.deleted_at is null"];
  const args: unknown[] = [];
  if (f.projectId) { args.push(f.projectId); where.push(`u.project_id = $${args.length}`); }
  if (f.mine) where.push("u.created_by = auth.uid()");
  switch (f.view) {
    case "review": where.push("u.status = 'pending_review'"); break;
    case "shared": where.push("u.status = 'published' and u.client_visible"); break;
    case "internal": where.push("((u.status = 'published' and not u.client_visible) or u.status = 'archived')"); break;
    case "drafts": where.push("u.status = 'draft'"); break;
  }
  return (await db.query(
    `select u.*, p.name as project_name, p.project_code, s.name as stage_name, a.full_name as author_name, pb.full_name as publisher_name,
            can_manage_project(u.project_id) as can_manage, ${MEDIA_JSON("u")}
       from site_updates u
       join projects p on p.id = u.project_id and p.deleted_at is null
       left join project_stages s on s.id = u.stage_id
       left join profiles a on a.id = u.created_by
       left join profiles pb on pb.id = u.published_by
      where ${where.join(" and ")}
      order by (u.status = 'pending_review') desc, u.site_datetime desc
      limit 200`, args)).rows;
}

export async function siteUpdateDetail(db: Db, id: string) {
  const u = (await db.query(
    `select u.*, p.name as project_name, p.project_code, s.name as stage_name, a.full_name as author_name, pb.full_name as publisher_name,
            can_manage_project(u.project_id) as can_manage, (u.created_by = auth.uid()) as is_author, ${MEDIA_JSON("u")}
       from site_updates u
       join projects p on p.id = u.project_id and p.deleted_at is null
       left join project_stages s on s.id = u.stage_id
       left join profiles a on a.id = u.created_by
       left join profiles pb on pb.id = u.published_by
      where u.id = $1 and u.deleted_at is null`, [id])).rows[0];
  return u ?? null;
}

/** Projects the signed-in team member can post updates on, with their stages. */
export async function updateFormOptions(db: Db) {
  const projects = (await db.query(
    `select p.id, p.name, p.project_code, can_manage_project(p.id) as can_manage from projects p
      where p.deleted_at is null and p.status in ('active', 'on_hold') and is_project_staff(p.id) order by p.name`)).rows;
  const stages = (await db.query(
    `select s.id, s.project_id, s.name from project_stages s join projects p on p.id = s.project_id and p.deleted_at is null
      where s.deleted_at is null and s.status <> 'skipped' order by s.project_id, s.sort_order`)).rows;
  return { projects, stages };
}

/** What the client sees: shared updates with shared photos only (enforced by the database). */
export async function clientUpdates(db: Db, projectId: string) {
  return (await db.query(
    `select u.id, u.title, u.site_datetime, u.area, u.work_category, u.work_completed, u.current_activity, u.next_activity,
            s.name as stage_name, a.full_name as author_name, ${MEDIA_JSON("u")}
       from site_updates u left join project_stages s on s.id = u.stage_id left join profiles a on a.id = u.created_by
      where u.project_id = $1 and u.deleted_at is null and u.status = 'published' and u.client_visible
      order by u.site_datetime desc`, [projectId])).rows;
}

export async function clientPhotos(db: Db, projectId: string) {
  return (await db.query(
    `select m.id, m.storage_path as file, m.caption, coalesce(nullif(m.area, ''), u.area, 'Whole home') as area, u.site_datetime, u.title, u.id as update_id
       from site_update_media m join site_updates u on u.id = m.site_update_id
      where m.project_id = $1 and m.deleted_at is null and m.client_visible and coalesce(m.mime_type, 'image/jpeg') like 'image/%'
        and u.deleted_at is null and u.status = 'published' and u.client_visible
      order by u.site_datetime desc, m.sort_order`, [projectId])).rows;
}

// ---------- Purchases ----------
export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  not_yet_required: "Not yet required", purchase_required: "Purchase required", client_informed: "Client informed",
  purchased: "Purchased", delivery_scheduled: "Delivery scheduled", delivered: "Delivered", installed: "Installed",
  delayed: "Delayed", cancelled: "Cancelled",
};
/** Wording the client sees */
export const PURCHASE_CLIENT_LABEL: Record<string, string> = {
  not_yet_required: "Not needed yet", purchase_required: "Please purchase", client_informed: "Please purchase",
  purchased: "Purchased", delivery_scheduled: "Delivery scheduled", delivered: "Delivered to site", installed: "Installed",
  delayed: "Running late", cancelled: "No longer needed",
};
export const PURCHASE_TONE: Record<string, "gray" | "amber" | "green" | "red" | "blue"> = {
  not_yet_required: "gray", purchase_required: "amber", client_informed: "amber", purchased: "blue", delivery_scheduled: "blue",
  delivered: "green", installed: "green", delayed: "red", cancelled: "gray",
};
export const RESPONSIBILITY_LABEL: Record<string, string> = { client: "Client buys", company: "We buy", shared: "Shared" };
export const PURCHASE_CATEGORIES = ["Appliance", "Lighting", "Fans", "Sanitaryware", "Bathroom accessories", "Curtains & furnishing", "Mattress", "Loose furniture", "Electronics", "Hardware", "Other"];
export const UNIT_LABEL: Record<string, string> = { mm: "mm", cm: "cm", m: "m", in: "in" };

const PURCHASE_COLUMNS = `x.*, p.name as project_name, p.project_code, s.name as stage_name, s.start_date as stage_start,
  can_manage_project(x.project_id) as can_manage,
  case
    when x.status in ('delivered', 'installed', 'cancelled') then null
    when x.required_delivery_date < today_ist() then 'late'
    when x.status = 'delayed' then 'delayed'
    when x.status in ('not_yet_required', 'purchase_required', 'client_informed') and x.required_purchase_date <= today_ist() then 'buy_now'
    when x.status in ('not_yet_required', 'purchase_required', 'client_informed') and x.required_purchase_date <= today_ist() + 7 then 'buy_soon'
    when x.required_delivery_date <= today_ist() + 3 then 'deliver_soon'
    else null end as risk`;

export async function purchaseList(db: Db, f: { projectId?: string | null; view?: string | null } = {}) {
  const where = ["x.deleted_at is null"];
  const args: unknown[] = [];
  if (f.projectId) { args.push(f.projectId); where.push(`x.project_id = $${args.length}`); }
  const rows = (await db.query(
    `select ${PURCHASE_COLUMNS},
            (select count(*) from task_dependencies d join tasks t on t.id = d.task_id and t.deleted_at is null and t.status not in ('completed','cancelled')
              where d.depends_on_purchase_id = x.id)::int as waiting_tasks
       from purchase_requirements x
       join projects p on p.id = x.project_id and p.deleted_at is null
       left join project_stages s on s.id = x.depends_on_stage_id
      where ${where.join(" and ")}
      order by (x.status in ('delivered','installed','cancelled')), coalesce(x.required_delivery_date, x.required_purchase_date) nulls last, x.created_at`, args)).rows;
  if (f.view === "risk") return rows.filter((r) => r.risk);
  if (f.view === "open") return rows.filter((r) => !["delivered", "installed", "cancelled"].includes(r.status));
  return rows;
}

export async function purchaseHistory(db: Db, projectId: string) {
  return (await db.query(
    `select c.*, pr.full_name as by_name, pr.role as by_role from purchase_status_changes c left join profiles pr on pr.id = c.changed_by
      where c.project_id = $1 order by c.created_at`, [projectId])).rows;
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };
function trim(n: number) { return Number(n.toFixed(n < 10 ? 2 : 1)).toLocaleString("en-IN"); }
/** "700 × 1800 × 720 mm (W × H × D) · 27.6 × 70.9 × 28.3 in" */
export function dims(x: { width?: number | null; height?: number | null; depth?: number | null; unit?: string }) {
  const parts = [["W", x.width], ["H", x.height], ["D", x.depth]].filter(([, v]) => v != null) as [string, number][];
  if (!parts.length) return null;
  const unit = x.unit ?? "mm";
  const main = `${parts.map(([, v]) => trim(Number(v))).join(" × ")} ${UNIT_LABEL[unit]} (${parts.map(([k]) => k).join(" × ")})`;
  const otherUnit = unit === "in" ? "mm" : "in";
  const conv = parts.map(([, v]) => trim((Number(v) * UNIT_MM[unit]) / UNIT_MM[otherUnit])).join(" × ");
  return { main, alt: `${conv} ${otherUnit}` };
}

// ---------- Snags ----------
export const SNAG_STATUS_LABEL: Record<string, string> = {
  open: "Open", under_review: "Under review", assigned: "Assigned", in_progress: "In progress",
  awaiting_client_confirmation: "Awaiting client confirmation", resolved: "Resolved", reopened: "Reopened",
};
export const SNAG_CLIENT_LABEL: Record<string, string> = {
  open: "Received", under_review: "Being reviewed", assigned: "Assigned to our team", in_progress: "Being fixed",
  awaiting_client_confirmation: "Fixed · please confirm", resolved: "Resolved", reopened: "Reopened",
};
export const SNAG_TONE: Record<string, "gray" | "amber" | "green" | "red" | "blue"> = {
  open: "red", under_review: "amber", assigned: "blue", in_progress: "blue", awaiting_client_confirmation: "amber", resolved: "green", reopened: "red",
};
export const SNAG_CATEGORY_LABEL: Record<string, string> = {
  design: "Design concern", workmanship: "Workmanship", electrical: "Electrical", plumbing: "Plumbing", carpentry: "Carpentry",
  material: "Material", damage: "Damage", cleaning: "Cleaning", other: "Other",
};
export const SNAG_EVENT_LABEL: Record<string, string> = {
  raised: "Concern raised", under_review: "Being reviewed", assigned: "Assigned", in_progress: "Work started",
  fix_submitted: "Fix submitted for checking", sent_back: "Fix sent back for more work", resolved: "Marked resolved",
  confirmed: "Client confirmed the fix", reopened: "Reopened",
};

export async function snagList(db: Db, f: { projectId?: string | null; view?: string | null; assignedToMe?: boolean } = {}) {
  const where = ["s.deleted_at is null"];
  const args: unknown[] = [];
  if (f.projectId) { args.push(f.projectId); where.push(`s.project_id = $${args.length}`); }
  if (f.assignedToMe) where.push("s.assigned_to = auth.uid()");
  switch (f.view ?? "open") {
    case "open": where.push("s.status not in ('resolved')"); break;
    case "unassigned": where.push("s.assigned_to is null and s.status in ('open','under_review','reopened')"); break;
    case "check": where.push("s.resolution_submitted_at is not null and s.status = 'in_progress'"); break;
    case "client": where.push("s.status = 'awaiting_client_confirmation'"); break;
    case "resolved": where.push("s.status = 'resolved'"); break;
  }
  return (await db.query(
    `select s.*, p.name as project_name, p.project_code, r.full_name as raised_by_name, r.role as raised_by_role, a.full_name as assignee_name,
            (select storage_path from snag_attachments x where x.snag_id = s.id and x.kind = 'report' and coalesce(x.mime_type,'image/') like 'image/%' order by x.created_at limit 1) as thumb,
            (today_ist() - (s.created_at at time zone 'Asia/Kolkata')::date) as age_days
       from snags s
       join projects p on p.id = s.project_id and p.deleted_at is null
       join profiles r on r.id = s.raised_by
       left join profiles a on a.id = s.assigned_to
      where ${where.join(" and ")}
      order by (s.status = 'resolved'), array_position(array['critical','high','medium','low']::priority_level[], coalesce(s.urgency, 'medium')), s.created_at desc
      limit 300`, args)).rows;
}

export async function snagDetail(db: Db, id: string) {
  const s = (await db.query(
    `select s.*, p.name as project_name, p.project_code, r.full_name as raised_by_name, r.role as raised_by_role, a.full_name as assignee_name,
            can_manage_project(s.project_id) as can_manage, (s.assigned_to = auth.uid()) as is_assignee
       from snags s
       join projects p on p.id = s.project_id and p.deleted_at is null
       join profiles r on r.id = s.raised_by
       left join profiles a on a.id = s.assigned_to
      where s.id = $1 and s.deleted_at is null`, [id])).rows[0];
  if (!s) return null;
  const [files, comments, events] = await Promise.all([
    db.query(`select x.*, pr.full_name as by_name from snag_attachments x left join profiles pr on pr.id = x.uploaded_by
               where x.snag_id = $1 and x.deleted_at is null order by x.created_at`, [id]),
    db.query(`select c.*, pr.full_name as author_name, pr.role as author_role from snag_comments c join profiles pr on pr.id = c.author_id
               where c.snag_id = $1 and c.deleted_at is null order by c.created_at`, [id]),
    db.query(`select e.*, pr.full_name as actor_name, pr.role as actor_role from snag_events e left join profiles pr on pr.id = e.actor_id
               where e.snag_id = $1 order by e.created_at`, [id]),
  ]);
  return { snag: s, files: files.rows, comments: comments.rows, events: events.rows };
}

/** Project team members a snag can be assigned to. */
export async function projectTeam(db: Db, projectId: string) {
  return (await db.query(
    `select distinct on (pr.id) pr.id, pr.full_name, m.member_role from project_members m join profiles pr on pr.id = m.profile_id and pr.is_active
      where m.project_id = $1 and m.removed_at is null and m.member_role <> 'client' order by pr.id, m.member_role`, [projectId])).rows
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// ---------- Documents ----------
export const DOC_TYPE_LABEL: Record<string, string> = {
  floor_plan: "Floor plan", site_measurement: "Site measurements", design_presentation: "Design presentation", render_3d: "3D render",
  quotation: "Quotation", work_order: "Work order", electrical_layout: "Electrical layout", plumbing_layout: "Plumbing layout",
  material_spec: "Material specification", other: "Other",
};

/** Latest version of each document, with its earlier versions. */
export async function documentList(db: Db, projectId: string) {
  const rows = (await db.query(
    `select d.*, pr.full_name as uploaded_by_name from project_documents d left join profiles pr on pr.id = d.uploaded_by
      where d.project_id = $1 and d.deleted_at is null order by d.doc_type, d.created_at desc`, [projectId])).rows;
  const replaced = new Set(rows.map((r) => r.supersedes_id).filter(Boolean));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((r) => !replaced.has(r.id)).map((r) => {
    const older: Row[] = [];
    let cur = r.supersedes_id ? byId.get(r.supersedes_id) : null;
    while (cur) { older.push(cur); cur = cur.supersedes_id ? byId.get(cur.supersedes_id) : null; }
    return { ...r, older };
  });
}

/** The client's project id (one active project per client login). */
export async function clientProjectId(db: Db): Promise<string | null> {
  return (await db.query(
    `select p.id from projects p join project_members m on m.project_id = p.id and m.profile_id = auth.uid() and m.member_role = 'client' and m.removed_at is null
      where p.deleted_at is null order by p.created_at desc limit 1`)).rows[0]?.id ?? null;
}
