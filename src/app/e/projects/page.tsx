import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { myProjects } from "@/lib/queries";
import { fmtDate } from "@/lib/format";
import { MEMBER_ROLE_LABEL } from "@/lib/roles";
import { Empty, HealthDot, PageHeader } from "@/components/ui";

export const metadata = { title: "My projects" };

export default async function Page() {
  const user = await requireUser("employee");
  const projects = await withUser(user.id, (db) => myProjects(db));
  return (
    <>
      <PageHeader title="My projects" subtitle="Only projects you are assigned to are shown." />
      {projects.length === 0 ? <Empty title="No projects assigned yet" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/e/projects/${p.id}`} className="card p-4 transition hover:border-ink-3/40">
              <div className="flex items-center gap-2"><HealthDot health={p.health} /><span className="text-xs text-ink-3">{p.project_code}</span></div>
              <div className="mt-1.5 font-medium">{p.name}</div>
              <div className="mt-0.5 text-xs text-ink-3">{p.my_roles.split(",").map((r: string) => MEMBER_ROLE_LABEL[r]).join(", ")}</div>
              <div className="mt-3 h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${p.stages_total ? (100 * p.stages_done) / p.stages_total : 0}%` }} /></div>
              <div className="mt-1.5 flex justify-between text-xs text-ink-3"><span>{p.current_stage ?? "Not started"}</span><span>Handover {fmtDate(p.target_handover_date, { year: false })}</span></div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
