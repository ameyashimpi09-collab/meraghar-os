import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fmtDate, relDay } from "@/lib/format";
import { dims, purchaseList, PURCHASE_STATUS_LABEL, PURCHASE_TONE, RESPONSIBILITY_LABEL } from "@/lib/release4";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { RISK_LABEL } from "@/components/purchases";

export const metadata = { title: "Procurement" };

export default async function PurchasesOverview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser("management");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : sp.view === "open" ? "open" : "risk";
  const { rows, all } = await withUser(user.id, async (db) => {
    const all = await purchaseList(db, {});
    return { all, rows: view === "all" ? all : view === "open" ? all.filter((r) => !["delivered", "installed", "cancelled"].includes(r.status)) : all.filter((r) => r.risk) };
  });
  const byProject = new Map<string, { name: string; id: string; n: number; risk: number }>();
  for (const r of all) {
    const e = byProject.get(r.project_id) ?? { name: r.project_name, id: r.project_id, n: 0, risk: 0 };
    if (!["delivered", "installed", "cancelled"].includes(r.status)) e.n++;
    if (r.risk) e.risk++;
    byProject.set(r.project_id, e);
  }
  const tabs = [["risk", "May delay work"], ["open", "Still to arrive"], ["all", "All items"]] as const;
  return (
    <>
      <PageHeader title="Procurement" subtitle="Client purchases across all projects. Items late for site, or not yet bought close to their date, are shown first." />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="May delay work" value={all.filter((r) => r.risk).length} tone={all.some((r) => r.risk) ? "red" : undefined} href="?view=risk" />
        <Stat label="Late for site" value={all.filter((r) => r.risk === "late").length} tone={all.some((r) => r.risk === "late") ? "red" : undefined} />
        <Stat label="Still to arrive" value={all.filter((r) => !["delivered", "installed", "cancelled"].includes(r.status)).length} href="?view=open" />
        <Stat label="Delivered / installed" value={all.filter((r) => ["delivered", "installed"].includes(r.status)).length} tone="green" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            {tabs.map(([k, l]) => <Link key={k} href={`?view=${k}`} className={`rounded-full border px-3 py-1 text-sm ${view === k ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-ink-2 hover:bg-canvas"}`}>{l}</Link>)}
          </div>
          <section className="card">
            {rows.length === 0 ? <div className="p-4"><Empty title={view === "risk" ? "Nothing is putting the schedule at risk" : "No items"}>Add items from a project’s Purchases page.</Empty></div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Project</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Buy by</th><th className="px-3 py-2 font-medium">At site by</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((x) => {
                      const d = dims(x);
                      return (
                        <tr key={x.id} className="align-top hover:bg-canvas/50">
                          <td className="px-4 py-2.5"><Link href={`/m/projects/${x.project_id}/purchases#p-${x.id}`} className="font-medium hover:underline">{x.item_name}</Link><div className="text-xs text-ink-3">{[x.area, RESPONSIBILITY_LABEL[x.responsibility], d?.main].filter(Boolean).join(" · ")}</div></td>
                          <td className="px-3 py-2.5 text-ink-2">{x.project_name}</td>
                          <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1"><Badge tone={PURCHASE_TONE[x.status]}>{PURCHASE_STATUS_LABEL[x.status]}</Badge>{x.risk && <Badge tone={RISK_LABEL[x.risk].tone}>{RISK_LABEL[x.risk].label}</Badge>}</div></td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(x.required_purchase_date, { year: false })}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(x.required_delivery_date, { year: false })}{x.required_delivery_date && !["delivered", "installed", "cancelled"].includes(x.status) ? <div className="text-xs text-ink-3">{relDay(x.required_delivery_date)}</div> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <Section title="By project">
          <ul className="divide-y divide-line">
            {[...byProject.values()].map((p) => (
              <li key={p.id}><Link href={`/m/projects/${p.id}/purchases`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-canvas"><span>{p.name}</span><span className="text-xs text-ink-3">{p.n} to arrive{p.risk ? <b className="ml-1 text-red-600">· {p.risk} at risk</b> : null}</span></Link></li>
            ))}
            {byProject.size === 0 && <li className="px-4 py-3 text-sm text-ink-3">No purchase items yet.</li>}
          </ul>
        </Section>
      </div>
    </>
  );
}
