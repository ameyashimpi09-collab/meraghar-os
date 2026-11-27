import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectTeam, snagDetail, snagList, updateFormOptions } from "@/lib/release4";
import { Empty, PageHeader } from "./ui";
import { SnagDetail, SnagRows, StaffSnagForm } from "./snags";

type Base = "/m" | "/e";
const area = (base: Base) => (base === "/m" ? "management" : "employee") as "management" | "employee";
const VIEWS_M = [["open", "Open"], ["unassigned", "Needs assigning"], ["check", "Fix to check"], ["client", "Waiting for client"], ["resolved", "Resolved"], ["all", "All"]] as const;
const VIEWS_E = [["open", "Open"], ["resolved", "Resolved"], ["all", "All"]] as const;

export async function SnagsIndex({ base, sp }: { base: Base; sp: { view?: string; project?: string } }) {
  const user = await requireUser(area(base));
  const views = base === "/m" ? VIEWS_M : VIEWS_E;
  const view = sp.view && views.some(([k]) => k === sp.view) ? sp.view : "open";
  const { rows, counts, projects } = await withUser(user.id, async (db) => ({
    rows: await snagList(db, { view, projectId: sp.project || null, assignedToMe: base === "/e" }),
    counts: (await db.query(`select count(*) filter (where assigned_to is null and status in ('open','under_review','reopened'))::int as unassigned,
                                    count(*) filter (where resolution_submitted_at is not null and status = 'in_progress')::int as "check"
                               from snags where deleted_at is null and can_manage_project(project_id)`)).rows[0] as Record<string, number>,
    projects: (await updateFormOptions(db)).projects,
  }));
  const q = (v: string) => `?view=${v}${sp.project ? `&project=${sp.project}` : ""}`;
  return (
    <>
      <PageHeader
        title={base === "/m" ? "Snags & concerns" : "My snags"}
        subtitle={base === "/m" ? "Concerns raised by clients or the team. Assign, check the fix, and the client confirms." : "Concerns assigned to you. Fix them and upload photos of the finished work."}
        actions={<Link href={`${base}/snags/new${sp.project ? `?project=${sp.project}` : ""}`} className="btn-ghost">+ Log a snag</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {views.map(([k, label]) => (
          <Link key={k} href={q(k)} className={`rounded-full border px-3 py-1 text-sm ${view === k ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-ink-2 hover:bg-canvas"}`}>
            {label}{counts[k] ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-[10px] text-white">{counts[k]}</span> : null}
          </Link>
        ))}
        {base === "/m" && (
          <form className="ml-auto">
            <input type="hidden" name="view" value={view} />
            <select name="project" defaultValue={sp.project ?? ""} className="input !w-auto !py-1 text-sm" aria-label="Project">
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn-ghost ml-2 !py-1 text-sm">Filter</button>
          </form>
        )}
      </div>
      <section className="card">
        <SnagRows rows={rows} base={base} empty={<Empty title={view === "resolved" ? "No resolved concerns yet" : "No open concerns here"}>{base === "/e" ? "When a concern is assigned to you it appears here." : "Concerns raised by clients appear here straight away."}</Empty>} />
      </section>
    </>
  );
}

export async function SnagDetailPage({ base, id }: { base: Base; id: string }) {
  const user = await requireUser(area(base));
  const data = await withUser(user.id, async (db) => {
    const d = await snagDetail(db, id);
    if (!d) return null;
    return { d, team: d.snag.can_manage ? await projectTeam(db, d.snag.project_id) : [] };
  }).catch(() => null);
  if (!data) notFound();
  return <SnagDetail d={data.d} base={base} team={data.team} />;
}

export async function SnagNew({ base, sp }: { base: Base; sp: { project?: string } }) {
  const user = await requireUser(area(base));
  const { projects } = await withUser(user.id, (db) => updateFormOptions(db));
  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href={`${base}/snags`} className="hover:underline">Snags</Link></div>
      <PageHeader title="Log a snag" subtitle="Something found on site that needs fixing. The project manager is notified." />
      <div className="card max-w-3xl p-4 sm:p-6"><StaffSnagForm projects={projects} projectId={sp.project} /></div>
    </>
  );
}
