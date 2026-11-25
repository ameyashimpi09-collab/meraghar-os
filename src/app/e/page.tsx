import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { myProjects } from "@/lib/queries";
import { taskList } from "@/lib/execution";
import { fmtDate, greeting, todayIST } from "@/lib/format";
import { MEMBER_ROLE_LABEL } from "@/lib/roles";
import { Empty, HealthDot, PageHeader, Section, Stat } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";

export const metadata = { title: "My dashboard" };

export default async function EmployeeDashboard() {
  const user = await requireUser("employee");
  const { tasks, projects } = await withUser(user.id, async (db) => ({ tasks: await taskList(db, { mine: true, view: "all" }), projects: await myProjects(db) }));
  const today = todayIST();
  const open = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const dueToday = open.filter((t) => t.due_date === today);
  const upcoming = open.filter((t) => !t.due_date || t.due_date > today);
  const critical = open.filter((t) => t.priority === "critical");
  const blocked = open.filter((t) => t.status === "blocked" || t.status === "waiting_client" || t.status === "waiting_vendor" || t.waiting_on?.length);
  const done = tasks.filter((t) => t.status === "completed");

  return (
    <>
      <PageHeader title={`${greeting()}, ${user.fullName.split(" ")[0]}`} subtitle={`${user.designation ?? ""}${user.designation ? " · " : ""}${projects.length} assigned project${projects.length === 1 ? "" : "s"}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Due today" value={dueToday.length} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "red" : undefined} />
        <Stat label="Upcoming" value={upcoming.length} />
        <Stat label="Critical" value={critical.length} tone={critical.length ? "red" : undefined} />
        <Stat label="Blocked / waiting" value={blocked.length} tone={blocked.length ? "amber" : undefined} href="/e/blockers" />
        <Stat label="Completed" value={done.length} tone="green" />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Section title="Needs attention today" action={<Link href="/e/tasks" className="text-xs text-brand hover:underline">All my tasks</Link>}>
            {[...overdue, ...dueToday].length === 0 ? (
              <div className="p-4"><Empty title="You're all caught up for today" /></div>
            ) : (
              <ul className="divide-y divide-line">{[...overdue, ...dueToday].map((t) => <TaskRow key={t.id} t={t} editable />)}</ul>
            )}
          </Section>
          <Section title="Coming up">
            {upcoming.length === 0 ? <div className="p-4"><Empty title="No upcoming tasks" /></div> : (
              <ul className="divide-y divide-line">{upcoming.slice(0, 8).map((t) => <TaskRow key={t.id} t={t} editable />)}</ul>
            )}
          </Section>
        </div>
        <Section title="My projects">
          {projects.length === 0 ? <div className="p-4"><Empty title="No projects assigned yet" /></div> : (
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/e/projects/${p.id}`} className="flex gap-3 px-4 py-3 hover:bg-canvas/60">
                    <span className="mt-1.5"><HealthDot health={p.health} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-ink-3">{p.my_roles.split(",").map((r: string) => MEMBER_ROLE_LABEL[r]).join(", ")} · Handover {fmtDate(p.target_handover_date, { year: false })}</div>
                      {p.current_stage && <div className="mt-0.5 text-xs text-ink-2">Now: {p.current_stage}</div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
