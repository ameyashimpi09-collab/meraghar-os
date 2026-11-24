import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { approvalDetail, approvalTimeline, internalNotes, type Revision } from "@/lib/approvals";
import { APPROVAL_CATEGORIES, APPROVAL_STATUS_LABEL, AREAS, fmtDate, fmtDateTime, relDay, RESPONSE_LABEL, REVISION_STATUS_LABEL, todayIST } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { FileInput } from "@/components/FileInput";
import { Badge, Section } from "@/components/ui";
import { APPROVAL_TONE, FileGallery, REVISION_TONE, specRows } from "@/components/approvals";
import {
  addNoteAction, deleteDraftApprovalAction, newRevisionAction, publishApprovalAction, removeDraftFileAction,
  replyAction, saveDraftAction, updateApprovalHeaderAction,
} from "../actions";

export const metadata = { title: "Approval" };

function Specs({ r }: { r: Revision }) {
  const rows = specRows(r);
  return (
    <div className="space-y-3">
      {r.client_description && <p className="text-sm whitespace-pre-line text-ink">{r.client_description}</p>}
      {rows.length > 0 && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="text-sm whitespace-pre-line">{v}</dd></div>
          ))}
        </dl>
      )}
      <FileGallery files={r.files} />
    </div>
  );
}

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const d = await approvalDetail(db, id);
    if (!d) return null;
    return { ...d, notes: await internalNotes(db, "approval", id) };
  });
  if (!data) notFound();
  const { approval: a, revisions, responses, notes } = data;
  const timeline = approvalTimeline(data);
  const draft = revisions.find((r) => r.status === "draft");
  const sent = revisions.filter((r) => r.status !== "draft");
  const current = sent.find((r) => r.revision_no === a.current_revision_no);
  const lastResponse = responses[responses.length - 1];
  const approvedResponse = [...responses].reverse().find((x) => x.action === "approve");
  const canManage = a.can_manage as boolean;
  const neverSent = a.current_revision_no === 0;
  const today = todayIST();

  return (
    <>
      <div className="mb-1 text-xs text-ink-3">
        <Link href="/m/approvals" className="hover:underline">Approvals</Link> / <Link href={`/m/projects/${a.project_id}`} className="hover:underline">{a.project_code}</Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{a.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Badge>
            {a.current_revision_no > 0 && <Badge tone="brand">Revision {a.current_revision_no}</Badge>}
            <span>{a.area} · {a.category} · {a.item_name}</span>
            <span>·</span>
            <Link href={`/m/projects/${a.project_id}`} className="hover:underline">{a.project_name}</Link>
          </div>
        </div>
        {a.status !== "approved" && (
          <div className="text-right text-sm">
            <div className="text-xs text-ink-3">Client must decide by</div>
            <div className={a.deadline && a.deadline < today && a.status === "pending" ? "font-medium text-red-600" : "font-medium"}>
              {a.deadline ? `${fmtDate(a.deadline)} · ${relDay(a.deadline)}` : "No deadline set"}
            </div>
          </div>
        )}
      </div>

      {/* What needs doing now */}
      {a.status === "query_raised" && lastResponse && (
        <div className="mb-5 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <div className="text-sm font-medium text-sky-900">{lastResponse.by_name} asked a question on revision {lastResponse.revision_no} · {fmtDateTime(lastResponse.created_at)}</div>
          <p className="mt-1 text-sm whitespace-pre-line text-sky-950">“{lastResponse.comment}”</p>
          {canManage && (
            <ActionForm action={replyAction} className="mt-3 space-y-2" resetOnSuccess>
              <input type="hidden" name="approval_id" value={a.id} />
              <textarea name="body" rows={3} required maxLength={2000} className="input" placeholder="Your answer to the client. Sending it puts the approval back with the client for a decision." />
              <div className="flex flex-wrap items-center gap-2">
                <Submit pendingText="Sending…">Send reply</Submit>
                <span className="text-xs text-sky-900">If the answer needs a changed design, start a new revision instead.</span>
              </div>
            </ActionForm>
          )}
        </div>
      )}
      {a.status === "changes_requested" && lastResponse && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-medium text-red-900">{lastResponse.by_name} requested changes to revision {lastResponse.revision_no} · {fmtDateTime(lastResponse.created_at)}</div>
          <p className="mt-1 text-sm whitespace-pre-line text-red-950">“{lastResponse.comment}”</p>
          {canManage && !draft && (
            <ActionForm action={newRevisionAction} className="mt-3">
              <input type="hidden" name="approval_id" value={a.id} />
              <Submit pendingText="Starting…">Start revision {a.current_revision_no + 1}</Submit>
            </ActionForm>
          )}
        </div>
      )}
      {a.status === "approved" && approvedResponse && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm text-emerald-900">
            <span className="font-medium">Approved by {approvedResponse.by_name}</span> on {fmtDateTime(approvedResponse.created_at)} (revision {approvedResponse.revision_no}).
            <div className="text-xs text-emerald-800">This revision is locked and can never be changed. Any change creates a new revision.</div>
          </div>
          {canManage && !draft && (
            <ActionForm action={newRevisionAction}>
              <input type="hidden" name="approval_id" value={a.id} />
              <Submit className="btn-ghost" pendingText="Starting…">Revise (creates revision {a.current_revision_no + 1})</Submit>
            </ActionForm>
          )}
        </div>
      )}
      {a.status === "pending" && current && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div>Revision {current.revision_no} was sent to the client {fmtDateTime(current.published_at)}. Waiting for their decision.</div>
          {canManage && !draft && (
            <ActionForm action={newRevisionAction}>
              <input type="hidden" name="approval_id" value={a.id} />
              <Submit className="btn-ghost py-1.5 text-xs" pendingText="Starting…">Correct it (new revision)</Submit>
            </ActionForm>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {draft && canManage && (
            <Section title={`Revision ${draft.revision_no} · draft (the client cannot see this yet)`}>
              <ActionForm action={saveDraftAction} className="space-y-4 p-4">
                <input type="hidden" name="approval_id" value={a.id} />
                <input type="hidden" name="revision_id" value={draft.id} />
                <div>
                  <label className="label">Description for the client</label>
                  <textarea name="client_description" rows={4} maxLength={4000} defaultValue={draft.client_description ?? ""} className="input"
                    placeholder="What is being approved, in plain words. The client reads exactly this." />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div><label className="label">Material brand</label><input name="material_brand" defaultValue={draft.material_brand ?? ""} maxLength={120} className="input" /></div>
                  <div><label className="label">Material type</label><input name="material_type" defaultValue={draft.material_type ?? ""} maxLength={120} className="input" /></div>
                  <div><label className="label">Colour</label><input name="colour" defaultValue={draft.colour ?? ""} maxLength={120} className="input" /></div>
                  <div><label className="label">Finish</label><input name="finish" defaultValue={draft.finish ?? ""} maxLength={120} className="input" /></div>
                  <div><label className="label">Dimensions</label><input name="dimensions" defaultValue={draft.dimensions ?? ""} maxLength={300} className="input" /></div>
                  <div className="grid grid-cols-[1fr_90px] gap-2">
                    <div><label className="label">Quantity</label><input name="quantity" type="number" step="0.01" min="0" defaultValue={draft.quantity ?? ""} className="input" /></div>
                    <div><label className="label">Unit</label><input name="quantity_unit" defaultValue={draft.quantity_unit ?? ""} maxLength={30} placeholder="sq ft" className="input" /></div>
                  </div>
                  <div className="sm:col-span-2"><label className="label">Specifications</label><textarea name="specifications" rows={2} maxLength={2000} defaultValue={draft.specifications ?? ""} className="input" /></div>
                  <div><label className="label">Commercial impact (₹)</label>
                    <input name="commercial_impact" inputMode="decimal" defaultValue={draft.commercial_impact_paise != null ? String(draft.commercial_impact_paise / 100) : ""} className="input" placeholder="e.g. 12500, or -5000 for a saving" /></div>
                </div>
                <FileInput label="Add design images, drawings or PDFs" />
                <div className="flex justify-end"><Submit>Save draft</Submit></div>
              </ActionForm>
              <div className="border-t border-line p-4">
                <div className="mb-2 text-xs font-medium text-ink-2">Attached files</div>
                <FileGallery files={draft.files} onRemove={(fileId) => (
                  <ActionForm action={removeDraftFileAction}>
                    <input type="hidden" name="revision_id" value={draft.id} />
                    <input type="hidden" name="file_id" value={fileId} />
                    <Submit className="text-xs text-ink-3 hover:text-red-600" pendingText="Removing…">Remove</Submit>
                  </ActionForm>
                )} />
              </div>
              <div className="border-t border-line bg-canvas/50 p-4">
                <div className="mb-3 text-xs font-semibold tracking-wide text-ink-3 uppercase">Client preview · check before sending</div>
                <div className="rounded-md border border-line bg-white p-4"><Specs r={draft} /></div>
                <ActionForm action={publishApprovalAction} className="mt-4 flex flex-wrap items-center justify-end gap-3">
                  <input type="hidden" name="approval_id" value={a.id} />
                  <span className="mr-auto text-xs text-ink-3">Save the draft first. Sending locks this revision for good and notifies the client{a.deadline ? `; they must decide by ${fmtDate(a.deadline)}` : ""}.</span>
                  <Submit pendingText="Sending…">Send revision {draft.revision_no} to client</Submit>
                </ActionForm>
              </div>
            </Section>
          )}

          <Section title="Revision history" action={<span className="text-xs text-ink-3">Sent revisions are locked and kept forever</span>}>
            {sent.length === 0 ? <p className="p-4 text-sm text-ink-3">Nothing has been sent to the client yet.</p> : (
              <ol className="divide-y divide-line">
                {sent.map((r) => (
                  <li key={r.id} className="p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Revision {r.revision_no}</span>
                      <Badge tone={REVISION_TONE[r.status]}>{REVISION_STATUS_LABEL[r.status]}</Badge>
                      <span className="text-xs text-ink-3">Sent {fmtDateTime(r.published_at)}{r.published_by_name ? ` by ${r.published_by_name}` : ""}{r.decided_at ? ` · decided ${fmtDateTime(r.decided_at)}` : ""}</span>
                    </div>
                    <Specs r={r} />
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          {canManage && (a.status !== "approved" || draft) && (
            <Section title="Details">
              <ActionForm action={updateApprovalHeaderAction} className="space-y-3 p-4">
                <input type="hidden" name="id" value={a.id} />
                {neverSent && (
                  <>
                    <div><label className="label">Title</label><input name="title" defaultValue={a.title} required maxLength={150} className="input" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="label">Area</label><input name="area" list="areas" defaultValue={a.area} required maxLength={80} className="input" /></div>
                      <div><label className="label">Category</label><input name="category" list="cats" defaultValue={a.category} required maxLength={80} className="input" /></div>
                    </div>
                    <datalist id="areas">{AREAS.map((x) => <option key={x} value={x} />)}</datalist>
                    <datalist id="cats">{APPROVAL_CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
                    <div><label className="label">Item</label><input name="item_name" defaultValue={a.item_name} required maxLength={120} className="input" /></div>
                  </>
                )}
                <div><label className="label">Client must decide by</label><input name="deadline" type="date" defaultValue={a.deadline ?? ""} className="input" /></div>
                <div className="flex justify-end"><Submit className="btn-ghost py-1.5">Save</Submit></div>
                {!neverSent && <p className="text-xs text-ink-3">Title, area and item are locked once sent. Changing the deadline restarts its reminders.</p>}
              </ActionForm>
              {neverSent && (
                <ActionForm action={deleteDraftApprovalAction} className="border-t border-line px-4 py-3" confirm="Delete this draft approval?">
                  <input type="hidden" name="approval_id" value={a.id} />
                  <Submit className="text-xs text-ink-3 hover:text-red-600" pendingText="Deleting…">Delete this draft</Submit>
                </ActionForm>
              )}
            </Section>
          )}

          <Section title="Approval history">
            {timeline.length === 0 ? <p className="p-4 text-sm text-ink-3">Created {fmtDateTime(a.created_at)}{a.created_by_name ? ` by ${a.created_by_name}` : ""}. Not sent yet.</p> : (
              <ol className="space-y-3 p-4">
                {timeline.map((e, i) => (
                  <li key={i} className="border-l-2 border-line pl-3 text-xs">
                    <div className="font-medium text-ink">
                      {e.kind === "sent" && <>Revision {e.revision_no} sent to client</>}
                      {e.kind === "response" && <>{e.who}: {RESPONSE_LABEL[e.action!]} (rev {e.revision_no})</>}
                      {e.kind === "reply" && <>{e.who} replied</>}
                    </div>
                    {e.text && <div className="mt-0.5 whitespace-pre-line text-ink-2">“{e.text}”</div>}
                    <div className="text-ink-3">{e.kind === "sent" && e.who ? `${e.who} · ` : ""}{fmtDateTime(e.at)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Manager’s notes" action={<span className="text-xs text-ink-3">Team only, never shown to client</span>}>
            {canManage && (
              <ActionForm action={addNoteAction} className="space-y-2 border-b border-line p-4" resetOnSuccess>
                <input type="hidden" name="project_id" value={a.project_id} />
                <input type="hidden" name="entity_type" value="approval" />
                <input type="hidden" name="entity_id" value={a.id} />
                <textarea name="body" rows={2} required maxLength={2000} className="input" placeholder="e.g. Vendor lead time 3 weeks once approved" />
                <div className="flex justify-end"><Submit className="btn-ghost py-1.5" pendingText="Adding…">Add note</Submit></div>
              </ActionForm>
            )}
            {notes.length === 0 ? <p className="p-4 text-sm text-ink-3">No notes yet.</p> : (
              <ul className="divide-y divide-line">
                {notes.map((n) => (
                  <li key={n.id} className="px-4 py-2.5 text-sm">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <div className="text-xs text-ink-3">{n.by_name} · {fmtDateTime(n.created_at)}</div>
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
