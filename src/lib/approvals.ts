import "server-only";
import type { Db } from "./db";
import type { StoredFile } from "./files";

// Every query runs as the signed-in person, so the database decides what
// they can see (clients never see drafts; employees see no money).

export type Revision = {
  id: string; revision_no: number; status: string; client_description: string | null;
  material_brand: string | null; material_type: string | null; specifications: string | null; colour: string | null;
  finish: string | null; dimensions: string | null; quantity: number | null; quantity_unit: string | null;
  commercial_impact_paise: number | null; files: StoredFile[]; published_at: string | null; published_by_name: string | null;
  decided_at: string | null; created_at: string;
};

export async function approvalList(db: Db, f: { projectId?: string; status?: string; q?: string } = {}) {
  const r = await db.query(
    `select a.id, a.project_id, a.title, a.area, a.category, a.item_name, a.status, a.current_revision_no, a.deadline, a.updated_at,
            p.name as project_name, p.project_code,
            (select max(revision_no) from approval_revisions r where r.approval_id = a.id) as latest_revision_no,
            exists (select 1 from approval_revisions r where r.approval_id = a.id and r.status = 'draft') as has_draft,
            (select max(created_at) from approval_responses x where x.approval_id = a.id) as last_response_at
       from approvals a join projects p on p.id = a.project_id and p.deleted_at is null
      where a.deleted_at is null
        and ($1::uuid is null or a.project_id = $1)
        and ($2::text is null or a.status::text = $2 or ($2 = 'open' and a.status in ('pending','query_raised','changes_requested','draft')))
        and ($3::text is null or a.title ilike '%' || $3 || '%' or a.item_name ilike '%' || $3 || '%' or a.area ilike '%' || $3 || '%' or p.name ilike '%' || $3 || '%')
      order by case a.status when 'query_raised' then 0 when 'changes_requested' then 1 when 'pending' then 2 when 'draft' then 3 else 4 end,
               a.deadline nulls last, a.area, a.item_name`,
    [f.projectId ?? null, f.status || null, f.q || null],
  );
  return r.rows;
}

export async function approvalDetail(db: Db, id: string) {
  const a = (await db.query(
    `select a.*, p.name as project_name, p.project_code, can_manage_project(a.project_id) as can_manage,
            cb.full_name as created_by_name
       from approvals a join projects p on p.id = a.project_id and p.deleted_at is null
       left join profiles cb on cb.id = a.created_by
      where a.id = $1 and a.deleted_at is null`,
    [id],
  )).rows[0];
  if (!a) return null;
  const [revisions, responses, messages] = await Promise.all([
    db.query(
      `select r.*, pb.full_name as published_by_name from approval_revisions r
         left join profiles pb on pb.id = r.published_by
        where r.approval_id = $1 order by r.revision_no desc`, [id]),
    db.query(
      `select x.id, x.revision_id, x.action, x.comment, x.created_at, pr.full_name as by_name,
              (select revision_no from approval_revisions r where r.id = x.revision_id) as revision_no
         from approval_responses x join profiles pr on pr.id = x.responded_by
        where x.approval_id = $1 order by x.created_at`, [id]),
    db.query(
      `select m.id, m.revision_id, m.body, m.created_at, pr.full_name as by_name,
              (select revision_no from approval_revisions r where r.id = m.revision_id) as revision_no
         from approval_messages m join profiles pr on pr.id = m.author_id
        where m.approval_id = $1 order by m.created_at`, [id]),
  ]);
  return {
    approval: a,
    revisions: revisions.rows as Revision[],
    responses: responses.rows,
    messages: messages.rows,
  };
}

/** One merged, time-ordered history: sent, responses, replies. */
export function approvalTimeline(d: NonNullable<Awaited<ReturnType<typeof approvalDetail>>>) {
  type Ev = { at: string; kind: "sent" | "response" | "reply"; who: string | null; revision_no: number; action?: string; text?: string | null };
  const ev: Ev[] = [];
  for (const r of d.revisions) if (r.published_at) ev.push({ at: r.published_at, kind: "sent", who: r.published_by_name, revision_no: r.revision_no });
  for (const x of d.responses) ev.push({ at: x.created_at, kind: "response", who: x.by_name, revision_no: x.revision_no, action: x.action, text: x.comment });
  for (const m of d.messages) ev.push({ at: m.created_at, kind: "reply", who: m.by_name, revision_no: m.revision_no, text: m.body });
  return ev.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export async function internalNotes(db: Db, entityType: string, entityId: string) {
  const r = await db.query(
    `select n.id, n.body, n.visibility, n.created_at, pr.full_name as by_name from internal_notes n
       join profiles pr on pr.id = n.created_by
      where n.entity_type = $1 and n.entity_id = $2 and n.deleted_at is null order by n.created_at desc`,
    [entityType, entityId],
  );
  return r.rows;
}
