import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { paymentsOverview } from "@/lib/payments";
import { fmtDate, fmtDateTime, inr, PAYMENT_STATUS_LABEL, relDay, todayIST } from "@/lib/format";
import { isOrgAdmin } from "@/lib/roles";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { PAYMENT_TONE } from "@/components/approvals";
import { reminderSettingsAction, runRemindersAction } from "./actions";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const user = await requireUser("management");
  const admin = isOrgAdmin(user.role);
  const data = await withUser(user.id, async (db) => ({
    ...(await paymentsOverview(db)),
    settings: (await db.query("select settings from organisations where id = my_org_id()")).rows[0]?.settings ?? {},
    lastRun: (await db.query("select created_at, notifications_created from reminder_runs order by created_at desc limit 1")).rows[0],
  }));
  const { totals: t, attention, projects, recent, settings, lastRun } = data;
  const limit = Number(settings.overdue_reminder_limit ?? 5);
  const today = todayIST();

  return (
    <>
      <PageHeader title="Payments" subtitle={user.role === "project_manager" ? "Client payments on the projects you manage." : "Client payment collection across all projects."} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total scheduled" value={inr(t.total)} />
        <Stat label="Received" value={inr(t.received)} tone="green" />
        <Stat label="Outstanding" value={inr(t.outstanding)} />
        <Stat label="Overdue" value={inr(t.overdue)} tone={t.overdue ? "red" : undefined} hint={t.overdue_count ? `${t.overdue_count} milestone(s)` : undefined} />
        <Stat label="Due in next 30 days" value={inr(t.next30)} tone={t.next30 ? "amber" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section title="Needs follow-up" action={<span className="text-xs text-ink-3">Overdue, due, part-paid and due within 30 days</span>}>
            {attention.length === 0 ? <div className="p-4"><Empty title="Nothing to follow up">Overdue and upcoming payments will appear here.</Empty></div> : (
              <ul className="divide-y divide-line">
                {attention.map((m) => (
                  <li key={m.id}>
                    <Link href={`/m/projects/${m.project_id}/payments`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-canvas/60 sm:grid-cols-[1fr_120px_130px_120px]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{m.name}</div>
                        <div className="truncate text-xs text-ink-3">{m.project_name}</div>
                      </div>
                      <div className="text-right text-sm font-medium tabular-nums">{inr(m.outstanding_paise)}</div>
                      <div className="text-xs sm:text-right">
                        <div>{fmtDate(m.due_date, { year: false })}</div>
                        <div className={m.due_date && m.due_date < today ? "text-red-600" : "text-ink-3"}>{relDay(m.due_date)}</div>
                      </div>
                      <div className="flex justify-end gap-1"><Badge tone={PAYMENT_TONE[m.effective_status]}>{PAYMENT_STATUS_LABEL[m.effective_status]}</Badge></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="By project">
            {projects.length === 0 ? <p className="p-4 text-sm text-ink-3">No projects yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-3"><tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Project</th><th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Schedule</th>
                  <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Received</th><th className="px-4 py-2 text-right font-medium">Outstanding</th>
                </tr></thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                      <td className="px-4 py-2.5">
                        <Link href={`/m/projects/${p.id}/payments`} className="font-medium hover:underline">{p.name}</Link>
                        <div className="text-xs text-ink-3">{p.milestones ? `${p.milestones} milestone(s)` : "No schedule yet · add one"}{p.overdue_count ? <span className="text-red-600"> · {p.overdue_count} overdue</span> : null}</div>
                      </td>
                      <td className="hidden px-2 py-2.5 text-right tabular-nums sm:table-cell">{inr(p.total)}</td>
                      <td className="hidden px-2 py-2.5 text-right text-emerald-700 tabular-nums sm:table-cell">{inr(p.received)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{inr(p.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Automatic reminders">
            <div className="space-y-3 p-4 text-sm">
              <p className="text-ink-2">Every morning at 8:00 AM the system reminds clients in the app:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
                <li>7 days and 3 days before a payment is due</li>
                <li>on the due date and 1 day after</li>
                <li>then every 3 days, up to the limit below</li>
                <li>for approvals: 2 days before, on the day, then the same pattern</li>
              </ul>
              <p className="text-xs text-ink-3">Overdue reminders also go to the project manager. Milestones on hold or with reminders paused are skipped. Each reminder is sent only once.</p>
              <p className="text-xs text-ink-3">Last run: {lastRun ? `${fmtDateTime(lastRun.created_at)} · ${lastRun.notifications_created} sent` : "not yet"}</p>
            </div>
            {admin && (
              <div className="space-y-3 border-t border-line p-4">
                <ActionForm action={reminderSettingsAction} className="flex flex-wrap items-end gap-2">
                  <div><label className="label">Repeat overdue reminders up to</label>
                    <select name="limit" defaultValue={String(limit)} className="input py-1.5">
                      {[0, 1, 2, 3, 5, 8, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n} more time{n === 1 ? "" : "s"}</option>)}
                    </select></div>
                  <Submit className="btn-ghost py-1.5">Save</Submit>
                </ActionForm>
                <ActionForm action={runRemindersAction}>
                  <Submit className="btn-ghost w-full" pendingText="Running…">Run today’s reminders now</Submit>
                </ActionForm>
              </div>
            )}
          </Section>

          <Section title="Recently recorded">
            {recent.length === 0 ? <p className="p-4 text-sm text-ink-3">No payments recorded yet.</p> : (
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 text-sm">
                    <div className="flex justify-between gap-2"><span className={r.voided_at ? "text-ink-3 line-through" : "font-medium"}>{inr(r.amount_paise)}</span><span className="text-xs text-ink-3">{fmtDate(r.received_on, { year: false })}</span></div>
                    <Link href={`/m/projects/${r.project_id}/payments`} className="block truncate text-xs text-ink-3 hover:underline">{r.milestone_name} · {r.project_name}</Link>
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
