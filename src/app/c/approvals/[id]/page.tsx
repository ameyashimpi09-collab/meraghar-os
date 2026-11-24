import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { approvalDetail, approvalTimeline, type Revision } from "@/lib/approvals";
import { fileUrl } from "@/lib/files";
import { APPROVAL_STATUS_CLIENT, fmtDate, fmtDateTime, relDay, RESPONSE_LABEL, todayIST } from "@/lib/format";
import { specRows } from "@/components/approvals";
import { Decision } from "./Decision";

export const metadata = { title: "Approval" };

function Presentation({ r }: { r: Revision }) {
  const images = r.files.filter((f) => f.mime.startsWith("image/"));
  const docs = r.files.filter((f) => !f.mime.startsWith("image/"));
  const rows = specRows(r);
  return (
    <div className="space-y-10">
      {images.length > 0 && (
        <div className={`grid gap-3 ${images.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {images.map((f, i) => (
            <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener" className={images.length > 2 && i === 0 ? "sm:col-span-2" : ""}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(f.id)} alt={f.name} className="w-full bg-paper object-cover" />
            </a>
          ))}
        </div>
      )}
      <div className="grid gap-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          {r.client_description && <p className="text-lg leading-relaxed whitespace-pre-line text-charcoal/90">{r.client_description}</p>}
          {docs.length > 0 && (
            <ul className="mt-6 space-y-2">
              {docs.map((f) => (
                <li key={f.id}><a href={fileUrl(f.id)} target="_blank" rel="noopener" className="text-sm underline decoration-divider underline-offset-4 hover:decoration-charcoal">{f.name} (PDF)</a></li>
              ))}
            </ul>
          )}
        </div>
        {rows.length > 0 && (
          <dl className="divide-y divide-divider border-y border-divider">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[130px_1fr] gap-4 py-3 text-sm"><dt className="text-stone">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

export default async function ClientApproval({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("client");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const d = await withUser(user.id, (db) => approvalDetail(db, id));
  if (!d) notFound();
  const { approval: a, revisions } = d;
  const current = revisions.find((r) => r.revision_no === a.current_revision_no);
  if (!current) notFound();
  const earlier = revisions.filter((r) => r.revision_no < a.current_revision_no);
  const history = approvalTimeline(d);
  const today = todayIST();
  const overdue = a.status === "pending" && a.deadline && a.deadline < today;

  return (
    <>
      <Link href="/c/approvals" className="text-sm text-stone hover:text-charcoal">← All approvals</Link>
      <header className="mt-6 border-b border-divider pb-8">
        <p className="text-[11px] tracking-[0.3em] text-stone uppercase">{a.area} · {a.category}</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">{a.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className={a.status === "approved" ? "text-sage" : a.status === "pending" ? "text-amber" : "text-stone"}>{APPROVAL_STATUS_CLIENT[a.status] ?? a.status}</span>
          <span className="text-stone">Revision {current.revision_no}</span>
          {a.status === "pending" && a.deadline && (
            <span className={overdue ? "text-alert" : "text-stone"}>Please decide by {fmtDate(a.deadline)} · {relDay(a.deadline)}</span>
          )}
        </div>
      </header>

      <section className="pt-10"><Presentation r={current} /></section>

      <section className="mt-14 max-w-2xl">
        {a.status === "pending" ? (
          <>
            <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">Your decision</div>
            <Decision approvalId={a.id} revisionId={current.id} revisionNo={current.revision_no} title={a.title} />
          </>
        ) : a.status === "approved" ? (
          <p className="border-l-2 border-sage pl-4 text-charcoal/80">You approved revision {current.revision_no}{current.decided_at ? ` on ${fmtDateTime(current.decided_at)}` : ""}. Thank you.</p>
        ) : (
          <p className="border-l-2 border-amber pl-4 text-charcoal/80">
            {a.status === "query_raised" ? "We have your question and will reply here shortly." : "We are preparing a revised design based on your feedback. You will be notified when it is ready."}
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section className="mt-16 max-w-2xl">
          <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">History</div>
          <ol className="divide-y divide-divider border-y border-divider">
            {history.map((e, i) => (
              <li key={i} className="py-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {e.kind === "sent" && <>Revision {e.revision_no} shared with you</>}
                    {e.kind === "response" && <>{e.who}: {RESPONSE_LABEL[e.action!]?.toLowerCase()} (revision {e.revision_no})</>}
                    {e.kind === "reply" && <>Reply from {e.who}</>}
                  </span>
                  <span className="text-xs text-stone">{fmtDateTime(e.at)}</span>
                </div>
                {e.text && <p className="mt-1.5 whitespace-pre-line text-charcoal/75">“{e.text}”</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {earlier.length > 0 && (
        <section className="mt-16">
          <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">Earlier revisions</div>
          <div className="space-y-3">
            {earlier.map((r) => (
              <details key={r.id} className="border border-divider bg-paper">
                <summary className="cursor-pointer px-5 py-4 text-sm">Revision {r.revision_no} · shared {fmtDateTime(r.published_at)}</summary>
                <div className="border-t border-divider p-5"><Presentation r={r} /></div>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
