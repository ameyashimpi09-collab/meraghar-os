import { fileUrl } from "@/lib/files";
import { AREAS, fmtDate, fmtDateTime, relDay } from "@/lib/format";
import { dims, PURCHASE_CATEGORIES, PURCHASE_STATUS_LABEL, PURCHASE_TONE, RESPONSIBILITY_LABEL } from "@/lib/release4";
import { purchaseStatusAction, removePurchaseAction, savePurchaseAction } from "@/app/actions/purchases";
import { ActionForm, Submit } from "./ActionForm";
import { FileInput } from "./FileInput";
import { Badge } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export const RISK_LABEL: Record<string, { label: string; tone: "red" | "amber" }> = {
  late: { label: "Late for site", tone: "red" },
  delayed: { label: "Delayed", tone: "red" },
  buy_now: { label: "Should be bought now", tone: "red" },
  buy_soon: { label: "Buy within 7 days", tone: "amber" },
  deliver_soon: { label: "Delivery due soon", tone: "amber" },
};

/** Add or edit a purchase item (project manager). */
export function PurchaseForm({ projectId, x, stages }: { projectId: string; x?: R; stages: R[] }) {
  return (
    <ActionForm action={savePurchaseAction} className="space-y-4" resetOnSuccess={!x}>
      {x ? <input type="hidden" name="id" value={x.id} /> : <input type="hidden" name="project_id" value={projectId} />}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="label">Item</label><input name="item_name" defaultValue={x?.item_name ?? ""} className="input" placeholder="e.g. Refrigerator" required /></div>
        <div><label className="label">Category</label><input name="category" list="pcats" defaultValue={x?.category ?? ""} className="input" /><datalist id="pcats">{PURCHASE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div><label className="label">Area</label><input name="area" list="pareas" defaultValue={x?.area ?? ""} className="input" /><datalist id="pareas">{AREAS.map((c) => <option key={c} value={c} />)}</datalist></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div><label className="label">Brand (if fixed)</label><input name="brand" defaultValue={x?.brand ?? ""} className="input" /></div>
        <div><label className="label">Model (if fixed)</label><input name="model" defaultValue={x?.model ?? ""} className="input" /></div>
        <div><label className="label">Quantity</label><input name="quantity" type="number" min={1} defaultValue={x?.quantity ?? 1} className="input" /></div>
        <div><label className="label">Who buys</label>
          <select name="responsibility" defaultValue={x?.responsibility ?? "client"} className="input">{Object.entries(RESPONSIBILITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-xs font-medium text-ink-2">Required size (leave blank if not relevant)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className="label">Width</label><input name="width" inputMode="decimal" defaultValue={x?.width ?? ""} className="input" /></div>
          <div><label className="label">Height</label><input name="height" inputMode="decimal" defaultValue={x?.height ?? ""} className="input" /></div>
          <div><label className="label">Depth</label><input name="depth" inputMode="decimal" defaultValue={x?.depth ?? ""} className="input" /></div>
          <div><label className="label">Unit</label><select name="unit" defaultValue={x?.unit ?? "mm"} className="input"><option value="mm">mm</option><option value="cm">cm</option><option value="m">metres</option><option value="in">inches</option></select></div>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">Description (client sees this)</label><textarea name="description" rows={2} defaultValue={x?.description ?? ""} className="input" /></div>
        <div><label className="label">Technical specifications</label><textarea name="technical_specs" rows={2} defaultValue={x?.technical_specs ?? ""} className="input" placeholder="e.g. 15A socket, water inlet on the left" /></div>
      </div>
      <div><label className="label">Suggested options (optional)</label><textarea name="suggested_options" rows={2} defaultValue={x?.suggested_options ?? ""} className="input" placeholder="e.g. Samsung RT42, LG GL-T422" /></div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div><label className="label">Buy by</label><input type="date" name="required_purchase_date" defaultValue={x?.required_purchase_date ?? ""} className="input" /></div>
        <div><label className="label">Needed at site by</label><input type="date" name="required_delivery_date" defaultValue={x?.required_delivery_date ?? ""} className="input" /></div>
        <div><label className="label">Installation</label><input type="date" name="installation_date" defaultValue={x?.installation_date ?? ""} className="input" /></div>
        <div><label className="label">Needed for stage</label>
          <select name="depends_on_stage_id" defaultValue={x?.depends_on_stage_id ?? ""} className="input"><option value="">—</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">Status</label>
          <select name="status" defaultValue={x?.status ?? "purchase_required"} className="input">{Object.entries(PURCHASE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <p className="mt-1 text-xs text-ink-3">“Purchase required” or “Client informed” sends the client a notification.</p></div>
        <div><label className="label">Team remarks (client does not see)</label><textarea name="manager_remarks" rows={2} defaultValue={x?.manager_remarks ?? ""} className="input" /></div>
      </div>
      <FileInput name="image" multiple={false} accept="image/jpeg,image/png,image/webp" label={x?.reference_image_path ? "Replace reference image" : "Reference image (optional)"} />
      <Submit pendingText="Saving…">{x ? "Save item" : "Add item"}</Submit>
    </ActionForm>
  );
}

/** One purchase item for the team: details, status change, edit. */
export function PurchaseCard({ x, stages, history }: { x: R; stages: R[]; history: R[] }) {
  const d = dims(x);
  const risk = x.risk ? RISK_LABEL[x.risk] : null;
  return (
    <li id={`p-${x.id}`} className="scroll-mt-20 px-4 py-4">
      <div className="flex gap-4">
        {x.reference_image_path ? <a href={fileUrl(x.reference_image_path)} target="_blank" className="shrink-0"><img src={fileUrl(x.reference_image_path)} alt="" className="h-20 w-20 rounded border border-line object-cover" /></a>
          : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-line text-[10px] text-ink-3">No image</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{x.item_name}{x.quantity > 1 ? ` × ${x.quantity}` : ""}</span>
            <Badge tone={PURCHASE_TONE[x.status]}>{PURCHASE_STATUS_LABEL[x.status]}</Badge>
            {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
            <span className="text-xs text-ink-3">{RESPONSIBILITY_LABEL[x.responsibility]}{x.area ? ` · ${x.area}` : ""}{x.category ? ` · ${x.category}` : ""}</span>
          </div>
          {d && <div className="mt-1 text-sm"><span className="font-medium tabular-nums">{d.main}</span> <span className="text-xs text-ink-3">≈ {d.alt}</span></div>}
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
            <span>Buy by <b>{fmtDate(x.required_purchase_date)}</b></span>
            <span>At site by <b className={x.risk === "late" ? "text-red-600" : ""}>{fmtDate(x.required_delivery_date)}</b>{x.required_delivery_date && !["delivered", "installed", "cancelled"].includes(x.status) ? ` (${relDay(x.required_delivery_date)})` : ""}</span>
            {x.installation_date && <span>Install {fmtDate(x.installation_date)}</span>}
            {x.stage_name && <span>For stage: {x.stage_name}</span>}
            {x.waiting_tasks > 0 && <span className="text-amber-700">{x.waiting_tasks} task{x.waiting_tasks > 1 ? "s" : ""} waiting on it</span>}
          </div>
          {(x.brand || x.model) && <div className="mt-1 text-xs text-ink-3">{[x.brand, x.model].filter(Boolean).join(" · ")}</div>}
          {x.client_remarks && <div className="mt-2 rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"><b>Client:</b> {x.client_remarks}{x.client_delivery_on ? ` · delivery on ${fmtDate(x.client_delivery_on)}` : ""}{x.client_updated_at ? ` · ${fmtDateTime(x.client_updated_at)}` : ""}</div>}
          {!x.client_remarks && x.client_delivery_on && <div className="mt-2 text-xs text-amber-900">Client delivery date: {fmtDate(x.client_delivery_on)}</div>}
          {x.manager_remarks && <div className="mt-1 text-xs text-ink-3">Team: {x.manager_remarks}</div>}

          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-brand hover:underline">Change status{x.can_manage ? " · edit item" : ""} · history</summary>
            <div className="mt-3 space-y-4">
              <ActionForm action={purchaseStatusAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={x.id} />
                <div><label className="label">Status</label><select name="status" defaultValue={x.status} className="input !w-auto">{Object.entries(PURCHASE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="min-w-48 flex-1"><label className="label">Team remark</label><input name="manager_remarks" className="input" placeholder="optional" /></div>
                <Submit className="btn-ghost">Update</Submit>
              </ActionForm>
              {history.length > 0 && (
                <ol className="space-y-1 border-l border-line pl-3 text-xs text-ink-3">
                  {history.map((h) => <li key={h.id}>{fmtDateTime(h.created_at)} · {h.old_status ? `${PURCHASE_STATUS_LABEL[h.old_status]} → ` : ""}<b className="text-ink-2">{PURCHASE_STATUS_LABEL[h.new_status]}</b> · {h.by_name ?? "System"}{h.by_role === "client" ? " (client)" : ""}{h.note ? ` · “${h.note}”` : ""}</li>)}
                </ol>
              )}
              {x.can_manage && (
                <div className="rounded-md border border-line p-3">
                  <PurchaseForm projectId={x.project_id} x={x} stages={stages} />
                  <ActionForm action={removePurchaseAction} confirm="Remove this item from the list?" className="mt-3 border-t border-line pt-3">
                    <input type="hidden" name="id" value={x.id} />
                    <Submit className="text-xs text-red-600 hover:underline" pendingText="Removing…">Remove item</Submit>
                  </ActionForm>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}
