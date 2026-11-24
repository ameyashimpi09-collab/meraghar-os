import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { managementOverview, priorityActions, projectList } from "@/lib/queries";
import { fmtDate, greeting, inr, relDay, PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/format";
import { Badge, Empty, HealthDot, HEALTH_LABEL, HEALTH_TONE, PageHeader, PRIORITY_TONE, Section, Stat } from "@/components/ui";

export const metadata = { title: "Dashboard" };

function actionHref(a: { kind: string; project_id: string; record_id: string | null }) {
  if (a.kind === "approval" && a.record_id) return `/m/approvals/${a.record_id}`;
  if (a.kind === "payment") return `/m/projects/${a.project_id}/payments`;
  return `/m/projects/${a.project_id}`;
}

const KIND_LABEL: Record<string, string> = { task: "Task", approval: "Approval", payment: "Payment", snag: "Snag", project: "Project" };

export default async function ManagementDashboard() {
  const user = await requireUser("management");
  const { o, actions, projects } = await withUser(user.id, async (db) => ({
    o: await managementOverview(db),
    actions: await priorityActions(db),
    projects: (await projectList(db, { status: "active" })).slice(0, 8),
  }));

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.fullName.split(" ")[0]}`}
        subtitle={user.role === "project_manager" ? "Showing the projects you manage." : "Here is what needs attention across the business today."}
        actions={<Link href="/m/projects/new" className="btn-brand">+ New project</Link>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Active projects" value={o.active_projects} href="/m/projects" />
        <Stat label="On schedule" value={o.on_schedule} tone="green" href="/m/projects?health=green" />
        <Stat label="At risk" value={o.at_risk} tone={o.at_risk ? "amber" : undefined} href="/m/projects?health=amber" />
        <Stat label="Delayed" value={o.delayed} tone={o.delayed ? "red" : undefined} href="/m/projects?health=red" />
        <Stat label="Pending client approvals" value={o.pending_approvals} tone={o.pending_approvals ? "amber" : undefined} href="/m/approvals?status=pending" />
        <Stat label="Overdue payments" href="/m/payments" value={o.overdue_payments} tone={o.overdue_payments ? "red" : undefined} hint={o.overdue_payments ? `${inr(o.overdue_amount)} outstanding` : undefined} />
        <Stat href="/m/payments" label="Upcoming payments (30 days)" value={o.upcoming_payments} hint={o.upcoming_payments ? inr(o.upcoming_amount) : undefined} />
        <Stat label="Open snags" value={o.open_snags} tone={o.open_snags ? "amber" : undefined} />
        <Stat label="Overdue tasks" value={o.overdue_tasks} tone={o.overdue_tasks ? "red" : undefined} />
        <Stat label="Tasks due today" value={o.tasks_today} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Section title="Priority action centre" action={<span className="text-xs text-ink-3">{actions.length} item{actions.length === 1 ? "" : "s"}</span>}>
          {actions.length === 0 ? (
            <div className="p-4"><Empty title="Nothing needs attention right now">New overdue tasks, approvals, payments and snags will appear here automatically.</Empty></div>
          ) : (
            <>
              {/* Desktop table */}
              <table className="hidden w-full text-sm md:table">
                <thead className="text-left text-xs text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Priority</th>
                    <th className="px-2 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">Assigned</th>
                    <th className="px-2 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Status / reason</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a, i) => (
                    <tr key={i} className="border-b border-line last:border-0 hover:bg-canvas/60">
                      <td className="px-4 py-2.5 align-top"><Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY_LABEL[a.priority]}</Badge></td>
                      <td className="px-2 py-2.5 align-top">
                        <Link href={actionHref(a)} className="font-medium text-ink hover:underline">{a.title}</Link>
                        <div className="text-xs text-ink-3">{KIND_LABEL[a.kind]} · {a.project_name}</div>
                      </td>
                      <td className="px-2 py-2.5 align-top text-ink-2">{a.assignee ?? "—"}</td>
                      <td className="px-2 py-2.5 align-top whitespace-nowrap">
                        <div className="text-ink-2">{fmtDate(a.due_date, { year: false })}</div>
                        {a.due_date && <div className={`text-xs ${relDay(a.due_date).includes("overdue") ? "text-red-600" : "text-ink-3"}`}>{relDay(a.due_date)}</div>}
                      </td>
                      <td className="px-4 py-2.5 align-top text-xs text-ink-2">
                        <div>{TASK_STATUS_LABEL[a.status] ?? a.status}</div>
                        {a.reason && <div className="text-ink-3">{a.kind === "payment" ? `${inr(Number(a.reason))} outstanding` : a.reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile list */}
              <ul className="divide-y divide-line md:hidden">
                {actions.map((a, i) => (
                  <li key={i}>
                    <Link href={actionHref(a)} className="block px-4 py-3">
                      <div className="flex items-center gap-2"><Badge tone={PRIORITY_TONE[a.priority]}>{PRIORITY_LABEL[a.priority]}</Badge><span className="text-xs text-ink-3">{KIND_LABEL[a.kind]}</span></div>
                      <div className="mt-1 text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-ink-3">{a.project_name} · {a.assignee ?? "Unassigned"}{a.due_date ? ` · ${relDay(a.due_date)}` : ""}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section title="Project health" action={<Link href="/m/projects" className="text-xs text-brand hover:underline">All projects</Link>}>
          {projects.length === 0 ? (
            <div className="p-4"><Empty title="No active projects yet"><Link className="text-brand underline" href="/m/projects/new">Create the first project</Link></Empty></div>
          ) : (
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/m/projects/${p.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-canvas/60">
                    <span className="mt-1.5"><HealthDot health={p.health} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-ink-3">{p.pm_name ?? "No PM"} · Handover {fmtDate(p.target_handover_date, { year: false })}</div>
                      {p.reasons?.length > 0 && <div className="mt-0.5 truncate text-xs text-ink-2">{p.reasons.join(" · ")}</div>}
                    </div>
                    <Badge tone={HEALTH_TONE[p.health] ?? "gray"}>{HEALTH_LABEL[p.health] ?? "—"}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <p className="mt-6 text-xs text-ink-3">Health is worked out from real schedule data: overdue stages and tasks, overdue client approvals, blockers and the handover date. It is never a typed-in percentage.</p>
    </>
  );
}
