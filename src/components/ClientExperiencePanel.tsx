import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { fmtDate } from "@/lib/format";
import { Section } from "./ui";

/** Release 4 summary on a project page: site updates, purchases, snags, documents. Loads its own data. */
export async function ClientExperiencePanel({ projectId, base }: { projectId: string; base: "/m" | "/e" }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const d = await withUser(user.id, async (db) => (await db.query(
    `select
       (select count(*) from site_updates where project_id = $1 and deleted_at is null and status = 'pending_review')::int as to_review,
       (select max(published_at) from site_updates where project_id = $1 and deleted_at is null and status = 'published' and client_visible) as last_shared,
       (select count(*) from site_updates where project_id = $1 and deleted_at is null)::int as updates,
       (select count(*) from purchase_requirements where project_id = $1 and deleted_at is null and status not in ('delivered','installed','cancelled'))::int as purchases_open,
       (select count(*) from purchase_requirements where project_id = $1 and deleted_at is null and status not in ('delivered','installed','cancelled')
           and (required_delivery_date < today_ist() or status = 'delayed'))::int as purchases_late,
       (select count(*) from snags where project_id = $1 and deleted_at is null and status <> 'resolved')::int as snags_open,
       (select count(*) from project_documents where project_id = $1 and deleted_at is null)::int as docs,
       (select count(*) from project_documents where project_id = $1 and deleted_at is null and client_visible)::int as docs_shared,
       (select site_update_frequency_days from projects where id = $1) as freq,
       coalesce((select json_agg(x) from (select m.storage_path as file from site_update_media m join site_updates u on u.id = m.site_update_id
           where m.project_id = $1 and m.deleted_at is null and u.deleted_at is null and coalesce(m.mime_type, 'image/') like 'image/%'
           order by u.site_datetime desc, m.sort_order limit 4) x), '[]'::json) as photos`, [projectId])).rows[0]).catch(() => null);
  if (!d) return null;
  const daysSince = d.last_shared ? Math.floor((Date.now() - new Date(d.last_shared).getTime()) / 86_400_000) : null;
  const tile = "block rounded-md border border-line px-3 py-2.5 hover:border-ink-3/40";
  return (
    <Section title="Client experience" action={<Link href={`${base}/updates/new?project=${projectId}`} className="btn-brand px-3 py-1 text-xs">+ Site update</Link>}>
      {d.photos.length > 0 && (
        <div className="grid grid-cols-4 gap-1 p-2 pb-0">
          {d.photos.map((p: { file: string }) => <img key={p.file} src={fileUrl(p.file)} alt="" className="aspect-[4/3] w-full rounded object-cover" loading="lazy" />)}
        </div>
      )}
      <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href={`${base}/updates?view=all&project=${projectId}`} className={tile}>
          <div className="text-xs text-ink-3">Site updates</div>
          <div className="text-sm font-medium">{d.updates} posted{d.to_review ? <span className="text-amber-700"> · {d.to_review} to review</span> : null}</div>
          <div className={`text-[11px] ${daysSince != null && daysSince > d.freq ? "text-red-600" : "text-ink-3"}`}>{d.last_shared ? `Client last updated ${fmtDate(new Date(d.last_shared).toISOString().slice(0, 10), { year: false })}` : "Nothing shared with the client yet"}</div>
        </Link>
        <Link href={base === "/m" ? `/m/projects/${projectId}/purchases` : `/e/projects/${projectId}#purchases`} className={tile}>
          <div className="text-xs text-ink-3">Client purchases</div>
          <div className="text-sm font-medium">{d.purchases_open} to arrive</div>
          <div className={`text-[11px] ${d.purchases_late ? "text-red-600" : "text-ink-3"}`}>{d.purchases_late ? `${d.purchases_late} late for site` : "None late"}</div>
        </Link>
        <Link href={`${base}/snags?view=open${base === "/m" ? `&project=${projectId}` : ""}`} className={tile}>
          <div className="text-xs text-ink-3">Snags</div>
          <div className="text-sm font-medium">{d.snags_open} open</div>
          <div className="text-[11px] text-ink-3">Raised by client or team</div>
        </Link>
        <Link href={base === "/m" ? `/m/projects/${projectId}/documents` : `/e/projects/${projectId}#documents`} className={tile}>
          <div className="text-xs text-ink-3">Documents</div>
          <div className="text-sm font-medium">{d.docs} file{d.docs === 1 ? "" : "s"}</div>
          <div className="text-[11px] text-ink-3">{d.docs_shared} shared with client</div>
        </Link>
      </div>
    </Section>
  );
}
