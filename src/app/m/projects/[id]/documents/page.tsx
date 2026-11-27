import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { documentList } from "@/lib/release4";
import { PageHeader, Section } from "@/components/ui";
import { DocumentRows, UploadDocumentForm } from "@/components/documents";

export const metadata = { title: "Documents" };

export default async function ProjectDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const p = (await db.query("select id, name, project_code, can_manage_project(id) as can_manage from projects where id = $1 and deleted_at is null", [id])).rows[0];
    if (!p) return null;
    return { p, docs: await documentList(db, id) };
  });
  if (!data) notFound();
  const { p, docs } = data;
  const shared = docs.filter((d) => d.client_visible).length;
  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/projects" className="hover:underline">Projects</Link> / <Link href={`/m/projects/${p.id}`} className="hover:underline">{p.project_code}</Link></div>
      <PageHeader title={`Documents · ${p.name}`} subtitle={`${docs.length} document${docs.length === 1 ? "" : "s"}, ${shared} shared with the client. New versions keep the earlier ones.`} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Section title="Documents"><DocumentRows docs={docs} projectId={p.id} canManage={p.can_manage} canUpload /></Section>
        <Section title="Upload"><div className="p-4"><UploadDocumentForm projectId={p.id} canShare={p.can_manage} /></div></Section>
      </div>
    </>
  );
}
