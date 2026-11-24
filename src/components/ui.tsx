import Link from "next/link";
import { initials } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/15",
  brand: "bg-brand-soft text-brand-dark ring-brand/20",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ring-black/5 ${TONES[tone]}`}>{children}</span>;
}

export const PRIORITY_TONE: Record<string, Tone> = { critical: "red", high: "amber", medium: "blue", low: "gray" };
export const HEALTH_TONE: Record<string, Tone> = { green: "green", amber: "amber", red: "red" };
export const HEALTH_LABEL: Record<string, string> = { green: "On schedule", amber: "At risk", red: "Delayed" };

export function HealthDot({ health }: { health: string | null | undefined }) {
  const c = health === "red" ? "bg-red-500" : health === "amber" ? "bg-amber-500" : health === "green" ? "bg-emerald-500" : "bg-gray-300";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${c}`} title={health ? HEALTH_LABEL[health] : "Not active"} />;
}

export function Stat({ label, value, tone, href, hint }: { label: string; value: number | string; tone?: "red" | "amber" | "green"; href?: string; hint?: string }) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "green" ? "text-emerald-600" : "text-ink";
  const body = (
    <div className="card h-full p-4 transition hover:border-ink-3/40">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-medium text-brand-dark" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

export function Section({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children || "—"}</dd>
    </div>
  );
}
