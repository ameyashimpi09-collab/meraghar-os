import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientHome } from "@/lib/clientQueries";
import { fmtDate, POSSESSION_LABEL } from "@/lib/format";

export const metadata = { title: "My project" };

export default async function ClientProject() {
  const user = await requireUser("client");
  const data = await withUser(user.id, async (db) => {
    const h = await clientHome(db);
    if (!h) return null;
    const scope = (await db.query(
      `select category, description, is_included from project_scope_items where project_id = $1 and deleted_at is null order by sort_order`,
      [h.project.id])).rows;
    return { ...h, scope };
  });
  if (!data) return <p className="py-20 text-center text-stone">Your project is being set up.</p>;
  const { project: p, stages, scope } = data;
  const rows: [string, string | null][] = [
    ["Project code", p.project_code],
    ["Address", [p.flat_number, p.building_society, p.address_line, p.city, p.pincode].filter(Boolean).join(", ")],
    ["Configuration", p.property_config],
    ["Carpet area", p.carpet_area_sqft ? `${Number(p.carpet_area_sqft).toLocaleString("en-IN")} sq ft` : null],
    ["Possession", p.possession_status ? POSSESSION_LABEL[p.possession_status] : null],
    ["Expected start", fmtDate(p.expected_start_date)],
    ["Target handover", fmtDate(p.target_handover_date)],
  ];
  return (
    <>
      <h1 className="font-serif text-5xl">Your project</h1>
      <div className="mt-12 grid gap-16 lg:grid-cols-[1fr_1.2fr]">
        <section>
          <div className="text-[11px] tracking-[0.25em] text-stone uppercase">Details</div>
          <dl className="mt-5 divide-y divide-divider border-y border-divider">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_1fr] gap-4 py-3.5 text-sm"><dt className="text-stone">{k}</dt><dd>{v || "—"}</dd></div>
            ))}
          </dl>
          <div className="mt-12 text-[11px] tracking-[0.25em] text-stone uppercase">Scope of work</div>
          <ul className="mt-5 divide-y divide-divider border-y border-divider">
            {scope.filter((s) => s.is_included).map((s, i) => (
              <li key={i} className="py-3.5"><div>{s.category}</div>{s.description && <div className="text-sm text-stone">{s.description}</div>}</li>
            ))}
          </ul>
        </section>
        <section>
          <div className="text-[11px] tracking-[0.25em] text-stone uppercase">Timeline</div>
          {stages.length === 0 ? <p className="mt-5 text-stone">Your schedule will appear here once it&apos;s ready.</p> : (
            <ol className="mt-6">
              {stages.map((s) => {
                const state = s.status === "completed" ? "done" : ["in_progress", "delayed", "on_hold"].includes(s.status) ? "now" : "next";
                return (
                  <li key={s.id} className="relative grid grid-cols-[18px_1fr] gap-5 pb-8 last:pb-0">
                    <span className={`relative z-10 mt-1.5 h-3 w-3 rounded-full border ${state === "done" ? "border-sage bg-sage" : state === "now" ? "border-amber bg-amber-soft ring-4 ring-amber-soft" : "border-divider bg-paper"}`} />
                    <span className="absolute top-4 left-[5px] h-full w-px bg-divider" />
                    <div>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={`font-serif text-xl ${state === "next" ? "text-charcoal/60" : ""}`}>{s.name}</span>
                        <span className="text-xs text-stone">{state === "done" ? `Completed ${fmtDate(s.actual_end_date ?? s.planned_end_date, { year: false })}` : `${fmtDate(s.start_date, { year: false })} – ${fmtDate(s.planned_end_date, { year: false })}`}</span>
                      </div>
                      {state === "now" && s.client_description && <p className="mt-1 text-sm text-charcoal/80">{s.client_description}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
