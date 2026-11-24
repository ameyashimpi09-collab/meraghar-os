import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { approvalList } from "@/lib/approvals";
import { APPROVAL_STATUS_LABEL, fmtDate, relDay, todayIST } from "@/lib/format";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { APPROVAL_TONE } from "@/components/approvals";

export const metadata = { title: "Approvals" };

const FILTERS: [string, string][] = [
  ["open", "Open"], ["pending", "Waiting for client"], ["query_raised", "Client queries"],
  ["changes_requested", "Changes requested"], ["draft", "Drafts"], ["approved", "Approved"], ["", "All"],
];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("management");
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const rows = await withUser(user.id, (db) => approvalList(db, { status, q: sp.q }));
  const today = todayIST();

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Design and material finalisations across your projects. Every sent revision is locked and kept."
        actions={<span className="text-xs text-ink-3">To create an approval, open a project and use “New approval”.</span>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k || "all"} href={`/m/approvals${k ? `?status=${k}` : "?status="}`}
            className={`rounded-full border px-3 py-1 text-xs ${status === k ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-ink-2 hover:bg-canvas"}`}>
            {label}
          </Link>
        ))}
        <form className="ml-auto">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search item, area, project" className="input w-56 py-1.5" />
        </form>
      </div>
      <Section title={`${rows.length} approval${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title="No approvals here">Open a project and choose “New approval” to send a design or material for the client’s decision.</Empty></div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id}>
                <Link href={`/m/approvals/${a.id}`} className="grid gap-1 px-4 py-3 hover:bg-canvas/60 sm:grid-cols-[1fr_170px_150px] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.title}</div>
                    <div className="truncate text-xs text-ink-3">{a.project_name} · {a.area} · {a.category} · {a.item_name}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Badge>
                    {a.current_revision_no > 0 && <span className="text-xs text-ink-3">Rev {a.current_revision_no}</span>}
                    {a.has_draft && a.status !== "draft" && <Badge>Draft rev {a.latest_revision_no}</Badge>}
                  </div>
                  <div className="text-xs sm:text-right">
                    {a.status === "approved" ? <span className="text-ink-3">Approved</span> : a.deadline ? (
                      <>
                        <div className="text-ink-2">By {fmtDate(a.deadline, { year: false })}</div>
                        <div className={a.deadline < today && a.status === "pending" ? "text-red-600" : "text-ink-3"}>{relDay(a.deadline)}</div>
                      </>
                    ) : <span className="text-ink-3">No deadline</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
