import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { projectPayments } from "@/lib/payments";
import { quotationValue } from "@/lib/quotations";
import { fileUrl } from "@/lib/files";
import { fmtDate, fmtDateTime, inr, PAYMENT_METHODS, PAYMENT_STATUS_LABEL, relDay, todayIST } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { FileInput } from "@/components/FileInput";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { PAYMENT_TONE } from "@/components/approvals";
import { addNoteAction } from "../../../approvals/actions";
import {
  addMilestoneAction, changeDueDateAction, holdAction, receiptAction, recordPaymentAction, remindersAction,
  removeMilestoneAction, updateMilestoneAction, voidPaymentAction,
} from "../../../payments/actions";

export const metadata = { title: "Payments" };

export default async function ProjectPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const p = (await db.query("select id, name, project_code, can_manage_project(id) as can_manage from projects where id = $1 and deleted_at is null", [id])).rows[0];
    if (!p || !p.can_manage) return p ? { p, denied: true as const } : null;
    return { p, denied: false as const, quote: await quotationValue(db, id), ...(await projectPayments(db, id, { management: true })) };
  });
  if (!data) notFound();
  if (data.denied) return <p className="text-sm text-ink-3">Only this project’s manager or an owner/admin can see its payments.</p>;
  const { p, milestones, transactions, changes, notes, totals, quote } = data;
  const today = todayIST();
  const pct = totals.total ? Math.round((100 * totals.received) / totals.total) : 0;

  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/payments" className="hover:underline">Payments</Link> / <Link href={`/m/projects/${p.id}`} className="hover:underline">{p.project_code}</Link></div>
      <PageHeader title={`Payments · ${p.name}`} subtitle="Tracking only. Nothing is ever marked as received automatically; only management can record a payment." />

      {quote ? (
        <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${quote.grand_total_paise === totals.total ? "border-line bg-white text-ink-2" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          Quotation value <b className="tabular-nums">{inr(quote.grand_total_paise)}</b>
          {quote.grand_total_paise === totals.total ? " · fully covered by the payment schedule ✓"
            : totals.total < quote.grand_total_paise ? ` · ${inr(quote.grand_total_paise - totals.total)} not yet in the payment schedule`
            : ` · the payment schedule is ${inr(totals.total - quote.grand_total_paise)} more than the quotation`}
          {" · "}<Link href={`/m/projects/${p.id}/quotation`} className="text-brand hover:underline">Quotation</Link>
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-ink-2">
          No quotation on this project yet. <Link href={`/m/projects/${p.id}/quotation`} className="text-brand hover:underline">Upload the quotation PDF</Link> to check the schedule against it{milestones.length === 0 ? " and create the schedule in one step" : ""}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Payment schedule" value={inr(totals.total)} hint={`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`} />
        <Stat label="Received" value={inr(totals.received)} tone="green" hint={`${pct}% collected`} />
        <Stat label="Outstanding" value={inr(totals.outstanding)} />
        <Stat label="Overdue" value={inr(totals.overdue)} tone={totals.overdue ? "red" : undefined} hint={totals.overdue_count ? `${totals.overdue_count} milestone(s)` : "Nothing overdue"} />
      </div>

      <Section title="Payment schedule" className="mt-6" action={<span className="text-xs text-ink-3">Click a milestone to record a payment or make changes</span>}>
        {milestones.length === 0 ? <div className="p-4"><Empty title="No payment schedule yet">Add the first milestone below, e.g. Booking, Design finalisation, Carpentry start, Handover.</Empty></div> : (
          <div className="divide-y divide-line">
            {milestones.map((m) => {
              const mTx = transactions.filter((t) => t.milestone_id === m.id);
              const mChanges = changes.filter((c) => c.milestone_id === m.id);
              const mNotes = notes.filter((n) => n.entity_id === m.id);
              return (
                <details key={m.id} className="group milestone">
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-canvas/60 sm:grid-cols-[1fr_110px_110px_110px_130px_120px]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium"><span className="mr-1 inline-block text-ink-3 transition group-open:rotate-90">›</span>{m.name}</div>
                      {m.description && <div className="truncate pl-3 text-xs text-ink-3">{m.description}</div>}
                    </div>
                    <div className="text-right text-sm tabular-nums sm:order-none">{inr(m.amount_paise)}</div>
                    <div className="hidden text-right text-sm text-emerald-700 tabular-nums sm:block">{m.received_paise ? inr(m.received_paise) : "—"}</div>
                    <div className="hidden text-right text-sm tabular-nums sm:block">{m.outstanding_paise ? inr(m.outstanding_paise) : "—"}</div>
                    <div className="text-xs sm:text-right">
                      <div>{m.due_date ? fmtDate(m.due_date) : "Date to be decided"}</div>
                      {m.due_date && m.effective_status !== "paid" && <div className={m.due_date < today ? "text-red-600" : "text-ink-3"}>{relDay(m.due_date)}</div>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Badge tone={PAYMENT_TONE[m.effective_status]}>{PAYMENT_STATUS_LABEL[m.effective_status]}</Badge>
                      {m.reminders_paused && <Badge>Reminders paused</Badge>}
                    </div>
                  </summary>

                  <div className="grid gap-5 border-t border-line bg-canvas/40 p-4 lg:grid-cols-2">
                    <div className="space-y-5">
                      {m.outstanding_paise > 0 && (
                        <div className="card p-4">
                          <h3 className="mb-3 text-sm font-semibold">Record a payment received</h3>
                          <ActionForm action={recordPaymentAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
                            <input type="hidden" name="milestone_id" value={m.id} />
                            <div><label className="label">Amount received (₹)</label><input name="amount" inputMode="decimal" required className="input" placeholder={String(m.outstanding_paise / 100)} /></div>
                            <div><label className="label">Received on</label><input name="received_on" type="date" required max={today} defaultValue={today} className="input" /></div>
                            <div><label className="label">Method</label>
                              <select name="method" className="input" defaultValue={PAYMENT_METHODS[0]}>{PAYMENT_METHODS.map((x) => <option key={x}>{x}</option>)}</select></div>
                            <div><label className="label">Reference / transaction ID</label><input name="reference" maxLength={200} className="input" placeholder="UTR, cheque no., UPI ref" /></div>
                            <div className="sm:col-span-2"><FileInput name="receipt" multiple={false} label="Receipt (optional)" /></div>
                            <label className="flex items-center gap-2 text-xs text-ink-2 sm:col-span-2"><input type="checkbox" name="publish_receipt" /> Let the client download this receipt</label>
                            <div className="flex items-center justify-between gap-2 sm:col-span-2">
                              <span className="text-xs text-ink-3">{inr(m.outstanding_paise)} still due. A part payment is fine.</span>
                              <Submit pendingText="Recording…">Record payment</Submit>
                            </div>
                          </ActionForm>
                        </div>
                      )}

                      <div className="card">
                        <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold">Payments received</h3>
                        {mTx.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">Nothing received yet.</p> : (
                          <ul className="divide-y divide-line">
                            {mTx.map((t) => (
                              <li key={t.id} className={`px-4 py-3 text-sm ${t.voided_at ? "bg-gray-50" : ""}`}>
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <span className={`font-medium tabular-nums ${t.voided_at ? "text-ink-3 line-through" : ""}`}>{inr(t.amount_paise)}</span>
                                  <span className="text-xs text-ink-3">{fmtDate(t.received_on)} · {t.method ?? "—"}{t.reference ? ` · ${t.reference}` : ""}</span>
                                </div>
                                <div className="text-xs text-ink-3">Recorded by {t.recorded_by_name} · {fmtDateTime(t.created_at)}</div>
                                {t.voided_at ? (
                                  <div className="mt-1 text-xs text-red-700">Voided by {t.voided_by_name} · {fmtDateTime(t.voided_at)} · “{t.void_reason}”</div>
                                ) : (
                                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                                    {t.receipt_path ? (
                                      <>
                                        <a href={fileUrl(t.receipt_path)} target="_blank" rel="noopener" className="text-xs text-brand hover:underline">Receipt: {t.receipt_name ?? "open"}</a>
                                        <ActionForm action={receiptAction}>
                                          <input type="hidden" name="id" value={t.id} />
                                          <input type="hidden" name="publish" value={t.receipt_published ? "no" : "yes"} />
                                          <Submit className="text-xs text-ink-2 underline" pendingText="…">{t.receipt_published ? "Shared with client · hide" : "Not shared · share with client"}</Submit>
                                        </ActionForm>
                                      </>
                                    ) : (
                                      <ActionForm action={receiptAction} className="flex flex-wrap items-end gap-2">
                                        <input type="hidden" name="id" value={t.id} />
                                        <input type="hidden" name="publish" value="no" />
                                        <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf" required className="max-w-52 text-xs" />
                                        <Submit className="btn-ghost px-2 py-1 text-xs" pendingText="Uploading…">Upload receipt</Submit>
                                      </ActionForm>
                                    )}
                                    <details className="text-xs">
                                      <summary className="cursor-pointer text-ink-3 hover:text-red-600">Void entry</summary>
                                      <ActionForm action={voidPaymentAction} className="mt-2 flex flex-wrap gap-2">
                                        <input type="hidden" name="id" value={t.id} />
                                        <input name="reason" required minLength={3} maxLength={300} className="input py-1 text-xs" placeholder="Reason, e.g. cheque bounced" />
                                        <Submit className="btn-danger px-2 py-1 text-xs" pendingText="Voiding…">Void</Submit>
                                      </ActionForm>
                                    </details>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="card p-4">
                        <h3 className="mb-3 text-sm font-semibold">Change due date</h3>
                        <ActionForm action={changeDueDateAction} className="grid gap-3 sm:grid-cols-[150px_1fr_auto] sm:items-end">
                          <input type="hidden" name="id" value={m.id} />
                          <div><label className="label">New date</label><input name="new_due_date" type="date" defaultValue={m.due_date ?? ""} className="input" /></div>
                          <div><label className="label">Reason {m.due_date ? "(required)" : ""}</label><input name="reason" maxLength={500} className="input" placeholder="e.g. Carpentry start moved by a week" /></div>
                          <Submit className="btn-ghost" pendingText="Saving…">Change</Submit>
                        </ActionForm>
                        {mChanges.length > 0 && (
                          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-2">
                            {mChanges.map((c) => (
                              <li key={c.id}>{fmtDate(c.old_due_date)} → {c.new_due_date ? fmtDate(c.new_due_date) : "to be decided"} · “{c.reason}” · {c.by_name}, {fmtDateTime(c.created_at)}</li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="card p-4">
                        <h3 className="mb-3 text-sm font-semibold">Edit milestone</h3>
                        <ActionForm action={updateMilestoneAction} className="grid gap-3 sm:grid-cols-[1fr_140px_70px]">
                          <input type="hidden" name="id" value={m.id} />
                          <div><label className="label">Name</label><input name="name" defaultValue={m.name} required maxLength={120} className="input" /></div>
                          <div><label className="label">Amount (₹)</label><input name="amount" inputMode="decimal" defaultValue={String(m.amount_paise / 100)} required className="input" /></div>
                          <div><label className="label">Order</label><input name="sort_order" type="number" min={0} max={999} defaultValue={m.sort_order} className="input" /></div>
                          <div className="sm:col-span-3"><label className="label">Description</label><input name="description" defaultValue={m.description ?? ""} maxLength={500} className="input" /></div>
                          <div className="flex justify-end sm:col-span-3"><Submit className="btn-ghost">Save</Submit></div>
                        </ActionForm>
                        <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-line pt-3 text-xs">
                          <ActionForm action={holdAction}>
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="hold" value={m.status === "on_hold" ? "off" : "on"} />
                            <Submit className="text-ink-2 underline" pendingText="…">{m.status === "on_hold" ? "Remove hold" : "Put on hold (team only)"}</Submit>
                          </ActionForm>
                          {m.reminders_paused ? (
                            <ActionForm action={remindersAction}>
                              <input type="hidden" name="id" value={m.id} /><input type="hidden" name="pause" value="off" />
                              <span className="text-ink-3">Reminders paused: “{m.reminder_pause_reason}”. </span>
                              <Submit className="text-ink-2 underline" pendingText="…">Resume reminders</Submit>
                            </ActionForm>
                          ) : (
                            <details>
                              <summary className="cursor-pointer text-ink-2 underline">Pause reminders</summary>
                              <ActionForm action={remindersAction} className="mt-2 flex flex-wrap gap-2">
                                <input type="hidden" name="id" value={m.id} /><input type="hidden" name="pause" value="on" />
                                <input name="reason" required maxLength={300} className="input py-1 text-xs" placeholder="Reason, e.g. client travelling till 5 Dec" />
                                <Submit className="btn-ghost px-2 py-1 text-xs" pendingText="…">Pause</Submit>
                              </ActionForm>
                            </details>
                          )}
                          {m.received_paise === 0 && (
                            <ActionForm action={removeMilestoneAction} confirm={`Remove the milestone "${m.name}"?`}>
                              <input type="hidden" name="id" value={m.id} />
                              <Submit className="text-ink-3 hover:text-red-600" pendingText="…">Remove milestone</Submit>
                            </ActionForm>
                          )}
                        </div>
                      </div>

                      <div className="card">
                        <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold">Internal collection notes <span className="font-normal text-ink-3">· management only</span></h3>
                        <ActionForm action={addNoteAction} className="flex gap-2 p-3" resetOnSuccess>
                          <input type="hidden" name="project_id" value={p.id} />
                          <input type="hidden" name="entity_type" value="payment_milestone" />
                          <input type="hidden" name="entity_id" value={m.id} />
                          <input name="body" required maxLength={2000} className="input py-1.5" placeholder="e.g. Spoke to client, will pay after Diwali" />
                          <Submit className="btn-ghost py-1.5" pendingText="…">Add</Submit>
                        </ActionForm>
                        {mNotes.length > 0 && (
                          <ul className="divide-y divide-line border-t border-line">
                            {mNotes.map((n) => <li key={n.id} className="px-4 py-2 text-sm">{n.body}<div className="text-xs text-ink-3">{n.by_name} · {fmtDateTime(n.created_at)}</div></li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
        <ActionForm action={addMilestoneAction} className="grid gap-3 border-t border-line bg-canvas/40 p-4 sm:grid-cols-[1fr_150px_160px_auto] sm:items-end" resetOnSuccess>
          <input type="hidden" name="project_id" value={p.id} />
          <div><label className="label">New milestone</label><input name="name" required maxLength={120} className="input" placeholder="e.g. Carpentry commencement" /></div>
          <div><label className="label">Amount (₹)</label><input name="amount" inputMode="decimal" required className="input" placeholder="200000" /></div>
          <div><label className="label">Due date (blank = TBD)</label><input name="due_date" type="date" className="input" /></div>
          <Submit pendingText="Adding…">Add milestone</Submit>
          <div className="sm:col-span-4"><input name="description" maxLength={500} className="input" placeholder="Description (optional), e.g. 30% on design sign-off" /></div>
        </ActionForm>
      </Section>

      <Section title="Collection history" className="mt-6" action={<span className="text-xs text-ink-3">Every entry is kept, including voided ones</span>}>
        {transactions.length === 0 ? <p className="p-4 text-sm text-ink-3">No payments recorded yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3"><tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Received</th><th className="px-2 py-2 font-medium">Milestone</th>
              <th className="hidden px-2 py-2 font-medium sm:table-cell">Method / reference</th><th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr></thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className={`border-b border-line last:border-0 ${t.voided_at ? "text-ink-3" : ""}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(t.received_on)}</td>
                  <td className="px-2 py-2">{t.milestone_name}{t.voided_at && <span className="ml-2 text-xs text-red-700">Void: {t.void_reason}</span>}</td>
                  <td className="hidden px-2 py-2 text-xs sm:table-cell">{[t.method, t.reference].filter(Boolean).join(" · ") || "—"}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${t.voided_at ? "line-through" : ""}`}>{inr(t.amount_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
