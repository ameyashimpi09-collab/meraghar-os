import Link from "next/link";
import { addDays, daysBetween, DELAY_LABEL, fmtDate } from "@/lib/format";
import { Badge, type Tone } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const STAGE_TONE: Record<string, Tone> = {
  completed: "green", in_progress: "blue", delayed: "red", on_hold: "amber", not_started: "gray", skipped: "gray",
};
export const TASK_TONE: Record<string, Tone> = {
  not_started: "gray", in_progress: "blue", waiting_client: "amber", waiting_vendor: "amber", blocked: "red", completed: "green", cancelled: "gray",
};

export function DelayBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  return <Badge tone={type.startsWith("client") ? "amber" : type === "company" ? "red" : "gray"}>{DELAY_LABEL[type]}</Badge>;
}

const KIND_WORD: Record<string, string> = { task: "task", approval: "client approval", purchase: "client purchase" };

/** "Waiting on client approval: Kitchen laminate (due 3 Dec)" chips. */
export function WaitingOn({ items, base = "/m" }: { items: any[] | null | undefined; base?: string }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {items.map((w, i) => {
        const label = (
          <>
            {`Waiting on ${KIND_WORD[w.kind]}:\u00a0`}<span className="font-medium">{w.label}</span>
            {w.due ? `\u00a0· ${w.kind === "approval" ? "decision due" : "due"} ${fmtDate(w.due, { year: false })}` : ""}
          </>
        );
        const cls = `inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${w.kind === "task" ? "border-line bg-canvas text-ink-2" : "border-amber-200 bg-amber-50 text-amber-900"}`;
        return w.kind === "approval" && base === "/m"
          ? <Link key={i} href={`/m/approvals/${w.ref_id}`} className={`${cls} hover:underline`}>{label}</Link>
          : <span key={i} className={cls}>{label}</span>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Gantt

export type GanttRow = {
  id: string;
  label: string;
  sub?: string;
  href?: string;
  start: string | null;
  end: string | null;
  projStart?: string | null;
  projEnd?: string | null;
  status: string;
  milestone?: boolean;
  pct?: number;
  slip?: number;
};

const BAR: Record<string, string> = {
  completed: "bg-emerald-500", in_progress: "bg-sky-500", delayed: "bg-red-500", on_hold: "bg-amber-500", not_started: "bg-stone-400", skipped: "bg-gray-300",
};

/** Gantt-style timeline: planned dates as a light bar, the expected dates as the solid bar. */
export function Gantt({ rows, today, endMarker }: { rows: GanttRow[]; today: string; endMarker?: { date: string | null; label: string } }) {
  const dates = rows.flatMap((r) => [r.start, r.end, r.projStart, r.projEnd]).filter(Boolean) as string[];
  if (endMarker?.date) dates.push(endMarker.date);
  if (!dates.length) return <p className="p-4 text-sm text-ink-3">Add dates to the stages to see the timeline.</p>;
  let from = dates.reduce((a, b) => (a < b ? a : b));
  let to = dates.reduce((a, b) => (a > b ? a : b));
  from = addDays(from, -3);
  to = addDays(to, 4);
  const span = Math.max(daysBetween(from, to), 14);
  const pos = (d: string) => (100 * daysBetween(from, d)) / span;
  const width = (a: string, b: string) => Math.max((100 * (daysBetween(a, b) + 1)) / span, 0.8);

  // Month ticks
  const ticks: { at: number; label: string }[] = [];
  let m = from.slice(0, 8) + "01";
  if (m < from) m = addDays(m, 32).slice(0, 8) + "01";
  while (m <= to) {
    ticks.push({ at: pos(m), label: fmtDate(m, { year: false }).replace(/^\d+\s/, "") + (m.slice(5, 7) === "01" ? ` ${m.slice(0, 4)}` : "") });
    m = addDays(m, 32).slice(0, 8) + "01";
  }
  const todayAt = today >= from && today <= to ? pos(today) : null;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[210px_1fr] border-b border-line text-[11px] text-ink-3">
          <div className="px-4 py-2">Stage</div>
          <div className="relative h-8">
            {ticks.map((t, i) => (
              <span key={i} className="absolute top-2 border-l border-line pl-1" style={{ left: `${t.at}%` }}>{t.label}</span>
            ))}
          </div>
        </div>
        {rows.map((r) => {
          const ps = r.projStart ?? r.start;
          const pe = r.projEnd ?? r.end;
          const moved = (r.projStart && r.projStart !== r.start) || (r.projEnd && r.projEnd !== r.end);
          return (
            <div key={r.id} className="grid grid-cols-[210px_1fr] border-b border-line last:border-0 hover:bg-canvas/50">
              <div className="min-w-0 px-4 py-2">
                {r.href ? <Link href={r.href} className="block truncate text-sm font-medium hover:underline">{r.label}</Link> : <div className="truncate text-sm font-medium">{r.label}</div>}
                <div className="truncate text-[11px] text-ink-3">{r.sub}</div>
              </div>
              <div className="relative h-12">
                {ticks.map((t, i) => <span key={i} className="absolute inset-y-0 border-l border-line/60" style={{ left: `${t.at}%` }} />)}
                {todayAt != null && <span className="absolute inset-y-0 z-10 border-l-2 border-brand/70" style={{ left: `${todayAt}%` }} />}
                {r.milestone && pe ? (
                  <span title={`${r.label}: ${fmtDate(pe)}`} className={`absolute top-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${r.status === "completed" ? "bg-emerald-500" : (r.slip ?? 0) > 0 ? "bg-red-500" : "bg-ink"}`} style={{ left: `${pos(pe) + 50 / span}%` }} />
                ) : (
                  <>
                    {moved && r.start && r.end && (
                      <span title={`Planned ${fmtDate(r.start)} – ${fmtDate(r.end)}`} className="absolute top-2 h-2 rounded-sm border border-dashed border-ink-3/60 bg-white" style={{ left: `${pos(r.start)}%`, width: `${width(r.start, r.end)}%` }} />
                    )}
                    {ps && pe && (
                      <span title={`${fmtDate(ps)} – ${fmtDate(pe)}`} className={`absolute ${moved ? "top-5" : "top-3.5"} h-4 overflow-hidden rounded-sm ${BAR[r.status] ?? "bg-stone-400"} ${r.status === "not_started" ? "opacity-60" : ""}`} style={{ left: `${pos(ps)}%`, width: `${width(ps, pe)}%` }}>
                        {r.pct != null && r.pct > 0 && r.pct < 100 && <span className="absolute inset-y-0 left-0 bg-black/20" style={{ width: `${r.pct}%` }} />}
                      </span>
                    )}
                  </>
                )}
                {(r.slip ?? 0) > 0 && pe && (
                  <span className="absolute top-[30px] z-20 text-[10px] font-medium whitespace-nowrap text-red-600" style={{ left: `calc(${Math.min(pos(pe) + 100 / span, 92)}% + 4px)` }}>+{r.slip}d</span>
                )}
              </div>
            </div>
          );
        })}
        {endMarker?.date && (
          <div className="grid grid-cols-[210px_1fr] text-[11px] text-ink-3">
            <div className="px-4 py-2">{endMarker.label}</div>
            <div className="relative h-8"><span className={`absolute top-2 rounded bg-ink px-1.5 py-0.5 whitespace-nowrap text-white ${pos(endMarker.date) > 85 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${pos(endMarker.date)}%` }}>{fmtDate(endMarker.date, { year: false })}</span></div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-ink-3">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-sky-500 align-middle" />In progress</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-emerald-500 align-middle" />Completed</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-stone-400 opacity-60 align-middle" />Not started</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-red-500 align-middle" />Delayed</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-dashed border-ink-3 bg-white align-middle" />Original plan (when dates are expected to move)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rotate-45 bg-ink align-middle" />Milestone</span>
        <span><span className="mr-1 inline-block h-3 border-l-2 border-brand/70 align-middle" />Today</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Calendar

export type CalItem = { date: string; label: string; href?: string; tone: "stage" | "milestone" | "task" | "overdue" | "done" };
const CAL_TONE: Record<CalItem["tone"], string> = {
  stage: "bg-sky-50 text-sky-800 border-sky-200",
  milestone: "bg-ink text-white border-ink",
  task: "bg-white text-ink-2 border-line",
  overdue: "bg-red-50 text-red-700 border-red-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

/** Month grid (Monday first). `month` is "YYYY-MM". */
export function CalendarMonth({ month, items, today, hrefFor }: { month: string; items: CalItem[]; today: string; hrefFor: (m: string) => string }) {
  const first = `${month}-01`;
  const dow = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -dow);
  const next = addDays(first, 32).slice(0, 7);
  const prev = addDays(first, -1).slice(0, 7);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = days[35].slice(0, 7) === month ? 6 : 5;
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  const title = new Date(first + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <Link href={hrefFor(prev)} className="rounded px-2 py-1 text-sm text-ink-2 hover:bg-canvas">‹ Prev</Link>
        <div className="text-sm font-semibold">{title}</div>
        <Link href={hrefFor(next)} className="rounded px-2 py-1 text-sm text-ink-2 hover:bg-canvas">Next ›</Link>
      </div>
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] text-ink-3">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.slice(0, weeks * 7).map((d) => {
          const its = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === month;
          return (
            <div key={d} className={`min-h-24 border-r border-b border-line p-1 last:border-r-0 sm:min-h-28 ${inMonth ? "" : "bg-canvas/60"}`}>
              <div className={`mb-1 text-right text-[11px] ${d === today ? "font-semibold text-brand" : inMonth ? "text-ink-3" : "text-ink-3/50"}`}>
                {d === today ? <span className="rounded bg-brand px-1 text-white">{Number(d.slice(8))}</span> : Number(d.slice(8))}
              </div>
              <div className="space-y-0.5">
                {its.slice(0, 4).map((it, i) => {
                  const cls = `block truncate rounded border px-1 py-0.5 text-[10px] leading-tight sm:text-[11px] ${CAL_TONE[it.tone]}`;
                  return it.href ? <Link key={i} href={it.href} className={`${cls} hover:underline`} title={it.label}>{it.label}</Link> : <span key={i} className={cls} title={it.label}>{it.label}</span>;
                })}
                {its.length > 4 && <span className="block text-[10px] text-ink-3">+{its.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
