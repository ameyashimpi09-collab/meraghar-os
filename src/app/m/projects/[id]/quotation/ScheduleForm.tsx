"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/ActionForm";
import { scheduleFromQuotationAction } from "@/app/m/quotations/actions";

const fmt = (r: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(r);

/** Turn the confirmed quotation into a payment schedule by percentages. */
export function ScheduleForm({ projectId, totalPaise, preset }: { projectId: string; totalPaise: number; preset: { name: string; pct: number }[] }) {
  const [rows, setRows] = useState(preset.map((p, i) => ({ key: i, name: p.name, pct: String(p.pct) })));
  const sum = rows.reduce((s, r) => s + (Number(r.pct) || 0), 0);
  const total = totalPaise / 100;
  return (
    <ActionForm action={scheduleFromQuotationAction} className="p-4">
      <input type="hidden" name="project_id" value={projectId} />
      <p className="mb-3 text-sm text-ink-2">Set up the payment schedule from this quotation in one step. Adjust the names and percentages to match what the client agreed. Due dates can be set on the Payments page.</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[1fr_80px_110px_24px] items-center gap-2">
            <input name="ms_name" value={r.name} maxLength={120} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} className="input py-1" aria-label="Milestone name" />
            <div className="relative"><input name="ms_pct" value={r.pct} inputMode="decimal" onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, pct: e.target.value } : x)))} className="input py-1 pr-6 text-right tabular-nums" aria-label="Percent" /><span className="absolute right-2 top-1.5 text-xs text-ink-3">%</span></div>
            <span className="text-right text-sm tabular-nums text-ink-2">{fmt(Math.round((total * (Number(r.pct) || 0)) / 100))}</span>
            <button type="button" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-ink-3 hover:text-red-600">×</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-sm text-brand hover:underline" onClick={() => setRows((rs) => [...rs, { key: Date.now(), name: "", pct: "" }])}>+ Add milestone</button>
        <span className={`text-sm ${Math.abs(sum - 100) < 0.01 ? "text-emerald-700" : "text-amber-700"}`}>Total {Math.round(sum * 100) / 100}% {Math.abs(sum - 100) < 0.01 ? "✓" : "(must be 100%)"}</span>
      </div>
      <div className="mt-3 flex justify-end"><Submit pendingText="Creating…">Create payment schedule</Submit></div>
    </ActionForm>
  );
}
