import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientHome } from "@/lib/clientQueries";
import { fmtDate, inr, relDay, todayIST } from "@/lib/format";
import { MEMBER_ROLE_LABEL } from "@/lib/roles";

export const metadata = { title: "My home" };

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return <div className="mb-5 flex items-baseline gap-3 text-[11px] tracking-[0.25em] text-stone uppercase"><span className="font-serif text-base tracking-normal text-charcoal/40">{n}</span>{children}</div>;
}

function FloorPlan() {
  return (
    <svg viewBox="0 0 320 200" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <rect x="10" y="10" width="300" height="180" />
      <path d="M130 10v80M10 90h170M180 90v100M230 90h80M230 90v40M180 140h50M60 90v-25M60 45v-35" />
      <path d="M130 50a20 20 0 0 1 20 20" strokeDasharray="2 3" />
      <path d="M180 120a18 18 0 0 0 18-18" strokeDasharray="2 3" />
      <rect x="30" y="120" width="60" height="40" rx="2" />
      <rect x="245" y="150" width="45" height="25" rx="2" />
      <circle cx="270" cy="50" r="14" />
    </svg>
  );
}

export default async function ClientHome() {
  const user = await requireUser("client");
  const data = await withUser(user.id, (db) => clientHome(db));

  if (!data) {
    return (
      <div className="py-24 text-center">
        <h1 className="font-serif text-4xl">Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className="mx-auto mt-4 max-w-md text-stone">Your project is being set up. You&apos;ll see its progress here as soon as your project manager links it to your account.</p>
      </div>
    );
  }

  const { project: p, stages, approvals, payments, purchases, team, totals, snags, latest } = data;
  const today = todayIST();
  const done = stages.filter((s) => s.status === "completed").length;
  const pct = stages.length ? Math.round((100 * done) / stages.length) : 0;
  const current = stages.find((s) => s.status === "in_progress" || s.status === "delayed" || s.status === "on_hold");
  const next = stages.filter((s) => s.status === "not_started").slice(0, 3);
  const asks = approvals.length + payments.length + purchases.length + snags.length;

  return (
    <>
      {/* Hero */}
      <section className="grid gap-10 border-b border-divider pb-12 md:grid-cols-[1.3fr_1fr] md:items-end">
        <div>
          <p className="text-[11px] tracking-[0.3em] text-stone uppercase">{[p.flat_number, p.building_society].filter(Boolean).join(" · ") || p.city}</p>
          <h1 className="mt-4 font-serif text-[44px] leading-[1.05] sm:text-6xl">{p.name.split("–")[0].trim()}<span className="text-stone">{p.name.includes("–") ? "’s home" : ""}</span></h1>
          <p className="mt-4 text-sm text-stone">{[p.property_config, p.carpet_area_sqft ? `${Number(p.carpet_area_sqft).toLocaleString("en-IN")} sq ft` : null, p.city].filter(Boolean).join("  ·  ")}</p>
        </div>
        <div className="relative hidden h-44 text-divider md:block"><FloorPlan /></div>
      </section>

      <div className="grid gap-x-16 gap-y-14 pt-12 lg:grid-cols-2">
        {/* 1. What is happening */}
        <section>
          <Eyebrow n="01">What is happening</Eyebrow>
          {current ? (
            <>
              <h2 className="font-serif text-3xl">{current.name}</h2>
              <p className="mt-3 leading-relaxed text-charcoal/80">{current.client_description ?? "Our team is working on this stage at your home."}</p>
              <p className="mt-3 text-sm text-stone">Planned to finish {fmtDate(current.planned_end_date)}</p>
            </>
          ) : stages.length && done === stages.length ? (
            <h2 className="font-serif text-3xl">All stages are complete</h2>
          ) : (
            <>
              <h2 className="font-serif text-3xl">{p.expected_start_date && p.expected_start_date > today ? "Getting ready to begin" : "Your project is being planned"}</h2>
              <p className="mt-3 text-charcoal/80">{p.expected_start_date ? `Work is expected to start on ${fmtDate(p.expected_start_date)}.` : "Your project manager will share the schedule shortly."}</p>
            </>
          )}
        </section>

        {/* 2. Progress */}
        <section>
          <Eyebrow n="02">Progress</Eyebrow>
          <div className="flex items-end gap-4">
            <span className="font-serif text-7xl leading-none">{pct}<span className="text-3xl text-stone">%</span></span>
            <span className="pb-2 text-sm text-stone">{done} of {stages.length} stages complete</span>
          </div>
          <div className="mt-6 flex gap-1">
            {stages.map((s) => (
              <span key={s.id} title={s.name} className={`h-1 flex-1 ${s.status === "completed" ? "bg-sage" : s === current ? "bg-amber" : "bg-divider"}`} />
            ))}
          </div>
          <div className="mt-3 flex justify-between text-xs text-stone">
            <span>Started {fmtDate(p.expected_start_date, { year: false })}</span>
            <span>Handover {fmtDate(p.target_handover_date)}</span>
          </div>
        </section>

        {/* 3. What we need from you */}
        <section>
          <Eyebrow n="03">What we need from you</Eyebrow>
          {asks === 0 ? (
            <p className="font-serif text-2xl text-charcoal/70">Nothing right now. Thank you.</p>
          ) : (
            <ul className="divide-y divide-divider border-y border-divider">
              {approvals.map((a) => (
                <li key={a.id}>
                  <Link href={`/c/approvals/${a.id}`} className="flex items-start justify-between gap-4 py-4 hover:bg-paper/70">
                    <div><div className="text-[11px] tracking-[0.2em] text-amber uppercase">{a.status === "query_raised" ? "Approval · we are replying" : "Approval needed"}</div><div className="mt-1">{a.title}</div><div className="text-sm text-stone">{a.area}</div></div>
                    <div className={`text-right text-sm whitespace-nowrap ${a.deadline && a.deadline < today ? "text-alert" : "text-stone"}`}>{a.deadline ? <>By {fmtDate(a.deadline, { year: false })}<div className="text-xs">{relDay(a.deadline)}</div></> : null}</div>
                  </Link>
                </li>
              ))}
              {payments.map((m) => (
                <li key={m.id}>
                  <Link href="/c/payments" className="flex items-start justify-between gap-4 py-4 hover:bg-paper/70">
                    <div><div className={`text-[11px] tracking-[0.2em] uppercase ${m.effective_status === "overdue" ? "text-alert" : "text-amber"}`}>Payment {m.effective_status === "overdue" ? "overdue" : "due"}</div><div className="mt-1">{m.name}</div><div className="text-sm text-stone">{inr(m.outstanding_paise)} outstanding</div></div>
                    <div className={`text-right text-sm whitespace-nowrap ${m.effective_status === "overdue" ? "text-alert" : "text-stone"}`}>{fmtDate(m.due_date, { year: false })}</div>
                  </Link>
                </li>
              ))}
              {purchases.map((x) => (
                <li key={x.id}>
                  <Link href={`/c/purchases#p-${x.id}`} className="flex items-start justify-between gap-4 py-4 hover:bg-paper/70">
                    <div><div className={`text-[11px] tracking-[0.2em] uppercase ${x.status === "delayed" || (x.required_delivery_date && x.required_delivery_date < today) ? "text-alert" : "text-amber"}`}>{x.status === "delayed" || (x.required_delivery_date && x.required_delivery_date < today) ? "Purchase running late" : "Your purchase"}</div><div className="mt-1">{x.item_name}</div><div className="text-sm text-stone">{x.area} · needed at site by {fmtDate(x.required_delivery_date, { year: false })}</div></div>
                    <div className="text-right text-sm whitespace-nowrap text-stone">Buy by {fmtDate(x.required_purchase_date, { year: false })}</div>
                  </Link>
                </li>
              ))}
              {snags.map((x) => (
                <li key={x.id}>
                  <Link href={`/c/snags/${x.id}`} className="flex items-start justify-between gap-4 py-4 hover:bg-paper/70">
                    <div><div className="text-[11px] tracking-[0.2em] text-amber uppercase">Concern fixed · please confirm</div><div className="mt-1 line-clamp-1">{x.description}</div><div className="text-sm text-stone">{x.area}</div></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-stone">Tap an item to open it.</p>
        </section>

        {/* 4. What is coming next */}
        <section>
          <Eyebrow n="04">What is coming next</Eyebrow>
          {next.length === 0 ? <p className="text-charcoal/70">Your project manager will share the next steps soon.</p> : (
            <ol className="space-y-5">
              {next.map((s) => (
                <li key={s.id} className="grid grid-cols-[88px_1fr] gap-4">
                  <span className="pt-1 text-sm text-stone">{fmtDate(s.start_date, { year: false })}</span>
                  <div className="border-l border-divider pl-4"><div className="font-serif text-xl">{s.name}</div>{s.client_description && <p className="mt-1 text-sm text-stone">{s.client_description}</p>}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {latest && (
        <Link href={`/c/updates#u-${latest.id}`} className="group mt-16 grid gap-8 border-t border-divider pt-12 md:grid-cols-[1.4fr_1fr] md:items-center">
          {latest.photo ? <div className="aspect-[16/10] overflow-hidden bg-divider"><img src={`/files/${latest.photo}`} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.02]" /></div> : null}
          <div>
            <div className="text-[11px] tracking-[0.25em] text-stone uppercase">Latest from site · {new Date(latest.site_datetime).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</div>
            <h2 className="mt-3 font-serif text-4xl leading-tight">{latest.title || latest.work_category || "Site progress"}</h2>
            <p className="mt-3 line-clamp-3 leading-relaxed text-charcoal/80">{latest.work_completed}</p>
            <span className="mt-4 inline-block text-sm underline decoration-divider underline-offset-4 group-hover:decoration-charcoal">See all updates{latest.photos > 1 ? ` · ${latest.photos} photos` : ""} →</span>
          </div>
        </Link>
      )}

      {/* Payments summary + team */}
      <div className="mt-16 grid gap-10 border-t border-divider pt-12 md:grid-cols-2">
        {totals.total > 0 && (
          <section>
            <Link href="/c/payments" className="text-[11px] tracking-[0.25em] text-stone uppercase hover:text-charcoal">Payments →</Link>
            <dl className="mt-5 grid grid-cols-3 gap-4">
              <div><dt className="text-xs text-stone">Project value</dt><dd className="mt-1 font-serif text-2xl">{inr(totals.total)}</dd></div>
              <div><dt className="text-xs text-stone">Paid</dt><dd className="mt-1 font-serif text-2xl text-sage">{inr(totals.paid)}</dd></div>
              <div><dt className="text-xs text-stone">Balance</dt><dd className="mt-1 font-serif text-2xl">{inr(totals.outstanding)}</dd></div>
            </dl>
            <div className="mt-4 h-1 bg-divider"><div className="h-1 bg-sage" style={{ width: `${(100 * totals.paid) / totals.total}%` }} /></div>
          </section>
        )}
        <section>
          <div className="text-[11px] tracking-[0.25em] text-stone uppercase">Your Meraghar team</div>
          <ul className="mt-5 space-y-4">
            {team.map((t, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 border-b border-divider pb-4">
                <div><div>{t.full_name}</div><div className="text-sm text-stone">{MEMBER_ROLE_LABEL[t.member_role]}</div></div>
                {t.phone && <a href={`tel:${t.phone.replace(/\s/g, "")}`} className="text-sm whitespace-nowrap underline decoration-divider underline-offset-4">{t.phone}</a>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
