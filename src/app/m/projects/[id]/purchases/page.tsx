import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { purchaseHistory, purchaseList } from "@/lib/release4";
import { Empty, PageHeader, Section, Stat } from "@/components/ui";
import { PurchaseCard, PurchaseForm } from "@/components/purchases";

export const metadata = { title: "Client purchases" };

export default async function ProjectPurchasesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const p = (await db.query("select id, name, project_code, can_manage_project(id) as can_manage from projects where id = $1 and deleted_at is null", [id])).rows[0];
    if (!p) return null;
    const [items, history, stages] = await Promise.all([
      purchaseList(db, { projectId: id }),
      purchaseHistory(db, id),
      db.query("select id, name from project_stages where project_id = $1 and deleted_at is null and status <> 'skipped' order by sort_order", [id]),
    ]);
    return { p, items, history, stages: stages.rows };
  });
  if (!data) notFound();
  const { p, items, history, stages } = data;
  const open = items.filter((x) => !["delivered", "installed", "cancelled"].includes(x.status));
  const risky = items.filter((x) => x.risk);
  const done = items.filter((x) => ["delivered", "installed"].includes(x.status));
  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/purchases" className="hover:underline">Procurement</Link> / <Link href={`/m/projects/${p.id}`} className="hover:underline">{p.project_code}</Link></div>
      <PageHeader title={`Client purchases · ${p.name}`} subtitle="Items the client (or we) must buy, with the exact size and the date they are needed at site. The client sees these and updates their status." />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Items" value={items.length} />
        <Stat label="Still to arrive" value={open.length} />
        <Stat label="May delay work" value={risky.length} tone={risky.length ? "red" : undefined} />
        <Stat label="Delivered / installed" value={done.length} tone="green" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Section title="Items">
          {items.length === 0 ? <div className="p-4"><Empty title="No purchase items yet">Add the appliances, lights, sanitaryware and other items the client needs to buy.</Empty></div> : (
            <ul className="divide-y divide-line">{items.map((x) => <PurchaseCard key={x.id} x={x} stages={stages} history={history.filter((h) => h.purchase_id === x.id)} />)}</ul>
          )}
        </Section>
        {p.can_manage && <Section title="Add an item"><div className="p-4"><PurchaseForm projectId={p.id} stages={stages} /></div></Section>}
      </div>
    </>
  );
}
