import { addDays, daysBetween } from "./format";

// Works out where each stage is really heading, from its own dates, the
// stages it waits for, and today's date. Used to show the knock-on effect
// of a delay on everything downstream (and on the handover).

export type StageIn = {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  planned_end_date: string | null;
  actual_end_date: string | null;
  sort_order: number;
};
export type DepIn = { stage_id: string; depends_on_stage_id: string; lag_days: number };

export type Projection = {
  start: string | null;
  end: string | null;
  /** Days later than planned (0 if on time or early). */
  slip: number;
  /** The stage it is waiting for that pushes it out, if any. */
  pushedBy: string | null;
  /** True when the stage itself is running past its planned end. */
  late: boolean;
};

export function projectSchedule(stages: StageIn[], deps: DepIn[], today: string): Map<string, Projection> {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const preds = new Map<string, DepIn[]>();
  for (const d of deps) {
    if (!byId.has(d.stage_id) || !byId.has(d.depends_on_stage_id)) continue;
    preds.set(d.stage_id, [...(preds.get(d.stage_id) ?? []), d]);
  }
  const out = new Map<string, Projection>();
  const visiting = new Set<string>();

  const visit = (id: string): Projection => {
    const done = out.get(id);
    if (done) return done;
    const s = byId.get(id)!;
    if (visiting.has(id)) return { start: s.start_date, end: s.planned_end_date, slip: 0, pushedBy: null, late: false };
    visiting.add(id);

    let result: Projection;
    if (s.status === "completed") {
      const end = s.actual_end_date ?? s.planned_end_date;
      const slip = end && s.planned_end_date ? Math.max(0, daysBetween(s.planned_end_date, end)) : 0;
      result = { start: s.start_date, end, slip, pushedBy: null, late: false };
    } else if (s.status === "skipped") {
      result = { start: s.start_date, end: s.planned_end_date, slip: 0, pushedBy: null, late: false };
    } else {
      const length = s.start_date && s.planned_end_date ? daysBetween(s.start_date, s.planned_end_date) : 0;
      let start = s.start_date;
      let pushedBy: string | null = null;
      for (const d of preds.get(id) ?? []) {
        const p = visit(d.depends_on_stage_id);
        if (!p.end || byId.get(d.depends_on_stage_id)!.status === "skipped") continue;
        const earliest = addDays(p.end, 1 + (d.lag_days ?? 0));
        if (!start || earliest > start) {
          if (start && earliest > start) pushedBy = d.depends_on_stage_id;
          start = earliest;
        }
      }
      // Work that hasn't started can't start in the past
      if (start && s.status === "not_started" && start < today) start = today;
      let end = start ? addDays(start, length) : s.planned_end_date;
      // A stage still open after its planned end will finish today at the earliest
      let late = false;
      if (end && end < today) {
        end = today;
        late = true;
      }
      const slip = end && s.planned_end_date ? Math.max(0, daysBetween(s.planned_end_date, end)) : 0;
      if (slip > 0 && !pushedBy && s.planned_end_date && s.planned_end_date < today) late = true;
      result = { start, end, slip, pushedBy, late };
    }
    visiting.delete(id);
    out.set(id, result);
    return result;
  };

  for (const s of [...stages].sort((a, b) => a.sort_order - b.sort_order)) visit(s.id);
  return out;
}

/** All stages that (directly or indirectly) wait for this one. */
export function downstreamOf(stageId: string, deps: DepIn[]): string[] {
  const seen = new Set<string>();
  const stack = [stageId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const d of deps) {
      if (d.depends_on_stage_id === cur && !seen.has(d.stage_id)) {
        seen.add(d.stage_id);
        stack.push(d.stage_id);
      }
    }
  }
  seen.delete(stageId);
  return [...seen];
}
