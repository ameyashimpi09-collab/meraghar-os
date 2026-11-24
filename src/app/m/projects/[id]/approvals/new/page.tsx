import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { APPROVAL_CATEGORIES, AREAS, todayIST } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui";
import { createApprovalAction } from "../../../../approvals/actions";

export const metadata = { title: "New approval" };

export default async function NewApproval({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const p = await withUser(user.id, async (db) =>
    (await db.query("select id, name, project_code, can_manage_project(id) as can_manage from projects where id = $1 and deleted_at is null", [id])).rows[0]);
  if (!p) notFound();
  if (!p.can_manage) return <p className="text-sm text-ink-3">Only this project’s manager or an owner/admin can create approvals.</p>;

  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href={`/m/projects/${p.id}`} className="hover:underline">{p.project_code}</Link> / New approval</div>
      <PageHeader title="New approval" subtitle={`For ${p.name}. Next you will add the design files and specifications, check the client’s view, then send it.`} />
      <ActionForm action={createApprovalAction} className="card max-w-2xl space-y-4 p-5">
        <input type="hidden" name="project_id" value={p.id} />
        <div><label className="label">Approval title</label><input name="title" className="input" required maxLength={150} placeholder="e.g. Kitchen shutter laminate" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Room / area</label>
            <input name="area" list="areas" className="input" required maxLength={80} placeholder="e.g. Kitchen" />
            <datalist id="areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist></div>
          <div><label className="label">Category</label>
            <input name="category" list="cats" className="input" required maxLength={80} placeholder="e.g. Laminate" />
            <datalist id="cats">{APPROVAL_CATEGORIES.map((a) => <option key={a} value={a} />)}</datalist></div>
          <div><label className="label">Item</label><input name="item_name" className="input" required maxLength={120} placeholder="e.g. Base and wall unit shutters" /></div>
          <div><label className="label">Client must decide by</label><input name="deadline" type="date" min={todayIST()} className="input" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <Link href={`/m/projects/${p.id}`} className="btn-ghost">Cancel</Link>
          <Submit pendingText="Creating…">Create and add details</Submit>
        </div>
      </ActionForm>
    </>
  );
}
