import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectDetail } from "@/lib/queries";
import { approvalList } from "@/lib/approvals";
import { APPROVAL_STATUS_LABEL, fmtDate, fmtDateTime, inr, PAYMENT_STATUS_LABEL, POSSESSION_LABEL, PROJECT_STATUS_LABEL, relDay, todayIST } from "@/lib/format";
import { APPROVAL_TONE, PAYMENT_TONE } from "@/components/approvals";
import { MEMBER_ROLE_LABEL, creatableRoles } from "@/lib/roles";
import { Avatar, Badge, Empty, Field, HEALTH_LABEL, HEALTH_TONE, Section } from "@/components/ui";
import { removeMemberAction } from "../../actions";
import { AddMemberForm, EditProjectForm, ResetPasswordButton } from "./ProjectForms";
import { taskList } from "@/lib/execution";
import { TaskRow } from "@/components/TaskRow";

const STAGE_TONE = { completed: "green", in_progress: "blue", delayed: "red", on_hold: "amber", not_started: "gray", skipped: "gray" } as const;
const STAGE_LABEL: Record<string, string> = { completed: "Completed", in_progress: "In progress", delayed: "Delayed", on_hold: "On hold", not_started: "Not started", skipped: "Skipped" };
const ACTION_TEXT: Record<string, string> = { insert: "added", update: "updated", delete: "removed" };
const ENTITY_TEXT: Record<string, string> = {
  projects: "project details", project_members: "team member", project_scope_items: "scope item", project_scope_costs: "scope cost",
  project_stages: "stage", tasks: "task", approvals: "approval", approval_revisions: "approval revision", approval_responses: "client response",
  payment_milestones: "payment milestone", payment_transactions: "payment", payment_due_date_changes: "payment due date", snags: "snag", purchase_requirements: "purchase item",
  approval_messages: "reply to client", internal_notes: "internal note", blockers: "blocker", stage_dependencies: "stage dependency",
  task_dependencies: "task dependency", schedule_changes: "schedule change",
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const data = await withUser(user.id, async (db) => {
    const d = await projectDetail(db, id);
    if (!d) return null;
    const people = (await db.query("select id, full_name, role from profiles where is_active and deleted_at is null order by full_name")).rows;
    const audit = (await db.query(
      `select a.action, a.entity_type, a.created_at, pr.full_name as actor
         from audit_logs a left join profiles pr on pr.id = a.actor_id
        where a.project_id = $1 order by a.created_at desc limit 12`, [id])).rows;
    const approvals = await approvalList(db, { projectId: id });
    const payments = d.project.can_manage
      ? (await db.query(`select id, name, amount_paise, received_paise, outstanding_paise, due_date, effective_status
                           from payment_milestone_balances where project_id = $1 order by sort_order, due_date nulls last`, [id])).rows
      : [];
    const openTasks = await taskList(db, { projectId: id, view: "open" });
    return { ...d, people, audit, approvals, payments, openTasks };
  });
  if (!data) notFound();
  const { project: p, members, scope, stages, people, audit, approvals, payments, openTasks } = data;
  const today = todayIST();
  const payTotal = payments.reduce((s, m) => s + m.amount_paise, 0);
  const payReceived = payments.reduce((s, m) => s + m.received_paise, 0);
  const client = members.find((m) => m.member_role === "client");
  const totalCost = scope.reduce((s, x) => s + (x.estimated_cost_paise ?? 0), 0);

  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/projects" className="hover:underline">Projects</Link> / {p.project_code}</div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{p.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <Badge tone="brand">{p.project_code}</Badge>
            <Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge>
            {p.health && <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
            <span>{[p.flat_number, p.building_society, p.city].filter(Boolean).join(", ")}</span>
          </div>
        </div>
        {p.can_manage && <EditProjectForm p={p} />}
      </div>

      {p.reasons?.length > 0 && (
        <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${p.health === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span className="font-medium">Why this project is {HEALTH_LABEL[p.health].toLowerCase()}: </span>{p.reasons.join(" · ")}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Section title="Project profile">
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Address">{p.address_line}</Field>
              <Field label="Building / society">{p.building_society}</Field>
              <Field label="Flat / unit">{p.flat_number}</Field>
              <Field label="City">{[p.city, p.pincode].filter(Boolean).join(" ")}</Field>
              <Field label="Configuration">{p.property_config}</Field>
              <Field label="Carpet area">{p.carpet_area_sqft ? `${p.carpet_area_sqft.toLocaleString("en-IN")} sq ft` : null}</Field>
              <Field label="Possession">{p.possession_status ? POSSESSION_LABEL[p.possession_status] : null}</Field>
              <Field label="Expected start">{fmtDate(p.expected_start_date)}</Field>
              <Field label="Target handover">{fmtDate(p.target_handover_date)}</Field>
              <Field label="Actual handover">{p.actual_handover_date ? fmtDate(p.actual_handover_date) : null}</Field>
              <Field label="Site update frequency">Every {p.site_update_frequency_days} days</Field>
              <Field label="Created">{fmtDateTime(p.created_at)}</Field>
            </dl>
            {p.description && <p className="border-t border-line px-4 py-3 text-sm text-ink-2">{p.description}</p>}
          </Section>

          <Section title="Scope of work" action={p.can_manage && totalCost > 0 ? <span className="text-xs text-ink-3">Est. total <span className="font-semibold text-ink">{inr(totalCost)}</span> · management only</span> : null}>
            {scope.length === 0 ? <div className="p-4"><Empty title="No scope added yet" /></div> : (
              <table className="w-full text-sm">
                <tbody>
                  {scope.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 align-top">
                        <div className="font-medium">{s.category}</div>
                        {s.description && <div className="text-xs text-ink-3">{s.description}</div>}
                      </td>
                      <td className="px-2 py-2.5 align-top">{s.is_included ? <Badge tone="green">Included</Badge> : <Badge>Excluded</Badge>}</td>
                      {p.can_manage && <td className="px-4 py-2.5 text-right align-top tabular-nums text-ink-2">{s.estimated_cost_paise ? inr(s.estimated_cost_paise) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Design & material approvals" action={p.can_manage ? <Link href={`/m/projects/${p.id}/approvals/new`} className="btn-brand px-3 py-1 text-xs">+ New approval</Link> : null}>
            {approvals.length === 0 ? <div className="p-4"><Empty title="No approvals yet">Send designs and material selections to the client for a recorded decision.</Empty></div> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-3"><tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Area</th><th className="px-2 py-2 font-medium">Item</th><th className="px-2 py-2 font-medium">Approval</th><th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Deadline</th>
                </tr></thead>
                <tbody>
                  {approvals.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                      <td className="px-4 py-2.5 align-top text-ink-2">{a.area}</td>
                      <td className="px-2 py-2.5 align-top"><Link href={`/m/approvals/${a.id}`} className="font-medium hover:underline">{a.title}</Link><div className="text-xs text-ink-3">{a.category}{a.current_revision_no ? ` · rev ${a.current_revision_no}` : ""}</div></td>
                      <td className="px-2 py-2.5 align-top"><Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Badge></td>
                      <td className={`hidden px-4 py-2.5 text-right align-top text-xs sm:table-cell ${a.status === "pending" && a.deadline && a.deadline < today ? "text-red-600" : "text-ink-3"}`}>{a.status === "approved" ? "—" : a.deadline ? relDay(a.deadline) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {p.can_manage && (
            <Section title="Payments" action={<Link href={`/m/projects/${p.id}/payments`} className="text-xs text-brand hover:underline">{payments.length ? "Open payments" : "Create payment schedule"} →</Link>}>
              {payments.length === 0 ? <div className="p-4"><Empty title="No payment schedule yet" /></div> : (
                <>
                  <div className="flex flex-wrap gap-x-8 gap-y-1 border-b border-line px-4 py-3 text-sm">
                    <span>Schedule <b className="tabular-nums">{inr(payTotal)}</b></span>
                    <span>Received <b className="text-emerald-700 tabular-nums">{inr(payReceived)}</b></span>
                    <span>Outstanding <b className="tabular-nums">{inr(payTotal - payReceived)}</b></span>
                  </div>
                  <ul className="divide-y divide-line">
                    {payments.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span className="hidden text-xs text-ink-3 sm:inline">{fmtDate(m.due_date, { year: false })}</span>
                        <span className="w-24 text-right tabular-nums">{inr(m.amount_paise)}</span>
                        <Badge tone={PAYMENT_TONE[m.effective_status]}>{PAYMENT_STATUS_LABEL[m.effective_status]}</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          <Section title="Execution schedule" action={<Link href={`/m/projects/${p.id}/schedule`} className="text-xs text-brand hover:underline">{stages.length ? "Open schedule" : "Set up schedule"} →</Link>}>
            {stages.length === 0 ? <div className="p-4"><Empty title="No stages yet">Set up the default stages in one step, then adjust dates.</Empty></div> : (
              <ol className="divide-y divide-line">
                {stages.map((s) => (
                  <li key={s.id}>
                    <Link href={`/m/projects/${p.id}/schedule#stage-${s.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-canvas/60">
                      <span className="w-5 text-xs text-ink-3 tabular-nums">{s.sort_order}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{s.name}</div>
                        <div className={`text-xs ${!["completed", "skipped"].includes(s.status) && s.planned_end_date && s.planned_end_date < today ? "text-red-600" : "text-ink-3"}`}>{fmtDate(s.start_date, { year: false })} → {fmtDate(s.planned_end_date, { year: false })}</div>
                      </div>
                      <span className="hidden w-24 sm:block"><span className="block h-1.5 rounded-full bg-canvas"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${s.completion_pct}%` }} /></span></span>
                      <Badge tone={STAGE_TONE[s.status as keyof typeof STAGE_TONE]}>{STAGE_LABEL[s.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title={`Tasks (${openTasks.length} open)`} action={p.can_manage ? <Link href={`/m/tasks/new?project=${p.id}`} className="btn-brand px-3 py-1 text-xs">+ New task</Link> : null}>
            {openTasks.length === 0 ? <div className="p-4"><Empty title="No open tasks" /></div> : (
              <ul className="divide-y divide-line">{openTasks.slice(0, 8).map((t) => <TaskRow key={t.id} t={t} base="/m" showProject={false} showAssignee />)}</ul>
            )}
            {openTasks.length > 8 && <Link href={`/m/tasks?project=${p.id}`} className="block border-t border-line px-4 py-2.5 text-xs text-brand hover:underline">All {openTasks.length} open tasks →</Link>}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Team">
            <ul className="divide-y divide-line">
              {members.filter((m) => m.member_role !== "client").map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.full_name}</div>
                    <div className="text-xs text-ink-3">{MEMBER_ROLE_LABEL[m.member_role]}{m.phone ? ` · ${m.phone}` : ""}</div>
                  </div>
                  {p.can_manage && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="member_id" value={m.id} /><input type="hidden" name="project_id" value={p.id} />
                      <button className="text-xs text-ink-3 hover:text-red-600" title="Remove from project">Remove</button>
                    </form>
                  )}
                </li>
              ))}
              {members.filter((m) => m.member_role !== "client").length === 0 && <li className="px-4 py-3 text-sm text-ink-3">Nobody assigned yet.</li>}
            </ul>
            {p.can_manage && <AddMemberForm projectId={p.id} people={people} />}
          </Section>

          <Section title="Client">
            {client ? (
              <div className="space-y-3 p-4 text-sm">
                <div className="flex items-center gap-3">
                  <Avatar name={client.full_name} size={40} />
                  <div><div className="font-medium">{client.full_name}</div><div className="text-xs text-ink-3">Client login: {client.email}</div></div>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="Phone">{client.phone}</Field>
                  <Field label="Prefers">{{ whatsapp: "WhatsApp", phone: "Phone call", email: "Email", in_app: "In the app" }[client.preferred_contact_method as string]}</Field>
                  {client.secondary_contact_name && <Field label="Secondary contact">{client.secondary_contact_name}{client.secondary_contact_phone ? ` · ${client.secondary_contact_phone}` : ""}</Field>}
                </dl>
                {creatableRoles(user.role).includes("client") && <ResetPasswordButton profileId={client.profile_id} />}
              </div>
            ) : (
              <div className="p-4 text-sm text-ink-3">No client linked yet. Use <span className="font-medium">Assign as → Client</span> in the Team box, or create the client under Team &amp; Clients first.</div>
            )}
          </Section>

          <Section title="Recent activity">
            {audit.length === 0 ? <p className="p-4 text-sm text-ink-3">No activity yet.</p> : (
              <ul className="divide-y divide-line">
                {audit.map((a, i) => (
                  <li key={i} className="px-4 py-2 text-xs">
                    <span className="font-medium text-ink">{a.actor ?? "System"}</span>{" "}
                    <span className="text-ink-2">{ACTION_TEXT[a.action] ?? a.action} {ENTITY_TEXT[a.entity_type] ?? a.entity_type.replace(/_/g, " ")}</span>
                    <div className="text-ink-3">{fmtDateTime(a.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
