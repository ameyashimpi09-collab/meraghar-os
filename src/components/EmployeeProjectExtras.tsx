import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { documentList, purchaseHistory, purchaseList } from "@/lib/release4";
import { DocumentRows, UploadDocumentForm } from "./documents";
import { PurchaseCard } from "./purchases";
import { Empty, Section } from "./ui";

/** Client purchases and documents on an employee's project page. */
export async function EmployeeProjectExtras({ projectId }: { projectId: string }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const d = await withUser(user.id, async (db) => ({
    items: await purchaseList(db, { projectId }),
    history: await purchaseHistory(db, projectId),
    docs: await documentList(db, projectId),
  }));
  return (
    <>
      <section id="purchases" className="scroll-mt-20">
        <Section title={`Client purchases (${d.items.length})`}>
          {d.items.length === 0 ? <div className="p-4"><Empty title="No purchase items on this project" /></div> : (
            <ul className="divide-y divide-line">{d.items.map((x) => <PurchaseCard key={x.id} x={x} stages={[]} history={d.history.filter((h) => h.purchase_id === x.id)} />)}</ul>
          )}
        </Section>
      </section>
      <section id="documents" className="scroll-mt-20">
        <Section title={`Documents (${d.docs.length})`}>
          <DocumentRows docs={d.docs} projectId={projectId} canManage={false} canUpload />
          <details className="border-t border-line">
            <summary className="cursor-pointer px-4 py-2.5 text-xs text-brand">+ Upload a document</summary>
            <div className="px-4 pb-4"><UploadDocumentForm projectId={projectId} canShare={false} /></div>
          </details>
        </Section>
      </section>
    </>
  );
}
