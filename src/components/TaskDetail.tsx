import Link from "next/link";
import { fileUrl, fmtSize } from "@/lib/files";
import { fmtDate, fmtDateTime, PRIORITY_LABEL, relDay, TASK_STATUS_LABEL, todayIST, APPROVAL_STATUS_LABEL } from "@/lib/format";
import { MEMBER_ROLE_SHORT } from "@/lib/format";
import { ActionForm, Submit } from "./ActionForm";
import { FileInput } from "./FileInput";
import { Avatar, Badge, Field, PRIORITY_TONE, Section } from "./ui";
import { DelayBadge, TASK_TONE } from "./execution";
import { BlockerList, RaiseBlockerForm } from "./blockers";
import {
  addDependencyAction, addTaskCommentAction, cancelTaskAction, completeTaskAction, removeDependencyAction, replanTaskAction,
  reviewTaskAction, setTaskStatusAction, updateTaskDetailsAction, uploadTaskFilesAction,
} from "@/app/actions/tasks";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = { task: any; deps: any[]; dependents: any[]; comments: any[]; files: any[]; blockers: any[]; changes: any[] };
type Options = { team: any[]; stages: any[]; tasks: any[]; approvals: any[]; purchases: any[]; reviewers: any[] };

const KIND = { task: "Task", approval: "Client approval", purchase: "Client purchase" } as Record<string, string>;
const STATUS_CHOICES = ["not_started", "in_progress", "waiting_client", "waiting_vendor"] as const;

