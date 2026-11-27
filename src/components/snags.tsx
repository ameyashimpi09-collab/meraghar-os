import Link from "next/link";
import { fileUrl } from "@/lib/files";
import { AREAS, fmtDateTime, PRIORITY_LABEL } from "@/lib/format";
import { MEMBER_ROLE_LABEL, ROLE_LABEL, type AppRole } from "@/lib/roles";
import { SNAG_CATEGORY_LABEL, SNAG_EVENT_LABEL, SNAG_STATUS_LABEL, SNAG_TONE } from "@/lib/release4";
import { raiseSnagAction, snagCommentAction, snagStepAction } from "@/app/actions/snags";
import { ActionForm, Submit } from "./ActionForm";
import { FileInput } from "./FileInput";
import { Badge, Empty, Field, PRIORITY_TONE, Section } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export function snagStateLabel(s: R) {
  if (s.status === "in_progress" && s.resolution_submitted_at) return { label: "Fix to check", tone: "amber" as const };
  return { label: SNAG_STATUS_LABEL[s.status], tone: SNAG_TONE[s.status] };
}

export function SnagRows({ rows, base, empty }: { rows: R[]; base: "/m" | "/e"; empty: React.ReactNode }) {
  if (!rows.length) return <div className="p-4">{empty}</div>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => {
        const st = snagStateLabel(s);
        return (
          <li key={s.id}>
            <Link href={`${base}/snags/${s.id}`} className="flex gap-3 px-4 py-3 hover:bg-canvas">
              <div className="flex h-14 w-16 shrink-0 overflow-hidden rounded bg-canvas">
                {s.thumb ? <img src={fileUrl(s.thumb)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="m-auto text-[10px] text-ink-3">No photo</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {s.urgency && <Badge tone={PRIORITY_TONE[s.urgency]}>{PRIORITY_LABEL[s.urgency]}</Badge>}
                  <span className="text-xs text-ink-3">{SNAG_CATEGORY_LABEL[s.category]} · {s.area ?? "—"}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-ink">{s.description}</div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {s.project_name} · raised by {s.raised_by_name}{s.raised_by_role === "client" ? " (client)" : ""} · {s.age_days === 0 ? "today" : `${s.age_days} day${s.age_days === 1 ? "" : "s"} ago`} · {s.assignee_name ? `with ${s.assignee_name}` : <span className="text-amber-700">not assigned</span>}
                  {s.reopen_count > 0 ? ` · reopened ${s.reopen_count}×` : ""}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Photos({ files }: { files: R[] }) {
  if (!files.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {files.map((f) => (
        <li key={f.id}>
          <a href={fileUrl(f.storage_path)} target="_blank" className="block overflow-hidden rounded border border-line bg-canvas">
            {(f.mime_type ?? "image/").startsWith("image/") ? <img src={fileUrl(f.storage_path)} alt="" className="aspect-square w-full object-cover" loading="lazy" /> : <div className="flex aspect-square items-center justify-center p-2 text-center text-xs text-ink-3">{f.file_name ?? "PDF"}</div>}
          </a>
          <div className="mt-0.5 truncate text-[11px] text-ink-3">{f.by_name} · {fmtDateTime(f.created_at)}</div>
        </li>
      ))}
    </ul>
  );
}

/** Everything about one concern, for the project manager or the assigned team member. */
export function SnagDetail({ d, base, team }: { d: { snag: R; files: R[]; comments: R[]; events: R[] }; base: "/m" | "/e"; team: R[] }) {
  const s = d.snag;
  const st = snagStateLabel(s);
  const report = d.files.filter((f) => f.kind === "report");
  const fixes = d.files.filter((f) => f.kind === "resolution");
  const open = !["resolved", "awaiting_client_confirmation"].includes(s.status);
  const canWork = s.can_manage || s.is_assignee;
  const timeline = [
    ...d.events.map((e) => ({ at: e.created_at, kind: "event" as const, e })),
    ...d.comments.map((c) => ({ at: c.created_at, kind: "comment" as const, c })),
  ].sort((a, b) => +new Date(a.at) - +new Date(b.at));

  return (
    <>
      <div className="mb-1 text-xs text-ink-3">
        <Link href={`${base}/snags`} className="hover:underline">Snags</Link> / <Link href={`${base}/projects/${s.project_id}`} className="hover:underline">{s.project_code}</Link>
      </div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{SNAG_CATEGORY_LABEL[s.category]} · {s.area ?? "Home"}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <Badge tone={st.tone}>{st.label}</Badge>
          {s.urgency && <Badge tone={PRIORITY_TONE[s.urgency]}>{PRIORITY_LABEL[s.urgency]}</Badge>}
          <span>{s.project_name}</span>
          {s.reopen_count > 0 && <Badge tone="red">Reopened {s.reopen_count}×</Badge>}
        </div>
      </div>

      {s.resolution_submitted_at && s.status === "in_progress" && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>Fix submitted</b> {fmtDateTime(s.resolution_submitted_at)}: {s.resolution_note} {s.can_manage ? "Check the photos below and accept or send it back." : "Waiting for the project manager to check."}
        </div>
      )}
      {s.status === "awaiting_client_confirmation" && <div className="mb-5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">Resolved and waiting for the client to confirm (or reopen).</div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Section title="The concern">
            <div className="space-y-4 p-4">
              <p className="whitespace-pre-line text-ink">{s.description}</p>
              <Photos files={report} />
              <dl className="grid gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3">
                <Field label="Raised by">{s.raised_by_name}{s.raised_by_role === "client" ? " (client)" : ""}</Field>
                <Field label="Raised on">{fmtDateTime(s.created_at)}</Field>
                <Field label="Assigned to">{s.assignee_name ?? <span className="text-amber-700">Not assigned</span>}</Field>
              </dl>
            </div>
          </Section>

          <Section title={`Resolution photos (${fixes.length})`}>
            <div className="space-y-3 p-4">
              {fixes.length ? <Photos files={fixes} /> : <p className="text-sm text-ink-3">None yet. The person fixing it adds photos of the finished work.</p>}
              {s.resolution_note && <p className="text-sm text-ink-2"><span className="text-ink-3">Note: </span>{s.resolution_note}</p>}
            </div>
          </Section>

          <Section title="History and messages">
            <ol className="divide-y divide-line">
              {timeline.map((t, i) => t.kind === "event" ? (
                <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-3/50" />
                  <div><span className="font-medium">{SNAG_EVENT_LABEL[t.e.event] ?? t.e.event}</span>{t.e.note ? <span className="text-ink-2">: {t.e.note}</span> : null}
                    <div className="text-xs text-ink-3">{t.e.actor_name ?? "System"} · {fmtDateTime(t.e.created_at)}{!t.e.client_visible ? " · team only" : ""}</div></div>
                </li>
              ) : (
                <li key={i} className={`px-4 py-3 text-sm ${t.c.is_internal ? "bg-sky-50/50" : ""}`}>
                  <div className="text-xs text-ink-3"><b className="text-ink-2">{t.c.author_name}</b> · {ROLE_LABEL[t.c.author_role as AppRole]} · {fmtDateTime(t.c.created_at)}{t.c.is_internal ? " · team only" : ""}</div>
                  <p className="mt-0.5 whitespace-pre-line text-ink">{t.c.body}</p>
                </li>
              ))}
            </ol>
            <ActionForm action={snagCommentAction} className="space-y-2 border-t border-line p-4" resetOnSuccess>
              <input type="hidden" name="snag_id" value={s.id} />
              <textarea name="body" rows={2} className="input" placeholder="Write a message…" required />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="internal" defaultChecked /> Team only (the client won&apos;t see it)</label>
                <Submit className="btn-ghost" pendingText="Sending…">Send</Submit>
              </div>
            </ActionForm>
          </Section>
        </div>

        <div className="space-y-5">
          {s.can_manage && open && (
            <Section title="Assign">
              <ActionForm action={snagStepAction} className="space-y-2 p-4">
                <input type="hidden" name="snag_id" value={s.id} />
                <select name="assignee" defaultValue={s.assigned_to ?? ""} className="input" aria-label="Assign to">
                  <option value="">Choose a team member…</option>
                  {team.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {MEMBER_ROLE_LABEL[m.member_role]}</option>)}
                </select>
                <textarea name="note" rows={2} className="input" placeholder="Instructions (team only, optional)" />
                <div className="flex flex-wrap gap-2">
                  <Submit name="step" value="assign">{s.assigned_to ? "Reassign" : "Assign"}</Submit>
                  {["open", "reopened"].includes(s.status) && <Submit name="step" value="review" className="btn-ghost">Mark under review</Submit>}
                </div>
              </ActionForm>
            </Section>
          )}

          {canWork && open && !s.resolution_submitted_at && (
            <Section title="Fix it">
              <div className="space-y-3 p-4">
                {["assigned", "reopened", "under_review", "open"].includes(s.status) && s.is_assignee && (
                  <ActionForm action={snagStepAction}><input type="hidden" name="snag_id" value={s.id} /><Submit name="step" value="start" className="btn-ghost">Start work</Submit></ActionForm>
                )}
                {s.assigned_to && (
                  <ActionForm action={snagStepAction} className="space-y-2">
                    <input type="hidden" name="snag_id" value={s.id} />
                    <FileInput name="photos" label="Photos of the finished work" />
                    <textarea name="note" rows={2} className="input" placeholder="What was done to fix it" required />
                    <Submit name="step" value="submit" pendingText="Submitting…">Submit fix for checking</Submit>
                  </ActionForm>
                )}
                {!s.assigned_to && <p className="text-sm text-ink-3">Assign it to someone first.</p>}
              </div>
            </Section>
          )}

          {s.can_manage && open && (
            <Section title="Resolve">
              <ActionForm action={snagStepAction} className="space-y-2 p-4">
                <input type="hidden" name="snag_id" value={s.id} />
                {!fixes.length && <FileInput name="photos" label="Resolution photo (needed)" />}
                <textarea name="note" rows={2} className="input" placeholder={s.resolution_submitted_at ? "Note for the client (optional) or what still needs doing" : "Note for the client (optional)"} />
                <div className="flex flex-wrap gap-2">
                  <Submit name="step" value="accept" pendingText="Saving…">Mark resolved</Submit>
                  {s.resolution_submitted_at && <Submit name="step" value="send_back" className="btn-ghost">Send back</Submit>}
                </div>
                <p className="text-xs text-ink-3">The client is asked to confirm. They can reopen it with a reason.</p>
              </ActionForm>
            </Section>
          )}

          {s.can_manage && !open && (
            <Section title="Closed?">
              <ActionForm action={snagStepAction} className="space-y-2 p-4">
                <input type="hidden" name="snag_id" value={s.id} />
                <textarea name="note" rows={2} className="input" placeholder="Why it needs more work" />
                <Submit name="step" value="reopen" className="btn-ghost">Reopen</Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

const CATS = Object.entries(SNAG_CATEGORY_LABEL);

/** Team member logs a snag found on site. */
export function StaffSnagForm({ projects, projectId }: { projects: R[]; projectId?: string | null }) {
  return (
    <ActionForm action={raiseSnagAction} className="space-y-4">
      <div><label className="label" htmlFor="project_id">Project</label>
        <select id="project_id" name="project_id" defaultValue={projectId ?? ""} className="input" required>
          <option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><label className="label" htmlFor="area">Area</label><input id="area" name="area" list="areas" className="input" required /><datalist id="areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div><label className="label" htmlFor="category">Category</label><select id="category" name="category" className="input" required><option value="">Choose…</option>{CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="urgency">Urgency</label><select id="urgency" name="urgency" className="input" defaultValue="medium">{["critical", "high", "medium", "low"].map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}</select></div>
      </div>
      <div><label className="label" htmlFor="description">Description</label><textarea id="description" name="description" rows={3} className="input" required /></div>
      <FileInput name="photos" label="Photos" />
      <Submit pendingText="Saving…">Log snag</Submit>
    </ActionForm>
  );
}

export { Empty };
