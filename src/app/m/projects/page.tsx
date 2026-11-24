import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectList } from "@/lib/queries";
import { fmtDate, PROJECT_STATUS_LABEL } from "@/lib/format";
import { Badge, Empty, HealthDot, HEALTH_LABEL, HEALTH_TONE, PageHeader } from "@/components/ui";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("management");
  const sp = await searchParams;
  const projects = await withUser(user.id, (db) => projectList(db, { q: sp.q, status: sp.status, health: sp.health }));
  const filtered = Boolean(sp.q || sp.status || sp.health);

  return (
    <>
      <PageHeader title="Projects" subtitle={`${projects.length} project${projects.length === 1 ? "" : "s"}${filtered ? " match your filters" : ""}`}
        actions={<Link href="/m/projects/new" className="btn-brand">+ New project</Link>} />

      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, code, client or society" className="input max-w-xs" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto">
          <option value="">All statuses</option>
          {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="health" defaultValue={sp.health ?? ""} className="input w-auto">
          <option value="">Any health</option>
          <option value="green">On schedule</option><option value="amber">At risk</option><option value="red">Delayed</option>
        </select>
        <button className="btn-ghost">Apply</button>
        {filtered && <Link href="/m/projects" className="btn text-ink-3">Clear</Link>}
      </form>

      {projects.length === 0 ? (
        <Empty title={filtered ? "No projects match these filters" : "No projects yet"}>
          {!filtered && <Link href="/m/projects/new" className="text-brand underline">Create your first project</Link>}
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="hidden w-full text-sm md:table">
            <thead className="bg-canvas/60 text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-2 py-2.5 font-medium">Client</th>
                <th className="px-2 py-2.5 font-medium">Project manager</th>
                <th className="px-2 py-2.5 font-medium">Progress</th>
                <th className="px-2 py-2.5 font-medium">Handover</th>
                <th className="px-4 py-2.5 font-medium">Health</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-line hover:bg-canvas/50">
                  <td className="px-4 py-3">
                    <Link href={`/m/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <div className="text-xs text-ink-3">{p.project_code} · {p.property_config ?? "—"} · {p.building_society ?? p.city}</div>
                  </td>
                  <td className="px-2 py-3 text-ink-2">{p.client_name ?? <span className="text-amber-700">Not added</span>}</td>
                  <td className="px-2 py-3 text-ink-2">{p.pm_name ?? <span className="text-amber-700">Not assigned</span>}</td>
                  <td className="px-2 py-3 text-xs text-ink-2">
                    {p.stages_total ? (
                      <div className="w-28">
                        <div className="h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(100 * p.stages_done) / p.stages_total}%` }} /></div>
                        <div className="mt-1 text-ink-3">{p.stages_done}/{p.stages_total} stages</div>
                      </div>
                    ) : <span className="text-ink-3">No stages yet</span>}
                  </td>
                  <td className="px-2 py-3 text-ink-2 whitespace-nowrap">{fmtDate(p.target_handover_date)}</td>
                  <td className="px-4 py-3">
                    {p.status === "active" || p.status === "on_hold"
                      ? <div className="flex items-center gap-2"><HealthDot health={p.health} /><span className="text-xs">{HEALTH_LABEL[p.health]}</span></div>
                      : <Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/m/projects/${p.id}`} className="flex gap-3 px-4 py-3">
                  <span className="mt-1.5"><HealthDot health={p.health} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-ink-3">{p.project_code} · PM {p.pm_name ?? "—"} · Handover {fmtDate(p.target_handover_date, { year: false })}</div>
                  </div>
                  {p.health && <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
