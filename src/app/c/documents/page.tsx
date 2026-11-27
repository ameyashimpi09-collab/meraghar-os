import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl, fmtSize } from "@/lib/files";
import { fmtDate } from "@/lib/format";
import { clientProjectId, documentList, DOC_TYPE_LABEL } from "@/lib/release4";

export const metadata = { title: "Documents" };

export default async function ClientDocuments() {
  const user = await requireUser("client");
  const data = await withUser(user.id, async (db) => {
    const pid = await clientProjectId(db);
    if (!pid) return null;
    const [docs, receipts, approved] = await Promise.all([
      documentList(db, pid),
      db.query(`select t.id, t.receipt_path, t.amount_paise, t.received_on, m.name from payment_transactions t join payment_milestones m on m.id = t.milestone_id
                 where t.project_id = $1 and t.receipt_published and t.voided_at is null and t.receipt_path is not null order by t.received_on desc`, [pid]),
      db.query(`select a.id, a.title, a.area, r.revision_no, r.decided_at from approvals a join approval_revisions r on r.approval_id = a.id and r.revision_no = a.current_revision_no
                 where a.project_id = $1 and a.deleted_at is null and a.status = 'approved' order by r.decided_at desc nulls last`, [pid]),
    ]);
    return { docs, receipts: receipts.rows, approved: approved.rows };
  });
  if (!data) return <p className="py-20 text-center text-stone">Your project is being set up.</p>;
  const { docs, receipts, approved } = data;
  const types = [...new Set(docs.map((d) => d.doc_type as string))];
  return (
    <>
      <h1 className="font-serif text-5xl">Documents</h1>
      <p className="mt-4 max-w-xl text-stone">Drawings, layouts and documents shared with you, always in their latest version. Earlier versions are kept for reference.</p>
      {docs.length === 0 && <p className="mt-16 font-serif text-2xl text-charcoal/70">Documents shared by your project manager will appear here.</p>}
      {types.map((t) => (
        <section key={t} className="mt-14">
          <div className="mb-3 text-[11px] tracking-[0.25em] text-stone uppercase">{DOC_TYPE_LABEL[t]}</div>
          <ul className="divide-y divide-divider border-y border-divider">
            {docs.filter((d) => d.doc_type === t).map((d) => (
              <li key={d.id} id={`d-${d.id}`} className="flex flex-wrap items-baseline justify-between gap-4 py-5">
                <div className="min-w-0">
                  <a href={fileUrl(d.storage_path)} target="_blank" className="font-serif text-2xl hover:underline">{d.title}</a>
                  {d.description && <p className="mt-1 text-sm text-charcoal/80">{d.description}</p>}
                  <div className="mt-1 text-xs text-stone">{d.version > 1 ? `Version ${d.version} · ` : ""}{fmtDate(new Date(d.created_at).toISOString().slice(0, 10))}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ""}
                    {d.older.length > 0 && <> · earlier: {d.older.map((o: { id: string; storage_path: string; version: number }, i: number) => <span key={o.id}>{i ? ", " : ""}<a href={fileUrl(o.storage_path)} target="_blank" className="underline decoration-divider">v{o.version}</a></span>)}</>}
                  </div>
                </div>
                <a href={fileUrl(d.storage_path, true)} className="text-sm underline decoration-divider underline-offset-4 hover:decoration-charcoal">Download</a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {approved.length > 0 && (
        <section className="mt-14">
          <div className="mb-3 text-[11px] tracking-[0.25em] text-stone uppercase">Approved designs</div>
          <ul className="divide-y divide-divider border-y border-divider">
            {approved.map((a) => <li key={a.id} className="flex items-baseline justify-between gap-4 py-4"><a href={`/c/approvals/${a.id}`} className="font-serif text-xl hover:underline">{a.title}</a><span className="text-xs text-stone">{a.area} · revision {a.revision_no}</span></li>)}
          </ul>
        </section>
      )}
      {receipts.length > 0 && (
        <section className="mt-14">
          <div className="mb-3 text-[11px] tracking-[0.25em] text-stone uppercase">Payment receipts</div>
          <ul className="divide-y divide-divider border-y border-divider">
            {receipts.map((r) => <li key={r.id} className="flex items-baseline justify-between gap-4 py-4 text-sm"><span>{r.name} · {fmtDate(r.received_on)}</span><a href={fileUrl(r.receipt_path, true)} className="underline decoration-divider underline-offset-4">Download receipt</a></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
