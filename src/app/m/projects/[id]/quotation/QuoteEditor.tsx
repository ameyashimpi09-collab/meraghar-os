"use client";

import { useMemo, useState } from "react";
import { ActionForm, Submit } from "@/components/ActionForm";
import { saveQuotationAction } from "@/app/m/quotations/actions";

type Row = { key: number; section: string; description: string; unit: string; quantity: string; rate: string; amount: string };
export type EditorQuote = {
  id: string; project_id: string; title: string | null; quote_number: string | null; quote_date: string | null; client_name: string | null;
  subtotal_paise: number | null; discount_paise: number | null; tax_paise: number | null; tax_label: string | null; grand_total_paise: number;
};
export type EditorItem = { section: string | null; description: string; unit: string | null; quantity: number | null; rate_paise: number | null; amount_paise: number };

const rs = (p: number | null | undefined) => (p == null ? "" : String(p / 100));
const num = (s: string) => {
  const v = Number(String(s).replace(/[,₹\s]/g, ""));
  return s.trim() && Number.isFinite(v) ? v : null;
};
const fmt = (r: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(r);

let nextKey = 1;
const toRow = (i: EditorItem): Row => ({
  key: nextKey++, section: i.section ?? "", description: i.description, unit: i.unit ?? "",
  quantity: i.quantity == null ? "" : String(i.quantity), rate: rs(i.rate_paise), amount: rs(i.amount_paise),
});
const blank = (section = ""): Row => ({ key: nextKey++, section, description: "", unit: "", quantity: "", rate: "", amount: "" });

export function QuoteEditor({ q, items }: { q: EditorQuote; items: EditorItem[] }) {
  const [rows, setRows] = useState<Row[]>(() => (items.length ? items.map(toRow) : [blank(), blank(), blank()]));
  const [subtotal, setSubtotal] = useState(rs(q.subtotal_paise));
  const [discount, setDiscount] = useState(rs(q.discount_paise));
  const [tax, setTax] = useState(rs(q.tax_paise));
  const [grand, setGrand] = useState(rs(q.grand_total_paise || null));

  const linesTotal = useMemo(() => rows.reduce((s, r) => s + (num(r.amount) ?? 0), 0), [rows]);
  const expected = (num(subtotal) ?? linesTotal) - (num(discount) ?? 0) + (num(tax) ?? 0);
  const g = num(grand);
  const subMismatch = num(subtotal) != null && Math.abs(linesTotal - num(subtotal)!) >= 1;
  const grandMismatch = g != null && Math.abs(expected - g) >= 1;

  const set = (key: number, field: keyof Row, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <ActionForm action={saveQuotationAction} className="space-y-4">
      <input type="hidden" name="id" value={q.id} />
      <input type="hidden" name="project_id" value={q.project_id} />

      <div className="grid gap-3 px-4 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><label className="label">Title</label><input name="title" defaultValue={q.title ?? ""} maxLength={200} className="input" placeholder="e.g. Interior quotation – 3 BHK" /></div>
        <div><label className="label">Quotation no.</label><input name="quote_number" defaultValue={q.quote_number ?? ""} maxLength={60} className="input" /></div>
        <div><label className="label">Date</label><input name="quote_date" type="date" defaultValue={q.quote_date ?? ""} className="input" /></div>
        <div className="sm:col-span-2"><label className="label">Client name on quotation</label><input name="client_name" defaultValue={q.client_name ?? ""} maxLength={120} className="input" /></div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr className="border-y border-line bg-canvas/60">
              <th className="w-8 px-2 py-2 text-right font-medium">#</th>
              <th className="w-36 px-1 py-2 font-medium">Room / area</th>
              <th className="px-1 py-2 font-medium">Item</th>
              <th className="w-20 px-1 py-2 text-right font-medium">Qty</th>
              <th className="w-20 px-1 py-2 font-medium">Unit</th>
              <th className="w-28 px-1 py-2 text-right font-medium">Rate (₹)</th>
              <th className="w-32 px-1 py-2 text-right font-medium">Amount (₹)</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const qn = num(r.quantity), rt = num(r.rate), am = num(r.amount);
              const off = qn != null && rt != null && am != null && Math.abs(qn * rt - am) > Math.max(1, am * 0.005);
              return (
                <tr key={r.key} className="quote-row border-b border-line align-top">
                  <td className="px-2 py-1.5 text-right text-xs text-ink-3 tabular-nums">{i + 1}</td>
                  <td className="px-1 py-1"><input name="section" value={r.section} onChange={(e) => set(r.key, "section", e.target.value)} maxLength={120} className="input py-1 text-xs" /></td>
                  <td className="px-1 py-1"><input name="description" value={r.description} onChange={(e) => set(r.key, "description", e.target.value)} maxLength={500} className="input py-1" /></td>
                  <td className="px-1 py-1"><input name="quantity" value={r.quantity} onChange={(e) => set(r.key, "quantity", e.target.value)} inputMode="decimal" className="input py-1 text-right tabular-nums" /></td>
                  <td className="px-1 py-1"><input name="unit" value={r.unit} onChange={(e) => set(r.key, "unit", e.target.value)} maxLength={30} className="input py-1 text-xs" /></td>
                  <td className="px-1 py-1"><input name="rate" value={r.rate} onChange={(e) => set(r.key, "rate", e.target.value)} inputMode="decimal" className="input py-1 text-right tabular-nums" /></td>
                  <td className="px-1 py-1">
                    <input name="amount" value={r.amount} onChange={(e) => set(r.key, "amount", e.target.value)} inputMode="decimal"
                      className={`input py-1 text-right tabular-nums ${off ? "border-amber-400 bg-amber-50" : ""}`}
                      title={off ? `Qty × rate = ${fmt(qn! * rt!)}` : undefined} />
                    {off && <div className="mt-0.5 text-right text-[11px] text-amber-700">Qty × rate = {fmt(qn! * rt!)}</div>}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-ink-3 hover:text-red-600">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4">
        <button type="button" onClick={() => setRows((rs) => [...rs, blank(rs[rs.length - 1]?.section ?? "")])} className="text-sm text-brand hover:underline">+ Add a line</button>
      </div>

      <div className="grid gap-4 border-t border-line px-4 pt-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-2 text-sm">
          <p className="text-ink-2">Lines add up to <b className="tabular-nums">{fmt(linesTotal)}</b> ({rows.filter((r) => r.description.trim()).length} lines).</p>
          {subMismatch && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">The lines add up to {fmt(linesTotal)}, but the subtotal is {fmt(num(subtotal)!)}. A line may be missing or misread: compare with the PDF.</p>}
          {grandMismatch && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">Subtotal − discount + tax = {fmt(expected)}, but the grand total is {fmt(g!)}. Please check.</p>}
          {!subMismatch && !grandMismatch && g != null && linesTotal > 0 && <p className="text-emerald-700">✓ The lines and totals match.</p>}
        </div>
        <dl className="grid grid-cols-[1fr_150px] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-right text-ink-2">Subtotal (₹)</dt>
          <dd><input name="subtotal" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} inputMode="decimal" className="input py-1 text-right tabular-nums" placeholder={String(Math.round(linesTotal))} /></dd>
          <dt className="text-right text-ink-2">Discount (₹)</dt>
          <dd><input name="discount" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="input py-1 text-right tabular-nums" /></dd>
          <dt className="flex items-center justify-end gap-2 text-ink-2">
            <input name="tax_label" defaultValue={q.tax_label ?? ""} maxLength={60} className="input w-28 py-1 text-xs" placeholder="GST 18%" aria-label="Tax label" /> Tax (₹)
          </dt>
          <dd><input name="tax" value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" className="input py-1 text-right tabular-nums" /></dd>
          <dt className="text-right font-semibold">Grand total (₹)</dt>
          <dd><input name="grand_total" value={grand} onChange={(e) => setGrand(e.target.value)} inputMode="decimal" className="input py-1 text-right font-semibold tabular-nums" required /></dd>
        </dl>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
        <span className="mr-auto text-xs text-ink-3">Confirming makes this the project’s quotation value. It can’t be edited afterwards; upload a revised quotation instead.</span>
        <Submit className="btn-ghost" name="intent" value="save" pendingText="Saving…">Save changes</Submit>
        <Submit name="intent" value="confirm" pendingText="Confirming…">Confirm quotation</Submit>
      </div>
    </ActionForm>
  );
}
