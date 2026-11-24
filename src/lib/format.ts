const TZ = "Asia/Kolkata";

/** ₹ in Indian grouping (1,00,000) from paise. */
export function inr(paise: number | null | undefined, opts: { decimals?: boolean } = {}) {
  if (paise == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: opts.decimals ? 2 : 0,
    minimumFractionDigits: opts.decimals ? 2 : 0,
  }).format(paise / 100);
}

/** "2026-12-10" -> "10 Dec 2026" (calendar dates have no timezone). */
export function fmtDate(d: string | null | undefined, opts: { year?: boolean } = { year: true }) {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(opts.year === false ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** Timestamps are stored in UTC and shown in India time. */
export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function daysBetween(from: string, to: string) {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** "in 3 days", "today", "2 days ago" relative to today in India. */
export function relDay(d: string | null | undefined) {
  if (!d) return "";
  const n = daysBetween(todayIST(), d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days overdue`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function greeting() {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: TZ }));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export const PROPERTY_CONFIGS = ["1 RK", "1 BHK", "2 BHK", "2.5 BHK", "3 BHK", "4 BHK", "5 BHK", "Penthouse", "Row house", "Villa", "Bungalow", "Office", "Retail / Shop", "Other"];

export const POSSESSION_LABEL: Record<string, string> = {
  awaiting_possession: "Awaiting possession",
  possession_received: "Possession received",
  occupied: "Occupied",
  under_renovation: "Under renovation",
};

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting_client: "Waiting for client",
  waiting_vendor: "Waiting for vendor",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
