import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { taskCounts, taskList, workload, type Row } from "@/lib/execution";
import { ROLE_LABEL, type AppRole } from "@/lib/roles";
import { Empty, PageHeader, Section } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

export const metadata = { title: "Tasks" };

const VIEWS: [string, string][] = [
  ["open", "All open"], ["overdue", "Overdue"], ["today", "Due today"], ["review", "Awaiting review"],
  ["blocked", "Blocked / waiting"], ["unassigned", "Unassigned"], ["done", "Completed"],
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("management");
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "open";
  const group = sp.group === "project" ? "project" : sp.group === "none" ? "none" : "person";
  const f = { projectId: sp.project || null, assignee: sp.person || null, q: sp.q?.trim() || null };
  const data = await withUser(user.id, async (db) => {
    const [tasks, people, projects, counts] = await Promise.all([
      taskList(db, { ...f, view }),
      workload(db),
      db.query("select id, name from projects where deleted_at is null and status in ('active','on_hold','draft') order by name"),
      taskCounts(db, f),
    ]);
    return { tasks, people, projects: projects.rows, counts };
  });
  const qs = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const all = { view, group, project: f.projectId, person: f.assignee, q: f.q, ...patch };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "view" && v === "open") && !(k === "group" && v === "person")) u.set(k, v);
    const s = u.toString();
    return `/m/tasks${s ? `?${s}` : ""}`;
  };
  const groups = groupTasks(data.tasks, group);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={user.role === "project_manager" ? "Tasks on the projects you manage." : "Every task across your projects, who has it, and what's stuck."}
        actions={<Link href="/m/tasks/new" className="btn-brand">+ New task</Link>}
      />

      <Section title="Team workload" action={<span className="text-xs text-ink-3">Click a name to see their tasks</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-ink-3"><tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Person</th><th className="px-2 py-2 text-right font-medium">Open</th><th className="px-2 py-2 text-right font-medium">Overdue</th>
              <th className="px-2 py-2 text-right font-medium">Due in 7 days</th><th className="px-2 py-2 text-right font-medium">Blocked</th><th className="px-2 py-2 text-right font-medium">Awaiting review</th>
              <th className="px-4 py-2 text-right font-medium">Done (7 days)</th><th className="w-40 px-4 py-2 font-medium">Load</th>
            </tr></thead>
            <tbody>
              {data.people.map((p) => {
                const max = Math.max(...data.people.map((x) => x.open), 1);
                return (
                  <tr key={p.id} className={`border-b border-line last:border-0 hover:bg-canvas/60 ${f.assignee === p.id ? "bg-brand-soft/50" : ""}`}>
                    <td className="px-4 py-2"><Link href={qs({ person: f.assignee === p.id ? null : p.id })} className="font-medium hover:underline">{p.full_name}</Link><div className="text-xs text-ink-3">{p.designation ?? ROLE_LABEL[p.role as AppRole]}</div></td>
                    <td className="px-2 py-2 text-right tabular-nums">{p.open}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${p.overdue ? "font-medium text-red-600" : "text-ink-3"}`}>{p.overdue}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-2">{p.this_week}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${p.blocked ? "text-amber-700" : "text-ink-3"}`}>{p.blocked}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${p.in_review ? "text-sky-700" : "text-ink-3"}`}>{p.in_review}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{p.done_7d}</td>
                    <td className="px-4 py-2"><div className="h-1.5 rounded-full bg-canvas"><div className={`h-1.5 rounded-full ${p.overdue ? "bg-red-500" : "bg-brand"}`} style={{ width: `${(100 * p.open) / max}%` }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={qs({ view: k })} className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${view === k ? "border-brand font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>
            {label} <span className={`ml-0.5 text-xs ${k === "overdue" && data.counts[k] ? "text-red-600" : "text-ink-3"}`}>{data.counts[k]}</span>
          </Link>
        ))}
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-2" action="/m/tasks">
        {view !== "open" && <input type="hidden" name="view" value={view} />}
        <div className="min-w-48 flex-1"><label className="label">Search</label><input name="q" defaultValue={f.q ?? ""} className="input" placeholder="Task or project name" /></div>
        <div><label className="label">Project</label>
          <select name="project" defaultValue={f.projectId ?? ""} className="input"><option value="">All projects</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label className="label">Person</label>
          <select name="person" defaultValue={f.assignee ?? ""} className="input"><option value="">Everyone</option><option value="none">Unassigned</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
        <div><label className="label">Group by</label>
          <select name="group" defaultValue={group} className="input"><option value="person">Person</option><option value="project">Project</option><option value="none">No grouping</option></select></div>
        <button className="btn-ghost">Apply</button>
        {(f.q || f.projectId || f.assignee) && <Link href={qs({ q: null, project: null, person: null })} className="px-2 py-2 text-sm text-ink-3 hover:text-ink">Clear</Link>}
      </form>

      <div className="mt-5 space-y-5">
        {data.tasks.length === 0 ? <Empty title="No tasks here">{view === "overdue" ? "Nothing is overdue." : "Try another tab or filter."}</Empty> : groups.map(([g, list]) => (
          <Section key={g} title={`${g} (${list.length})`}>
            <ul className="divide-y divide-line">{list.map((t) => <TaskRow key={t.id} t={t} base="/m" showProject={group !== "project"} showAssignee={group !== "person"} />)}</ul>
          </Section>
        ))}
      </div>
    </>
  );
}

function groupTasks(tasks: Row[], by: string): [string, Row[]][] {
  if (by === "none") return [["Tasks", tasks]];
  const m = new Map<string, Row[]>();
  for (const t of tasks) {
    const k = by === "project" ? t.project_name : t.assignee_name ?? "Unassigned";
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return [...m.entries()].sort((a, b) => (a[0] === "Unassigned" ? -1 : b[0] === "Unassigned" ? 1 : a[0].localeCompare(b[0])));
}
