import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectSchedule as loadSchedule, type Row } from "@/lib/execution";
import { projectSchedule as project, downstreamOf } from "@/lib/schedule";
import { DELAY_HINT, DELAY_LABEL, fmtDate, fmtDateTime, relDay, STAGE_STATUS_LABEL, todayIST, daysBetween } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Badge, Empty, HEALTH_LABEL, HEALTH_TONE, PageHeader, Section, Stat } from "@/components/ui";
import { CalendarMonth, DelayBadge, Gantt, STAGE_TONE, type CalItem } from "@/components/execution";
import { TaskRow } from "@/components/TaskRow";
import { BlockerList, RaiseBlockerForm } from "@/components/blockers";
import {
  addStageAction, addStageDependencyAction, addTemplateTasksAction, applyProjectionAction, applyTemplateAction, moveStageAction,
  removeStageAction, removeStageDependencyAction, updateStageAction,
} from "../../../schedule/actions";

export const metadata = { title: "Schedule" };

const VIEWS = [["list", "Stages"], ["gantt", "Timeline"], ["calendar", "Calendar"], ["milestones", "Milestones"]] as const;

export default async function ProjectSchedulePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const user = await requireUser("management");
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, (db) => loadSchedule(db, id));
  if (!data) notFound();
  const { project: p, stages, deps, tasks, blockers, changes, templateStageCount } = data;
  const today = todayIST();
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "list";
  const proj = project(stages as never, deps, today);
  const name = new Map(stages.map((s) => [s.id, s.name as string]));

  const active = stages.filter((s) => s.status !== "skipped");
  const done = active.filter((s) => s.status === "completed").length;
  const current = active.find((s) => ["in_progress", "delayed", "on_hold"].includes(s.status)) ?? active.find((s) => s.status === "not_started");
  const lastEnd = active.map((s) => proj.get(s.id)?.end).filter(Boolean).sort().at(-1) ?? null;
  const handoverSlip = lastEnd && p.target_handover_date ? daysBetween(p.target_handover_date, lastEnd) : 0;
  const slipping = active.filter((s) => (proj.get(s.id)?.slip ?? 0) > 0 && !["completed", "skipped"].includes(s.status));
  const rootCauses = slipping.filter((s) => !proj.get(s.id)?.pushedBy);
  const openTasks = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  const wide = view === "gantt" || view === "calendar";
  const href = (v: string) => `/m/projects/${p.id}/schedule${v === "list" ? "" : `?view=${v}`}`;

  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/schedule" className="hover:underline">Execution schedule</Link> / <Link href={`/m/projects/${p.id}`} className="hover:underline">{p.project_code}</Link></div>
      <PageHeader
        title={`Schedule · ${p.name}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{p.health && <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}<span>Stages, dependencies and tasks. Dates that move always need a reason, and the client sees only client-visible stages.</span></span>}
        actions={p.can_manage ? <Link href={`/m/tasks/new?project=${p.id}`} className="btn-brand">+ New task</Link> : null}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stages completed" value={`${done} / ${active.length}`} tone={active.length && done === active.length ? "green" : undefined} hint={current ? `Now: ${current.name}` : undefined} />
        <Stat label="Expected finish" value={lastEnd ? fmtDate(lastEnd, { year: false }) : "—"} tone={handoverSlip > 0 ? "red" : lastEnd ? "green" : undefined}
          hint={p.target_handover_date ? (handoverSlip > 0 ? `${handoverSlip} days after target handover (${fmtDate(p.target_handover_date, { year: false })})` : `Target handover ${fmtDate(p.target_handover_date, { year: false })}`) : "No target handover date"} />
        <Stat label="Open tasks" value={openTasks.length} hint={`${openTasks.filter((t) => t.due_date && t.due_date < today).length} overdue · ${openTasks.filter((t) => !t.assigned_to).length} unassigned`} tone={openTasks.some((t) => t.due_date && t.due_date < today) ? "red" : undefined} />
        <Stat label="Open blockers" value={blockers.length} tone={blockers.length ? "amber" : undefined} hint={blockers.length ? blockers.map((b) => DELAY_LABEL[b.delay_type]).filter((v, i, a) => a.indexOf(v) === i).join(", ") : "Nothing blocking work"} />
      </div>

      {rootCauses.length > 0 && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Delay impact</div>
          <ul className="mt-1 space-y-0.5">
            {rootCauses.map((s) => {
              const pr = proj.get(s.id)!;
              const down = downstreamOf(s.id, deps).filter((x) => (proj.get(x)?.slip ?? 0) > 0);
              return (
                <li key={s.id}>
                  <b>{s.name}</b> {s.status === "not_started" ? "has not started on time" : "is running past its planned end"} and is now expected to finish {fmtDate(pr.end, { year: false })} ({pr.slip} day{pr.slip > 1 ? "s" : ""} late).
                  {s.delay_type && <> Cause: {DELAY_LABEL[s.delay_type]}.</>}
                  {down.length > 0 && <> This pushes {down.length} later stage{down.length > 1 ? "s" : ""}{handoverSlip > 0 ? ` and the handover by ${handoverSlip} days` : ""}.</>}
                </li>
              );
            })}
          </ul>
          {p.can_manage && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium underline">Move the affected stages to the expected dates…</summary>
              <ActionForm action={applyProjectionAction} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="project_id" value={p.id} />
                <div className="min-w-64 flex-1"><label className="label">Reason (kept in the history)</label><input name="reason" required minLength={3} maxLength={500} className="input" placeholder="e.g. Laminate delivery from vendor slipped by a week" /></div>
                <Submit className="btn-ghost" pendingText="Updating…">Update the schedule</Submit>
              </ActionForm>
            </details>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-line">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={href(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === k ? "border-brand font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>{label}</Link>
        ))}
      </div>

      <div className={`mt-5 grid gap-5 ${wide ? "" : "xl:grid-cols-[1fr_340px]"}`}>
        <div className="min-w-0 space-y-5">
          {stages.length === 0 && (
            <Section title="Set up the schedule">
              {p.can_manage ? (
                <div className="p-4">
                  <p className="text-sm text-ink-2">Start from your {templateStageCount} default stages (Project onboarding → Handover), one after another, each waiting for the one before. You can remove the ones this project doesn&apos;t need and change any date afterwards.</p>
                  <ActionForm action={applyTemplateAction} className="mt-4 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="project_id" value={p.id} />
                    <div><label className="label">Work starts on</label><input type="date" name="start_date" required defaultValue={p.expected_start_date ?? today} className="input" /></div>
                    <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="with_tasks" defaultChecked /> Also add the standard tasks for each stage, assigned by role</label>
                    <Submit pendingText="Setting up…">Set up default stages</Submit>
                  </ActionForm>
                  <p className="mt-3 text-xs text-ink-3">Or add stages one at a time below. Default stages and standard tasks are edited under <Link href="/m/settings" className="underline">Settings</Link>.</p>
                </div>
              ) : <div className="p-4"><Empty title="No schedule yet" /></div>}
            </Section>
          )}

          {stages.length > 0 && view === "list" && (
            <Section title="Stages" action={<span className="text-xs text-ink-3">Click a stage to update it</span>}>
              <div className="divide-y divide-line">
                {stages.map((s, i) => (
                  <StageItem key={s.id} s={s} index={i} count={stages.length} pr={proj.get(s.id)} name={name} deps={deps} stages={stages}
                    tasks={tasks.filter((t) => t.stage_id === s.id)} canManage={p.can_manage} projectId={p.id} today={today} />
                ))}
              </div>
            </Section>
          )}

          {stages.length > 0 && view === "gantt" && (
            <Section title="Timeline">
              <Gantt
                today={today}
                endMarker={{ date: p.target_handover_date, label: "Target handover" }}
                rows={stages.filter((s) => s.status !== "skipped").map((s) => {
                  const x = proj.get(s.id);
                  return {
                    id: s.id, label: s.name, status: s.status, milestone: s.is_milestone, pct: s.completion_pct, slip: x?.slip,
                    sub: `${fmtDate(x?.start ?? s.start_date, { year: false })} – ${fmtDate(x?.end ?? s.planned_end_date, { year: false })}${s.task_count ? ` · ${s.tasks_done}/${s.task_count} tasks` : ""}`,
                    start: s.start_date, end: s.planned_end_date, projStart: x?.start, projEnd: x?.end, href: `${href("list")}#stage-${s.id}`,
                  };
                })}
              />
            </Section>
          )}

          {stages.length > 0 && view === "calendar" && (
            <Section title="Calendar">
              <CalendarMonth
                month={/^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7)}
                today={today}
                hrefFor={(m) => `/m/projects/${p.id}/schedule?view=calendar&month=${m}`}
                items={calendarItems(stages, tasks, proj, today, p.id)}
              />
            </Section>
          )}

          {stages.length > 0 && view === "milestones" && (
            <Section title="Milestones">
              {stages.filter((s) => s.is_milestone).length === 0 ? <div className="p-4"><Empty title="No milestones marked">Open a stage and tick “Milestone” (e.g. Design finalisation, Handover).</Empty></div> : (
                <ol className="divide-y divide-line">
                  {stages.filter((s) => s.is_milestone).map((s) => {
                    const x = proj.get(s.id);
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <span className={`h-3 w-3 rotate-45 ${s.status === "completed" ? "bg-emerald-500" : (x?.slip ?? 0) > 0 ? "bg-red-500" : "bg-ink"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{s.name}</div>
                          <div className="text-xs text-ink-3">
                            {s.status === "completed" ? `Completed ${fmtDate(s.actual_end_date)}` : <>Planned {fmtDate(s.planned_end_date)}{(x?.slip ?? 0) > 0 && <span className="text-red-600"> · now expected {fmtDate(x!.end)} (+{x!.slip} days)</span>}</>}
                          </div>
                        </div>
                        <Badge tone={STAGE_TONE[s.status]}>{STAGE_STATUS_LABEL[s.status]}</Badge>
                        {!s.client_visible && <Badge>Team only</Badge>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>
          )}

          {tasks.filter((t) => !t.stage_id).length > 0 && (
            <Section title="Tasks not linked to a stage">
              <ul className="divide-y divide-line">{tasks.filter((t) => !t.stage_id).map((t) => <TaskRow key={t.id} t={t} base="/m" showProject={false} showAssignee />)}</ul>
            </Section>
          )}

          {p.can_manage && (
            <Section title="Add a stage">
              <ActionForm action={addStageAction} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_150px_150px]" resetOnSuccess>
                <input type="hidden" name="project_id" value={p.id} />
                <div><label className="label">Stage name</label><input name="name" required maxLength={120} className="input" placeholder="e.g. Balcony deck" list="stage-names" /></div>
                <div><label className="label">Start</label><input type="date" name="start_date" className="input" /></div>
                <div><label className="label">Planned end</label><input type="date" name="planned_end_date" className="input" /></div>
                <div className="sm:col-span-2 lg:col-span-2"><label className="label">Place it after</label>
                  <select name="after" className="input" defaultValue={stages.at(-1)?.id ?? ""}>
                    <option value="">At the start</option>
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col justify-end gap-1 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="depends" defaultChecked /> Waits for that stage</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="is_milestone" /> Milestone</label>
                </div>
                <div className="flex justify-end sm:col-span-2 lg:col-span-3"><Submit>Add stage</Submit></div>
              </ActionForm>
            </Section>
          )}
        </div>

        <div className={wide ? "grid items-start gap-5 lg:grid-cols-3" : "space-y-5"}>
          <Section title={`Open blockers (${blockers.length})`}>
            <BlockerList blockers={blockers} base="/m" />
            <details className="border-t border-line">
              <summary className="cursor-pointer px-4 py-2.5 text-xs text-brand">+ Record a site blocker</summary>
              <div className="px-4 pb-4"><RaiseBlockerForm projectId={p.id} stages={stages.map((s) => ({ id: s.id, name: s.name }))} /></div>
            </details>
          </Section>

          <Section title="Schedule history">
            {changes.length === 0 ? <p className="p-4 text-sm text-ink-3">No dates or assignments have moved yet.</p> : (
              <ul className="divide-y divide-line">
                {changes.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-xs">
                    <div className="text-ink"><span className="font-medium">{c.entity_name ?? "Item"}</span> · {c.change === "assignee" ? "reassigned" : c.change === "due_date" ? "deadline moved" : "dates moved"}</div>
                    <div className="text-ink-2">{c.old_value} → {c.new_value}</div>
                    {c.reason && <div className="text-ink-3">“{c.reason}”</div>}
                    <div className="text-ink-3">{c.by_name ?? "System"} · {fmtDateTime(c.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Delay causes">
            <ul className="space-y-2 p-4 text-xs text-ink-2">
              {Object.entries(DELAY_LABEL).map(([k, v]) => <li key={k}><b className="text-ink">{v}</b> · {DELAY_HINT[k]}</li>)}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-3">A delay is never put against a person automatically. Causes are chosen by the team when they record it.</p>
          </Section>
        </div>
      </div>
      <datalist id="stage-names">{["Project onboarding", "Site measurement", "Design development", "Design finalisation", "Material finalisation", "Civil work", "Electrical and plumbing", "False ceiling", "Painting and wall finishes", "Carpentry", "Kitchen installation", "Wardrobe installation", "Furniture and lighting", "Client-supplied item installation", "Final finishing", "Snag rectification", "Handover"].map((n) => <option key={n} value={n} />)}</datalist>
    </>
  );
}

function calendarItems(stages: Row[], tasks: Row[], proj: ReturnType<typeof project>, today: string, pid: string): CalItem[] {
  const out: CalItem[] = [];
  for (const s of stages) {
    if (s.status === "skipped") continue;
    const x = proj.get(s.id);
    const start = x?.start ?? s.start_date;
    const end = s.status === "completed" ? s.actual_end_date : x?.end ?? s.planned_end_date;
    const link = `/m/projects/${pid}/schedule#stage-${s.id}`;
    if (s.is_milestone && end) { out.push({ date: end, label: `◆ ${s.name}`, tone: s.status === "completed" ? "done" : "milestone", href: link }); continue; }
    if (start) out.push({ date: start, label: `▶ ${s.name} starts`, tone: s.status === "completed" ? "done" : "stage", href: link });
    if (end && end !== start) out.push({ date: end, label: `■ ${s.name} ends`, tone: s.status === "completed" ? "done" : (x?.slip ?? 0) > 0 ? "overdue" : "stage", href: link });
  }
  for (const t of tasks) {
    if (!t.due_date || t.status === "cancelled") continue;
    out.push({ date: t.due_date, label: `${t.title}${t.assignee_name ? ` · ${t.assignee_name.split(" ")[0]}` : ""}`, href: `/m/tasks/${t.id}`,
      tone: t.status === "completed" ? "done" : t.due_date < today ? "overdue" : "task" });
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function StageItem({ s, index, count, pr, name, deps, stages, tasks, canManage, projectId, today }: {
  s: Row; index: number; count: number; pr: any; name: Map<string, string>; deps: Row[]; stages: Row[]; tasks: Row[];
  canManage: boolean; projectId: string; today: string;
}) {
  const waitsFor = deps.filter((d) => d.stage_id === s.id);
  const others = stages.filter((x) => x.id !== s.id && !waitsFor.some((d) => d.depends_on_stage_id === x.id));
  const slip = pr?.slip ?? 0;
  const overdue = !["completed", "skipped"].includes(s.status) && s.planned_end_date && s.planned_end_date < today;
  return (
    <details id={`stage-${s.id}`} className="group">
      <summary className="grid cursor-pointer list-none grid-cols-[24px_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-canvas/60 sm:grid-cols-[24px_1fr_170px_110px_120px]">
        <span className="text-xs text-ink-3 tabular-nums">{index + 1}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className="text-ink-3 transition group-open:rotate-90">›</span>
            <span className={s.status === "skipped" ? "text-ink-3 line-through" : ""}>{s.name}</span>
            {s.is_milestone && <span title="Milestone" className="inline-block h-2 w-2 rotate-45 bg-ink" />}
            {!s.client_visible && <Badge>Team only</Badge>}
          </div>
          <div className="pl-3 text-xs text-ink-3">
            {waitsFor.length > 0 && <>After {waitsFor.map((d) => name.get(d.depends_on_stage_id)).join(", ")} · </>}
            {s.task_count ? `${s.tasks_done}/${s.task_count} tasks done` : "No tasks yet"}
            {s.assigned_team ? ` · ${s.assigned_team}` : ""}
          </div>
        </div>
        <div className="col-start-2 text-xs sm:col-start-auto">
          <div className={overdue ? "text-red-600" : "text-ink-2"}>{fmtDate(s.start_date, { year: false })} – {fmtDate(s.planned_end_date, { year: false })}</div>
          {s.status === "completed" ? <div className="text-emerald-700">Done {fmtDate(s.actual_end_date, { year: false })}</div>
            : slip > 0 ? <div className="text-red-600">Expected {fmtDate(pr.end, { year: false })} (+{slip}d)</div>
            : s.start_date && s.status === "not_started" ? <div className="text-ink-3">starts {relDay(s.start_date)}</div> : null}
        </div>
        <div className="hidden sm:block">
          <div className="h-1.5 rounded-full bg-canvas"><div className={`h-1.5 rounded-full ${s.status === "completed" ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${s.completion_pct}%` }} /></div>
          <div className="mt-0.5 text-[11px] text-ink-3">{s.completion_pct}%</div>
        </div>
        <div className="col-start-3 row-start-1 flex flex-wrap justify-end gap-1 sm:col-start-auto sm:row-start-auto">
          <Badge tone={STAGE_TONE[s.status]}>{STAGE_STATUS_LABEL[s.status]}</Badge>
          {s.status === "delayed" && <DelayBadge type={s.delay_type} />}
        </div>
      </summary>

      <div className="grid gap-5 border-t border-line bg-canvas/40 p-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0 space-y-4">
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-sm font-semibold">Tasks in this stage</h3>
              {canManage && <Link href={`/m/tasks/new?project=${projectId}&stage=${s.id}`} className="text-xs text-brand hover:underline">+ Add task</Link>}
            </div>
            {tasks.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">No tasks yet.</p> : <ul className="divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} t={t} base="/m" showProject={false} showAssignee />)}</ul>}
            {canManage && s.template_tasks > 0 && (
              <ActionForm action={addTemplateTasksAction} className="border-t border-line px-4 py-2.5">
                <input type="hidden" name="stage_id" value={s.id} />
                <Submit className="text-xs text-brand underline" pendingText="Adding…">Add the {s.template_tasks} standard task{s.template_tasks > 1 ? "s" : ""} for “{s.name}”</Submit>
              </ActionForm>
            )}
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold">Waits for</h3>
            {waitsFor.length === 0 ? <p className="text-sm text-ink-3">Nothing. This stage can start on its own date.</p> : (
              <ul className="space-y-1 text-sm">
                {waitsFor.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>{name.get(d.depends_on_stage_id)}{d.lag_days ? <span className="text-xs text-ink-3"> · then {d.lag_days} day{d.lag_days > 1 ? "s" : ""} gap</span> : null}</span>
                    {canManage && (
                      <ActionForm action={removeStageDependencyAction}><input type="hidden" name="id" value={d.id} /><Submit className="text-xs text-ink-3 hover:text-red-600" pendingText="…">Remove</Submit></ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && others.length > 0 && (
              <ActionForm action={addStageDependencyAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <input type="hidden" name="stage_id" value={s.id} />
                <div className="min-w-40 flex-1"><label className="label">Must wait for</label>
                  <select name="depends_on_stage_id" className="input">{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                <div className="w-24"><label className="label">Gap (days)</label><input type="number" name="lag_days" min={-30} max={90} defaultValue={0} className="input" /></div>
                <Submit className="btn-ghost" pendingText="…">Add</Submit>
              </ActionForm>
            )}
          </div>
        </div>

        {canManage ? (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold">Update stage</h3>
            <ActionForm action={updateStageAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={s.id} />
              <div className="sm:col-span-2"><label className="label">Name</label><input name="name" defaultValue={s.name} required maxLength={120} className="input" /></div>
              <div><label className="label">Start</label><input type="date" name="start_date" defaultValue={s.start_date ?? ""} className="input" /></div>
              <div><label className="label">Planned end</label><input type="date" name="planned_end_date" defaultValue={s.planned_end_date ?? ""} className="input" /></div>
              <div><label className="label">Status</label>
                <select name="status" defaultValue={s.status} className="input">{Object.entries(STAGE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="label">Progress %</label><input type="number" name="completion_pct" min={0} max={100} defaultValue={s.completion_pct} className="input" /></div>
              <div className="sm:col-span-2"><label className="label">Team / contractor</label><input name="assigned_team" defaultValue={s.assigned_team ?? ""} maxLength={200} className="input" placeholder="e.g. Ganesh + factory, Electrician Ramesh" /></div>
              <div><label className="label">Cause of delay (if delayed)</label>
                <select name="delay_type" defaultValue={s.delay_type ?? ""} className="input"><option value="">—</option>{Object.entries(DELAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="label">Delay note (team only)</label><input name="delay_reason" defaultValue={s.delay_reason ?? ""} maxLength={500} className="input" /></div>
              <div className="sm:col-span-2"><label className="label">What the client reads about this stage</label><textarea name="client_description" defaultValue={s.client_description ?? ""} maxLength={1000} rows={2} className="input" /></div>
              <div className="sm:col-span-2"><label className="label">Internal description</label><textarea name="description" defaultValue={s.description ?? ""} maxLength={1000} rows={2} className="input" /></div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm sm:col-span-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="client_visible" defaultChecked={s.client_visible} /> Client can see this stage</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="is_milestone" defaultChecked={s.is_milestone} /> Milestone</label>
              </div>
              <div className="rounded-md border border-line bg-canvas/60 p-3 sm:col-span-2">
                <label className="label">Reason, if you change the dates</label>
                <input name="reason" maxLength={500} className="input" placeholder="e.g. Client asked to start after Diwali" />
                <label className="mt-2 flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" name="shift_downstream" defaultChecked /> If the end moves later, move the stages that wait for this one by the same number of days</label>
              </div>
              <div className="flex justify-end sm:col-span-2"><Submit>Save stage</Submit></div>
            </ActionForm>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-xs">
              {index > 0 && <ActionForm action={moveStageAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="up" /><Submit className="text-ink-2 underline" pendingText="…">Move up</Submit></ActionForm>}
              {index < count - 1 && <ActionForm action={moveStageAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="down" /><Submit className="text-ink-2 underline" pendingText="…">Move down</Submit></ActionForm>}
              <ActionForm action={removeStageAction} confirm={`Remove the stage "${s.name}"? Its tasks are kept.`}><input type="hidden" name="id" value={s.id} /><Submit className="text-ink-3 hover:text-red-600" pendingText="…">Remove stage</Submit></ActionForm>
            </div>
          </div>
        ) : (
          <div className="card p-4 text-sm text-ink-2">
            {s.client_description && <p>{s.client_description}</p>}
            {s.status === "delayed" && <p className="mt-2">Delay: {DELAY_LABEL[s.delay_type] ?? "—"}{s.delay_reason ? ` · ${s.delay_reason}` : ""}</p>}
          </div>
        )}
      </div>
    </details>
  );
}
