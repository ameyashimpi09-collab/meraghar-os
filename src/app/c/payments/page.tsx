import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientHome } from "@/lib/clientQueries";
import { projectPayments } from "@/lib/payments";
import { fileUrl } from "@/lib/files";
import { fmtDate, inr, relDay, todayIST } from "@/lib/format";

export const metadata = { title: "Payments" };

// Clients never see "on hold" (an internal status) or internal notes.
const CLIENT_STATUS: Record<string, string> = {
  upcoming: "Upcoming", on_hold: "Upcoming", due: "Due soon", partially_paid: "Part paid", paid: "Paid", overdue: "Overdue",
};

export default async function ClientPayments() {
  const user = await requireUser("client");
  const data = await withUser(user.id, async (db) => {
    const h = await clientHome(db);
    if (!h) return null;
    return { project: h.project, ...(await projectPayments(db, h.project.id, { management: false })) };
  });
  if (!data) return <p className="py-20 text-center text-stone">Your project is being set up.</p>;
  const { milestones, transactions, totals } = data;
  const today = todayIST();
  const next = milestones.find((m) => m.outstanding_paise > 0 && m.effective_status !== "on_hold" && m.due_date);
  const pct = totals.total ? (100 * totals.received) / totals.total : 0;

  return (
    <>
      <h1 className="font-serif text-5xl">Payments</h1>
      <p className="mt-4 max-w-xl text-stone">Your payment schedule and everything received so far. Payments are confirmed by our accounts team once they reach us.</p>

      {milestones.length === 0 ? (
        <p className="mt-16 font-serif text-2xl text-charcoal/70">Your payment schedule will appear here once it has been shared.</p>
      ) : (
        <>
          <section className="mt-12 grid gap-8 border-y border-divider py-10 sm:grid-cols-3">
            <div><div className="text-xs text-stone">Project value</div><div className="mt-1 font-serif text-4xl">{inr(totals.total)}</div></div>
            <div><div className="text-xs text-stone">Paid</div><div className="mt-1 font-serif text-4xl text-sage">{inr(totals.received)}</div></div>
            <div><div className="text-xs text-stone">Balance</div><div className="mt-1 font-serif text-4xl">{inr(totals.outstanding)}</div></div>
            <div className="sm:col-span-3"><div className="h-1 bg-divider"><div className="h-1 bg-sage" style={{ width: `${pct}%` }} /></div></div>
          </section>

          {next && (
            <section className={`mt-10 border-l-2 pl-5 ${next.effective_status === "overdue" ? "border-alert" : "border-amber"}`}>
              <div className={`text-[11px] tracking-[0.25em] uppercase ${next.effective_status === "overdue" ? "text-alert" : "text-amber"}`}>{next.effective_status === "overdue" ? "Overdue" : "Next payment"}</div>
              <div className="mt-2 font-serif text-3xl">{inr(next.outstanding_paise)} · {next.name}</div>
              <div className="mt-1 text-sm text-stone">Due {fmtDate(next.due_date)} · {relDay(next.due_date)}</div>
            </section>
          )}

          <section className="mt-14">
            <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">Schedule</div>
            <ol className="divide-y divide-divider border-y border-divider">
              {milestones.map((m) => (
                <li key={m.id} className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 py-5 sm:grid-cols-[1fr_140px_140px_120px]">
                  <div>
                    <div className="font-serif text-xl">{m.name}</div>
                    {m.description && <div className="text-sm text-stone">{m.description}</div>}
                  </div>
                  <div className="text-right sm:order-none">{inr(m.amount_paise)}{m.received_paise > 0 && m.outstanding_paise > 0 && <div className="text-xs text-stone">{inr(m.outstanding_paise)} left</div>}</div>
                  <div className="text-sm text-stone sm:text-right">{m.due_date ? fmtDate(m.due_date) : "Date to be confirmed"}</div>
                  <div className={`text-right text-sm ${m.effective_status === "paid" ? "text-sage" : m.effective_status === "overdue" ? "text-alert" : m.effective_status === "due" || m.effective_status === "partially_paid" ? "text-amber" : "text-stone"}`}>
                    {CLIENT_STATUS[m.effective_status]}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-14 max-w-3xl">
            <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">Payment history</div>
            {transactions.length === 0 ? <p className="text-stone">No payments recorded yet.</p> : (
              <ul className="divide-y divide-divider border-y border-divider">
                {transactions.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-3 py-4 text-sm">
                    <div>
                      <div>{inr(t.amount_paise)} <span className="text-stone">· {t.milestone_name}</span></div>
                      <div className="text-xs text-stone">Received {fmtDate(t.received_on)}{t.method ? ` · ${t.method}` : ""}{t.reference ? ` · Ref ${t.reference}` : ""}</div>
                    </div>
                    {t.receipt_published && t.receipt_path && (
                      <a href={fileUrl(t.receipt_path, true)} className="text-sm underline decoration-divider underline-offset-4 hover:decoration-charcoal">Download receipt</a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="mt-10 text-xs text-stone">Questions about a payment? Please speak to your project manager. Amounts shown as of {fmtDate(today)}.</p>
        </>
      )}
    </>
  );
}
