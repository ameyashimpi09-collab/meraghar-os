import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectDetail } from "@/lib/queries";
import { openBlockers, taskList } from "@/lib/execution";
import { projectSchedule as project } from "@/lib/schedule";
import { Gantt } from "@/components/execution";
import { BlockerList, RaiseBlockerForm } from "@/components/blockers";
import { todayIST } from "@/lib/format";
import { approvalList } from "@/lib/approvals";
import { APPROVAL_STATUS_LABEL } from "@/lib/format";
import { APPROVAL_TONE } from "@/components/approvals";
import { fmtDate, POSSESSION_LABEL } from "@/lib/format";
import { MEMBER_ROLE_LABEL } from "@/lib/roles";
import { Avatar, Badge, Empty, Field, HEALTH_LABEL, HEALTH_TONE, Section } from "@/components/ui";
import { TaskRow } from "@/components/TaskRow";
import { ClientExperiencePanel } from "@/components/ClientExperiencePanel";
import { EmployeeProjectExtras } from "@/components/EmployeeProjectExtras";

export default async function EmployeeProject({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("employee");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const d = await projectDetail(db, id); // returns null if not assigned (database refuses)
    if (!d) return null;
    const deps = (await db.query(
      `select d.stage_id, d.depends_on_stage_id, d.lag_days from stage_dependencies d join project_stages s on s.id = d.stage_id and s.deleted_at is null where s.project_id = $1`, [id])).rows;
    return {
      ...d, deps, tasks: await taskList(db, { projectId: id, mine: true, view: "all" }), approvals: await approvalList(db, { projectId: id }),
      teamOpen: (await taskList(db, { projectId: id, view: "open" })).filter((t) => t.assigned_to !== user.id),
      blockers: await openBlockers(db, { projectId: id }),
    };
  });
  if (!data) notFound();
  const { project: p, members, scope, stages, tasks, approvals, deps, teamOpen, blockers } = data;
  const today = todayIST();
  const proj = project(stages as never, deps, today);
  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/e/projects" className="hover:underline">My projects</Link> / {p.project_code}</div>
      <h1 className="text-xl font-semibold sm:text-2xl">{p.name}</h1>
      <div className="mt-1.5 mb-6 flex flex-wrap items-center gap-2 text-sm text-ink-3">
        {p.health && <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
        <span>{[p.flat_number, p.building_society, p.address_line, p.city].filter(Boolean).join(", ")}</span>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Section title="My tasks on this project">
            {tasks.length === 0 ? <div className="p-4"><Empty title="No tasks assigned to you here" /></div> : <ul className="divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} t={t} editable showProject={false} />)}</ul>}
          </Section>
          <Section title="Schedule">
            {stages.length === 0 ? <div className="p-4"><Empty title="No schedule yet" /></div> : (
              <Gantt today={today} endMarker={{ date: p.target_handover_date, label: "Target handover" }}
                rows={stages.filter((s) => s.status !== "skipped").map((s) => {
                  const x = proj.get(s.id);
                  return { id: s.id, label: s.name, status: s.status, milestone: s.is_milestone, pct: s.completion_pct, slip: x?.slip,
                    sub: `${fmtDate(x?.start ?? s.start_date, { year: false })} – ${fmtDate(x?.end ?? s.planned_end_date, { year: false })} · ${s.completion_pct}%`,
                    start: s.start_date, end: s.planned_end_date, projStart: x?.start, projEnd: x?.end };
                })} />
            )}
          </Section>
          {teamOpen.length > 0 && (
            <Section title={`Team's open tasks (${teamOpen.length})`}>
              <ul className="divide-y divide-line">{teamOpen.map((t) => <TaskRow key={t.id} t={t} showProject={false} showAssignee />)}</ul>
            </Section>
          )}
          <Section title="Client approvals">
            {approvals.length === 0 ? <div className="p-4"><Empty title="No approvals yet" /></div> : (
              <ul className="divide-y divide-line">
                {approvals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0"><div className="truncate font-medium">{a.title}</div><div className="text-xs text-ink-3">{a.area} · {a.item_name}{a.current_revision_no ? ` · rev ${a.current_revision_no}` : ""}</div></div>
                    <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <ClientExperiencePanel projectId={p.id} base="/e" />
          <EmployeeProjectExtras projectId={p.id} />
          <Section title="Scope of work">
            <ul className="divide-y divide-line">
              {scope.filter((s) => s.is_included).map((s) => (
                <li key={s.id} className="px-4 py-2.5 text-sm"><div className="font-medium">{s.category}</div>{s.description && <div className="text-xs text-ink-3">{s.description}</div>}</li>
              ))}
            </ul>
          </Section>
        </div>
        <div className="space-y-5">
          <Section title={`Blockers (${blockers.length})`}>
            <BlockerList blockers={blockers} base="/e" />
            <details className="border-t border-line">
              <summary className="cursor-pointer px-4 py-2.5 text-xs text-brand">+ Flag a site blocker</summary>
              <div className="px-4 pb-4"><RaiseBlockerForm projectId={p.id} stages={stages.map((s) => ({ id: s.id, name: s.name }))} /></div>
            </details>
          </Section>
          <Section title="Site details">
            <dl className="grid grid-cols-2 gap-4 p-4">
              <Field label="Configuration">{p.property_config}</Field>
              <Field label="Carpet area">{p.carpet_area_sqft ? `${p.carpet_area_sqft} sq ft` : null}</Field>
              <Field label="Possession">{p.possession_status ? POSSESSION_LABEL[p.possession_status] : null}</Field>
              <Field label="Target handover">{fmtDate(p.target_handover_date)}</Field>
            </dl>
          </Section>
          <Section title="Project team">
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.full_name} size={28} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{m.full_name}</div><div className="text-xs text-ink-3">{MEMBER_ROLE_LABEL[m.member_role]}</div></div>
                  {m.phone && <a href={`tel:${m.phone.replace(/\s/g, "")}`} className="text-xs text-brand">{m.phone}</a>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