export function TaskDetail({ d, base, opts, meId }: { d: Detail; base: "/m" | "/e"; opts?: Options; meId: string }) {
  const t = d.task;
  const open = !["completed", "cancelled"].includes(t.status);
  const canWork = t.can_manage || t.is_assignee;
  const today = todayIST();
  const overdue = open && t.due_date && t.due_date < today;
  const images = d.files.filter((f) => f.mime_type?.startsWith("image/"));
  const docs = d.files.filter((f) => !f.mime_type?.startsWith("image/"));
  const openBlockers = d.blockers.filter((b) => !b.resolved_at).map((b) => ({ ...b, can_resolve: t.can_manage || t.is_assignee || b.raised_by === meId, age_days: Math.max(0, Math.round((Date.now() - new Date(b.created_at).getTime()) / 86_400_000)) }));
  const closedBlockers = d.blockers.filter((b) => b.resolved_at);
  const unmet = d.deps.filter((x) => !x.met);

  return (
    <>
      <div className="mb-1 text-xs text-ink-3">
        <Link href={`${base}/tasks`} className="hover:underline">{base === "/m" ? "Tasks" : "My tasks"}</Link> /{" "}
        <Link href={base === "/m" ? `/m/projects/${t.project_id}/schedule` : `/e/projects/${t.project_id}`} className="hover:underline">{t.project_code}</Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={`text-xl font-semibold tracking-tight sm:text-2xl ${t.status === "cancelled" ? "text-ink-3 line-through" : ""}`}>{t.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <Badge tone={t.awaiting_review ? "blue" : TASK_TONE[t.status]}>{t.awaiting_review ? "Completed · awaiting review" : TASK_STATUS_LABEL[t.status]}</Badge>
            {t.status === "completed" && t.requires_review && t.reviewed_at && <Badge tone="green">Review accepted</Badge>}
            <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
            {t.status === "blocked" && <DelayBadge type={t.delay_type} />}
            <span>{t.project_name}{t.stage_name ? ` · ${t.stage_name}` : ""}</span>
          </div>
        </div>
      </div>

      {unmet.length > 0 && open && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Not ready yet. </span>
          This task waits for {unmet.map((x) => `${KIND[x.kind].toLowerCase()} “${x.label}”`).join(", ")}. {t.is_assignee ? "You'll be notified as soon as it's clear." : "The assignee is notified automatically when it's clear."}
        </div>
      )}
      {t.status === "blocked" && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span className="font-medium">Blocked: </span>{t.blocked_reason}</div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Section title="Details">
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-3">
              <Field label="Assigned to">{t.assignee_name ?? <span className="text-amber-700">Unassigned</span>}</Field>
              <Field label="Start">{fmtDate(t.start_date)}</Field>
              <Field label="Deadline"><span className={overdue ? "font-medium text-red-600" : ""}>{fmtDate(t.due_date)}</span>{t.due_date && open ? <span className="block text-xs text-ink-3">{relDay(t.due_date)}</span> : null}</Field>
              <Field label="Review">{t.requires_review ? `Needed${t.reviewer_name ? ` by ${t.reviewer_name}` : " by the project manager"}` : "Not needed"}</Field>
              <Field label="Created">{t.created_by_name ? `${t.created_by_name}, ` : ""}{fmtDate(String(new Date(t.created_at).toISOString()).slice(0, 10), { year: false })}</Field>
              <Field label="Completed">{t.completed_at ? fmtDateTime(t.completed_at) : null}</Field>
            </dl>
            {t.description && <p className="border-t border-line px-4 py-3 text-sm whitespace-pre-line text-ink-2">{t.description}</p>}
            {t.completion_notes && <div className="border-t border-line px-4 py-3 text-sm"><div className="text-xs text-ink-3">Completion notes</div><p className="whitespace-pre-line text-ink-2">{t.completion_notes}</p></div>}
          </Section>

          <Section title="Depends on" action={t.can_manage && opts ? <span className="text-xs text-ink-3">Add below</span> : null}>
            {d.deps.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">Nothing. This task can start any time.</p> : (
              <ul className="divide-y divide-line">
                {d.deps.map((x) => (
                  <li key={x.dependency_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`h-2 w-2 rounded-full ${x.met ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {x.kind === "task" ? <Link href={`${base}/tasks/${x.ref_id}`} className="hover:underline">{x.label}</Link>
                          : x.kind === "approval" && base === "/m" ? <Link href={`/m/approvals/${x.ref_id}`} className="hover:underline">{x.label}</Link> : x.label}
                      </div>
                      <div className="text-xs text-ink-3">{KIND[x.kind]} · {x.kind === "approval" ? APPROVAL_STATUS_LABEL[x.ref_status] ?? x.ref_status : x.kind === "task" ? TASK_STATUS_LABEL[x.ref_status] : x.ref_status.replace(/_/g, " ")}{x.ref_due ? ` · ${fmtDate(x.ref_due, { year: false })}` : ""}</div>
                    </div>
                    <Badge tone={x.met ? "green" : "amber"}>{x.met ? "Done" : "Waiting"}</Badge>
                    {t.can_manage && <ActionForm action={removeDependencyAction}><input type="hidden" name="id" value={x.dependency_id} /><Submit className="text-xs text-ink-3 hover:text-red-600" pendingText="…">Remove</Submit></ActionForm>}
                  </li>
                ))}
              </ul>
            )}
            {t.can_manage && opts && open && (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-2.5 text-xs text-brand">+ Add something this task waits for</summary>
                <ActionForm action={addDependencyAction} className="grid gap-3 px-4 pb-4 sm:grid-cols-3">
                  <input type="hidden" name="task_id" value={t.id} />
                  <DepSelect name="dep_task" label="Another task" items={opts.tasks.map((x) => [x.id, `${x.title} (${TASK_STATUS_LABEL[x.status]})`])} />
                  <DepSelect name="dep_approval" label="Client approval" items={opts.approvals.map((x) => [x.id, `${x.title} (${APPROVAL_STATUS_LABEL[x.status]})`])} />
                  <DepSelect name="dep_purchase" label="Client purchase" items={opts.purchases.map((x) => [x.id, `${x.item_name} (${x.status.replace(/_/g, " ")})`])} />
                  <div className="flex justify-end sm:col-span-3"><Submit className="btn-ghost">Add dependency</Submit></div>
                </ActionForm>
              </details>
            )}
            {d.dependents.length > 0 && (
              <div className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
                Waiting for this task: {d.dependents.map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link href={`${base}/tasks/${x.id}`} className="text-brand hover:underline">{x.title}</Link>{x.assignee_name ? ` (${x.assignee_name})` : ""}</span>)}
              </div>
            )}
          </Section>

          <Section title={`Photos & documents (${d.files.length})`}>
            {d.files.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">No files yet. Site photos and drawings for this task go here.</p> : (
              <div className="space-y-3 p-4">
                {images.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {images.map((f) => (
                      <a key={f.id} href={fileUrl(f.storage_path)} target="_blank" rel="noopener" className="group relative block aspect-square overflow-hidden rounded-md border border-line bg-canvas">
                        <img src={fileUrl(f.storage_path)} alt={f.file_name} className="h-full w-full object-cover transition group-hover:scale-105" />
                        {f.is_completion_evidence && <span className="absolute top-1 left-1 rounded bg-emerald-600 px-1 text-[10px] text-white">Evidence</span>}
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1.5 py-0.5 text-[10px] text-white">{f.uploaded_by_name} · {fmtDate(String(new Date(f.created_at).toISOString()).slice(0, 10), { year: false })}</span>
                      </a>
                    ))}
                  </div>
                )}
                {docs.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {docs.map((f) => <li key={f.id}><a href={fileUrl(f.storage_path)} target="_blank" rel="noopener" className="text-brand hover:underline">{f.file_name}</a> <span className="text-xs text-ink-3">· {fmtSize(Number(f.size_bytes))} · {f.uploaded_by_name}{f.is_completion_evidence ? " · completion evidence" : ""}</span></li>)}
                  </ul>
                )}
              </div>
            )}
            {t.status !== "cancelled" && (
              <ActionForm action={uploadTaskFilesAction} className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3" resetOnSuccess>
                <input type="hidden" name="task_id" value={t.id} />
                <div className="min-w-56 flex-1"><FileInput name="files" label="Add photos or documents" /></div>
                <Submit className="btn-ghost" pendingText="Uploading…">Upload</Submit>
              </ActionForm>
            )}
          </Section>

          <Section title={`Comments (${d.comments.length})`}>
            {d.comments.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">No comments yet.</p> : (
              <ul className="divide-y divide-line">
                {d.comments.map((c) => (
                  <li key={c.id} className="flex gap-3 px-4 py-3">
                    <Avatar name={c.author} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-ink-3"><span className="font-medium text-ink">{c.author}</span> · {fmtDateTime(c.created_at)}</div>
                      <p className="mt-0.5 text-sm whitespace-pre-line text-ink-2">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addTaskCommentAction} className="grid gap-2 border-t border-line px-4 py-3" resetOnSuccess>
              <input type="hidden" name="task_id" value={t.id} />
              <textarea name="body" required maxLength={2000} rows={2} className="input" placeholder="Write an update or question for the team" />
              <div className="flex justify-end"><Submit pendingText="Posting…">Post comment</Submit></div>
            </ActionForm>
          </Section>

          {(openBlockers.length > 0 || closedBlockers.length > 0) && (
            <Section title="Blockers">
              <BlockerList blockers={[...openBlockers, ...closedBlockers]} base={base} />
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {t.awaiting_review && t.can_manage && (
            <Section title="Review this work">
              <ActionForm action={reviewTaskAction} className="grid gap-3 p-4">
                <input type="hidden" name="id" value={t.id} />
                <textarea name="note" maxLength={1000} rows={2} className="input" placeholder="Note (needed if you send it back)" />
                <div className="flex flex-wrap justify-end gap-2">
                  <Submit name="decision" value="return" className="btn-ghost" pendingText="…">Send back for rework</Submit>
                  <Submit name="decision" value="accept" pendingText="…">Accept</Submit>
                </div>
              </ActionForm>
            </Section>
          )}

          {open && canWork && t.status !== "blocked" && (
            <Section title="Update progress">
              <ActionForm action={setTaskStatusAction} className="flex flex-wrap items-end gap-2 p-4">
                <input type="hidden" name="id" value={t.id} />
                <div className="min-w-40 flex-1"><label className="label">Status</label>
                  <select name="status" defaultValue={STATUS_CHOICES.includes(t.status) ? t.status : "in_progress"} className="input">
                    {STATUS_CHOICES.map((k) => <option key={k} value={k}>{TASK_STATUS_LABEL[k]}</option>)}
                  </select></div>
                <Submit className="btn-ghost">Update</Submit>
              </ActionForm>
              <ActionForm action={completeTaskAction} className="grid gap-3 border-t border-line p-4">
                <input type="hidden" name="id" value={t.id} />
                <h3 className="text-sm font-semibold">Mark complete</h3>
                <textarea name="notes" maxLength={2000} rows={2} className="input" placeholder="What was done (optional)" />
                <FileInput name="evidence" label="Completion evidence: photos or documents" />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-3">{t.requires_review ? "Goes to your manager for review." : "Your manager is notified."}</span>
                  <Submit pendingText="Saving…">Mark complete</Submit>
                </div>
              </ActionForm>
            </Section>
          )}

          {open && (
            <Section title={t.status === "blocked" ? "Another blocker?" : "Something stopping this task?"}>
              <div className="p-4"><RaiseBlockerForm taskId={t.id} /></div>
            </Section>
          )}

          {t.can_manage && opts && (
            <Section title="Plan: person, dates, priority">
              <ActionForm action={replanTaskAction} className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1">
                <input type="hidden" name="id" value={t.id} />
                <div><label className="label">Assigned to</label>
                  <select name="assigned_to" defaultValue={t.assigned_to ?? ""} className="input"><option value="">Unassigned</option>{opts.team.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {MEMBER_ROLE_SHORT[m.member_role]}</option>)}</select></div>
                <div><label className="label">Reviewer</label>
                  <select name="reviewer_id" defaultValue={t.reviewer_id ?? ""} className="input"><option value="">Project manager</option>{opts.reviewers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></div>
                <div><label className="label">Start</label><input type="date" name="start_date" defaultValue={t.start_date ?? ""} className="input" /></div>
                <div><label className="label">Deadline</label><input type="date" name="due_date" defaultValue={t.due_date ?? ""} className="input" /></div>
                <div><label className="label">Priority</label>
                  <select name="priority" defaultValue={t.priority} className="input">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="sm:col-span-2 xl:col-span-1"><label className="label">Reason (needed if the deadline or person changes)</label><input name="reason" maxLength={500} className="input" placeholder="e.g. Ganesh is on the Kothrud site this week" /></div>
                <div className="flex justify-end sm:col-span-2 xl:col-span-1"><Submit>Save plan</Submit></div>
              </ActionForm>
            </Section>
          )}

          {t.can_manage && opts && (
            <Section title="Edit task">
              <ActionForm action={updateTaskDetailsAction} className="grid gap-3 p-4">
                <input type="hidden" name="id" value={t.id} />
                <div><label className="label">Title</label><input name="title" defaultValue={t.title} required maxLength={200} className="input" /></div>
                <div><label className="label">Stage</label>
                  <select name="stage_id" defaultValue={t.stage_id ?? ""} className="input"><option value="">No stage</option>{opts.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                <div><label className="label">Description</label><textarea name="description" defaultValue={t.description ?? ""} maxLength={4000} rows={3} className="input" /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requires_review" defaultChecked={t.requires_review} /> Needs a manager&apos;s review when completed</label>
                <div className="flex justify-end"><Submit className="btn-ghost">Save</Submit></div>
              </ActionForm>
              {t.status !== "cancelled" && (
                <details className="border-t border-line">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs text-ink-3 hover:text-red-600">Cancel this task…</summary>
                  <ActionForm action={cancelTaskAction} className="flex flex-wrap gap-2 px-4 pb-4">
                    <input type="hidden" name="id" value={t.id} />
                    <input name="reason" required minLength={3} maxLength={500} className="input min-w-48 flex-1 py-1 text-xs" placeholder="Reason, e.g. client dropped the study unit" />
                    <Submit className="btn-danger px-2 py-1 text-xs" pendingText="…">Cancel task</Submit>
                  </ActionForm>
                </details>
              )}
            </Section>
          )}

          {d.changes.length > 0 && (
            <Section title="Changes to the plan">
              <ul className="divide-y divide-line">
                {d.changes.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-xs">
                    <div className="text-ink">{c.change === "assignee" ? "Reassigned" : "Deadline moved"}: {c.old_value} → {c.new_value}</div>
                    {c.reason && <div className="text-ink-3">“{c.reason}”</div>}
                    <div className="text-ink-3">{c.by_name ?? "System"} · {fmtDateTime(c.created_at)}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function DepSelect({ name, label, items }: { name: string; label: string; items: [string, string][] }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select name={name} className="input" defaultValue="">
        <option value="">—</option>
        {items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
