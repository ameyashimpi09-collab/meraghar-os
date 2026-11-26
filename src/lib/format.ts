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

// ---------- Release 2: approvals and payments ----------
export const APPROVAL_STATUS_LABEL: Record<string, string> = {
  draft: "Draft · not sent",
  pending: "Waiting for client",
  approved: "Approved",
  changes_requested: "Changes requested",
  query_raised: "Client query",
  withdrawn: "Withdrawn",
};
export const APPROVAL_STATUS_CLIENT: Record<string, string> = {
  pending: "Awaiting your decision",
  approved: "Approved",
  changes_requested: "Being revised by our team",
  query_raised: "We are answering your query",
  withdrawn: "Withdrawn",
};
export const REVISION_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Sent to client",
  approved: "Approved",
  changes_requested: "Changes requested",
  query_raised: "Client query",
  superseded: "Replaced by a newer revision",
};
export const RESPONSE_LABEL: Record<string, string> = {
  approve: "Approved",
  request_changes: "Requested changes",
  raise_query: "Raised a query",
};
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  due: "Due",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  on_hold: "On hold",
};
export const AREAS = ["Living room", "Dining", "Kitchen", "Master bedroom", "Bedroom 2", "Bedroom 3", "Kids room", "Guest room", "Pooja room", "Study", "Foyer", "Balcony", "Bathroom", "Utility", "Whole home"];
export const APPROVAL_CATEGORIES = ["Design", "Carpentry", "Laminate", "Veneer", "Hardware", "Countertop", "Tiles", "Wall finish", "Paint", "Lighting", "Electrical", "Plumbing fixtures", "False ceiling", "Furniture", "Curtains & furnishing", "Appliances", "Other"];
export const PAYMENT_METHODS = ["Bank transfer (NEFT/RTGS/IMPS)", "UPI", "Cheque", "Cash", "Card", "Other"];

/** "1,50,000" or "150000.50" typed by a person -> paise. Returns NaN if invalid. */
export function rupeesToPaise(v: FormDataEntryValue | null | undefined): number {
  const s = String(v ?? "").replace(/[,₹\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

// ---------- Release 3: execution ----------
export const STAGE_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
  delayed: "Delayed",
  skipped: "Skipped",
};
export const DELAY_LABEL: Record<string, string> = {
  company: "Company-controlled",
  client_approval: "Client approval",
  client_purchase: "Client purchase",
  vendor: "Vendor",
  site_builder: "Site / builder",
};
export const DELAY_HINT: Record<string, string> = {
  company: "Our own team or planning",
  client_approval: "Waiting for the client to decide",
  client_purchase: "Waiting for an item the client is buying",
  vendor: "Supplier, factory or contractor",
  site_builder: "Society, builder, utilities or site access",
};
export const MEMBER_ROLE_SHORT: Record<string, string> = {
  project_manager: "Project manager", designer: "Designer", site_supervisor: "Site supervisor", execution: "Execution",
};

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(d: string, n: number): string {
  const t = Date.parse(d + "T00:00:00Z") + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
