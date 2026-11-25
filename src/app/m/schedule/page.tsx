import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { openBlockers, scheduleOverview, type Row } from "@/lib/execution";
import { projectSchedule as project } from "@/lib/schedule";
import { daysBetween, DELAY_HINT, DELAY_LABEL, fmtDate, STAGE_STATUS_LABEL, todayIST, addDays } from "@/lib/format";
import { Badge, Empty, HealthDot, HEALTH_LABEL, HEALTH_TONE, PageHeader, Section, Stat } from "@/components/ui";
import { DelayBadge, STAGE_TONE } from "@/components/execution";
import { BlockerList } from "@/components/blockers";

export const metadata = { title: "Execution schedule" };

export default async function ExecutionSchedulePage() {
  const user = await requireUser("management");
  const today = todayIST();
  const { o, blockers } = await withUser(user.id, async (db) => ({ o: await scheduleOverview(db), blockers: await openBlockers(db) }));

  const rows = o.projects.map((p) => {
    const stages = o.stages.filter((s) => s.project_id === p.id);
    const ids = new Set(stages.map((s) => s.id));
    const proj = project(stages as never, o.deps.filter((d) => ids.has(d.stage_id)), today);
    const active = stages.filter((s) => s.status !== "skipped");
    const current = active.find((s) => ["in_progress", "delayed", "on_hold"].includes(s.status)) ?? active.find((s) => s.status === "not_started");
    const nextMilestone = active.find((s) => s.is_milestone && s.status !== "completed");
    const finish = active.map((s) => proj.get(s.id)?.end).filter(Boolean).sort().at(-1) ?? null;
    const slip = finish && p.target_handover_date ? daysBetween(p.target_handover_date, finish) : 0;
    const behind = active.filter((s) => !["completed", "skipped"].includes(s.status) && (proj.get(s.id)?.slip ?? 0) > 0 && !proj.get(s.id)?.pushedBy);
    const late = active.filter((s) => !["completed", "skipped"].includes(s.status) && (proj.get(s.id)?.slip ?? 0) > 0).length;
    return { p, stages: active, done: active.filter((s) => s.status === "completed").length, current, nextMilestone, proj, finish, slip, behind, late };
  });
  const behind = rows.flatMap((r) => r.behind.map((s) => ({ s, r })));
  const upcoming = rows.flatMap((r) => r.stages.filter((s) => s.is_milestone && s.status !== "completed").map((s) => ({ s, r, end: r.proj.get(s.id)?.end ?? s.planned_end_date })))
    .filter((x) => x.end && x.end <= addDays(today, 30)).sort((a, b) => (a.end! < b.end! ? -1 : 1));
  const causes = Object.fromEntries(o.causes.map((c: Row) => [c.cause, c]));

  return (
    <>
      <PageHeader title="Execution schedule" subtitle="Where every active project stands, what is running late, and why." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active projects" value={rows.length} />
        <Stat label="Expected to finish late" value={rows.filter((r) => r.slip > 0).length} tone={rows.some((r) => r.slip > 0) ? "red" : "green"} hint="Compared with the target handover" />
        <Stat label="Stages behind schedule" value={rows.reduce((n, r) => n + r.late, 0)} tone={behind.length ? "amber" : undefined} hint={behind.length ? `${behind.length} where the delay starts` : undefined} />
        <Stat label="Open blockers" value={blockers.length} tone={blockers.length ? "amber" : undefined} />
      </div>

      <Section title="Projects" className="mt-6">
        {rows.length === 0 ? <div className="p-4"><Empty title="No active projects" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-ink-3"><tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Project</th><th className="px-2 py-2 font-medium">Now</th><th className="px-2 py-2 font-medium">Stages</th>
                <th className="px-2 py-2 font-medium">Next milestone</th><th className="px-2 py-2 font-medium">Expected finish</th><th className="px-4 py-2 font-medium">Attention</th>
              </tr></thead>
              <tbody>
                {rows.map(({ p, stages, done, current, nextMilestone, proj, finish, slip }) => (
                  <tr key={p.id} className="border-b border-line align-top last:border-0 hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2"><HealthDot health={p.health} /><Link href={`/m/projects/${p.id}/schedule`} className="font-medium hover:underline">{p.name}</Link></div>
                      <div className="pl-[18px] text-xs text-ink-3">{p.project_code} · {p.pm_name ?? "No PM"}</div>
                    </td>
                    <td className="px-2 py-3">
                      {current ? <><div>{current.name}</div><div className="mt-0.5 flex flex-wrap gap-1"><Badge tone={STAGE_TONE[current.status]}>{STAGE_STATUS_LABEL[current.status]}</Badge>{current.status === "delayed" && <DelayBadge type={current.delay_type} />}</div></>
                        : stages.length ? <span className="text-emerald-700">All stages done</span> : <Link href={`/m/projects/${p.id}/schedule`} className="text-xs text-brand underline">Set up schedule</Link>}
                    </td>
                    <td className="px-2 py-3">
                      {stages.length > 0 && <><div className="h-1.5 w-24 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(100 * done) / stages.length}%` }} /></div><div className="mt-1 text-xs text-ink-3">{done} of {stages.length}</div></>}
                    </td>
                    <td className="px-2 py-3 text-xs">
                      {nextMilestone ? <><div className="text-sm text-ink">{nextMilestone.name}</div><div className={(proj.get(nextMilestone.id)?.slip ?? 0) > 0 ? "text-red-600" : "text-ink-3"}>{fmtDate(proj.get(nextMilestone.id)?.end ?? nextMilestone.planned_end_date, { year: false })}{(proj.get(nextMilestone.id)?.slip ?? 0) > 0 ? ` (+${proj.get(nextMilestone.id)!.slip}d)` : ""}</div></> : "—"}
                    </td>
                    <td className="px-2 py-3 text-xs">
                      <div className={`text-sm ${slip > 0 ? "font-medium text-red-600" : "text-ink"}`}>{fmtDate(finish, { year: false })}</div>
                      <div className="text-ink-3">{p.target_handover_date ? (slip > 0 ? `${slip} days after target` : slip < 0 ? `${-slip} days to spare` : "On target") : "No target date"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-2">
                      {p.reasons?.length ? p.reasons.join(" · ") : <Badge tone={HEALTH_TONE[p.health] ?? "gray"}>{HEALTH_LABEL[p.health] ?? "—"}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Section title={`Where the delays start (${behind.length})`}>
            {behind.length === 0 ? <div className="p-4"><Empty title="No stage is running late" /></div> : (
              <ul className="divide-y divide-line">
                {behind.map(({ s, r }) => {
                  const x = r.proj.get(s.id)!;
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <Link href={`/m/projects/${r.p.id}/schedule#stage-${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                        <div className="text-xs text-ink-3">{r.p.name} · planned {fmtDate(s.planned_end_date, { year: false })}, expected {fmtDate(x.end, { year: false })}{s.delay_reason ? ` · ${s.delay_reason}` : ""}</div>
                      </div>
                      {s.delay_type ? <DelayBadge type={s.delay_type} /> : <Badge>Cause not recorded</Badge>}
                      <span className="w-14 text-right text-xs font-medium text-red-600">+{x.slip} days</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title={`Open blockers (${blockers.length})`}>
            <BlockerList blockers={blockers} base="/m" showProject />
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="What is causing delays">
            <ul className="divide-y divide-line">
              {Object.entries(DELAY_LABEL).map(([k, v]) => {
                const c = causes[k];
                return (
                  <li key={k} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium">{v}</div><div className="text-xs text-ink-3">{DELAY_HINT[k]}</div></div>
                    <div className="text-right text-xs text-ink-3">
                      {c ? [c.blockers && `${c.blockers} blocker${c.blockers > 1 ? "s" : ""}`, c.stages && `${c.stages} delayed stage${c.stages > 1 ? "s" : ""}`, c.tasks && `${c.tasks} task${c.tasks > 1 ? "s" : ""} waiting`].filter(Boolean).join(" · ") : "—"}
                    </div>
                    <span className={`w-6 text-right text-lg font-semibold tabular-nums ${c?.n ? (k.startsWith("client") ? "text-amber-600" : "text-red-600") : "text-ink-3/50"}`}>{c?.n ?? 0}</span>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-3">Counts open blockers, stages marked delayed, and tasks due within 7 days that are still waiting for a client approval or purchase.</p>
          </Section>

          <Section title="Milestones in the next 30 days">
            {upcoming.length === 0 ? <p className="p-4 text-sm text-ink-3">None.</p> : (
              <ul className="divide-y divide-line">
                {upcoming.map(({ s, r, end }) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`h-2.5 w-2.5 rotate-45 ${(r.proj.get(s.id)?.slip ?? 0) > 0 ? "bg-red-500" : "bg-ink"}`} />
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{s.name}</div><div className="truncate text-xs text-ink-3">{r.p.name}</div></div>
                    <span className="text-xs text-ink-2">{fmtDate(end, { year: false })}</span>
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
