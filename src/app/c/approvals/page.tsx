import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { approvalList } from "@/lib/approvals";
import { APPROVAL_STATUS_CLIENT, fmtDate, relDay, todayIST } from "@/lib/format";

export const metadata = { title: "Approvals" };

type Row = Awaited<ReturnType<typeof approvalList>>[number];

function Group({ title, rows, today }: { title: string; rows: Row[]; today: string }) {
  if (!rows.length) return null;
  return (
    <section className="mt-12">
      <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">{title} · {rows.length}</div>
      <ul className="divide-y divide-divider border-y border-divider">
        {rows.map((a) => (
          <li key={a.id}>
            <Link href={`/c/approvals/${a.id}`} className="flex items-start justify-between gap-6 py-5 transition hover:bg-paper/70">
              <div className="min-w-0">
                <div className="text-[11px] tracking-[0.2em] text-stone uppercase">{a.area}</div>
                <div className="mt-1 font-serif text-2xl leading-snug">{a.title}</div>
                <div className="mt-1 text-sm text-stone">{a.item_name} · Revision {a.current_revision_no}</div>
              </div>
              <div className="shrink-0 pt-1 text-right text-sm">
                {a.status === "pending" && a.deadline ? (
                  <span className={a.deadline < today ? "text-alert" : "text-amber"}>By {fmtDate(a.deadline, { year: false })}<span className="block text-xs">{relDay(a.deadline)}</span></span>
                ) : (
                  <span className={a.status === "approved" ? "text-sage" : "text-stone"}>{APPROVAL_STATUS_CLIENT[a.status]}</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ClientApprovals() {
  const user = await requireUser("client");
  const rows = await withUser(user.id, (db) => approvalList(db));
  const today = todayIST();
  const pending = rows.filter((r) => r.status === "pending");
  const withUs = rows.filter((r) => r.status === "changes_requested" || r.status === "query_raised");
  const approved = rows.filter((r) => r.status === "approved");

  return (
    <>
      <h1 className="font-serif text-5xl">Approvals</h1>
      <p className="mt-4 max-w-xl text-stone">Designs and materials for your home. Every version you see is kept, so there is always a clear record of what was agreed.</p>
      {rows.length === 0 && <p className="mt-16 font-serif text-2xl text-charcoal/70">Nothing to review yet. We will notify you when a design is ready for your decision.</p>}
      <Group title="Needs your decision" rows={pending} today={today} />
      <Group title="With our team" rows={withUs} today={today} />
      <Group title="Approved" rows={approved} today={today} />
    </>
  );
}
