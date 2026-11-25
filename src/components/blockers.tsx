import Link from "next/link";
import { DELAY_HINT, DELAY_LABEL, fmtDateTime } from "@/lib/format";
import { ActionForm, Submit } from "./ActionForm";
import { DelayBadge } from "./execution";
import { raiseBlockerAction, resolveBlockerAction } from "@/app/actions/tasks";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Open (and optionally resolved) blockers, with a resolve box where allowed. */
export function BlockerList({ blockers, base, showProject = false }: { blockers: any[]; base: "/m" | "/e"; showProject?: boolean }) {
  if (!blockers.length) return <p className="p-4 text-sm text-ink-3">Nothing is blocking work.</p>;
  return (
    <ul className="divide-y divide-line">
      {blockers.map((b) => (
        <li key={b.id} className={`px-4 py-3 text-sm ${b.resolved_at ? "bg-gray-50/70" : ""}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <DelayBadge type={b.delay_type} />
            {b.resolved_at ? <span className="text-xs text-emerald-700">Resolved</span>
              : <span className={`text-xs ${b.age_days > 2 ? "font-medium text-red-600" : "text-ink-3"}`}>{b.age_days === 0 ? "raised today" : `open ${b.age_days} day${b.age_days > 1 ? "s" : ""}`}</span>}
          </div>
          <div className={`mt-1 ${b.resolved_at ? "text-ink-3" : "text-ink"}`}>{b.description}</div>
          <div className="mt-0.5 text-xs text-ink-3">
            {showProject && <>{b.project_name} · </>}
            {b.task_id ? <>Task: <Link href={`${base}/tasks/${b.task_id}`} className="text-brand hover:underline">{b.task_title}</Link></> : b.stage_name ? <>Stage: {b.stage_name}</> : "Site / project"}
            {" · "}{b.raised_by_name}, {fmtDateTime(b.created_at)}
          </div>
          {b.resolved_at && <div className="mt-0.5 text-xs text-ink-3">Resolved by {b.resolved_by_name}, {fmtDateTime(b.resolved_at)}{b.resolution_note ? ` · “${b.resolution_note}”` : ""}</div>}
          {!b.resolved_at && b.can_resolve !== false && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-brand">Mark resolved</summary>
              <ActionForm action={resolveBlockerAction} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={b.id} />
                <input name="note" maxLength={1000} className="input min-w-48 flex-1 py-1 text-xs" placeholder="What was done, e.g. laminate delivered today" />
                <Submit className="btn-ghost px-2 py-1 text-xs" pendingText="…">Resolve</Submit>
              </ActionForm>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DelayTypeSelect({ name = "delay_type" }: { name?: string }) {
  return (
    <select name={name} required defaultValue="" className="input">
      <option value="" disabled>Choose the cause…</option>
      {Object.entries(DELAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v} · {DELAY_HINT[k]}</option>)}
    </select>
  );
}

/** Flag a blocker on a task, or on the project / a stage. */
export function RaiseBlockerForm({ projectId, taskId, stages, projects }: {
  projectId?: string; taskId?: string; stages?: { id: string; name: string }[]; projects?: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={raiseBlockerAction} className="grid gap-3" resetOnSuccess>
      {projectId && <input type="hidden" name="project_id" value={projectId} />}
      {taskId && <input type="hidden" name="task_id" value={taskId} />}
      {projects && (
        <div><label className="label">Project</label>
          <select name="project_id" required className="input" defaultValue="">
            <option value="" disabled>Choose…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
      )}
      {stages && stages.length > 0 && (
        <div><label className="label">Stage (optional)</label>
          <select name="stage_id" className="input" defaultValue=""><option value="">Whole site / project</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      )}
      <div><label className="label">Cause</label><DelayTypeSelect /></div>
      <div><label className="label">What is blocking the work?</label>
        <textarea name="description" required minLength={3} maxLength={1000} rows={3} className="input" placeholder="e.g. Plumber has not come for 2 days; bathroom tiling can't start" /></div>
      <div className="flex justify-end"><Submit pendingText="Flagging…">Flag blocker</Submit></div>
    </ActionForm>
  );
}
