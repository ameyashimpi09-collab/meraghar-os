"use client";

import { useActionState, useState } from "react";
import { addMemberAction, resetPasswordAction, updateProjectAction } from "../../actions";
import { PROPERTY_CONFIGS, POSSESSION_LABEL, PROJECT_STATUS_LABEL } from "@/lib/format";
import { MEMBER_ROLE_LABEL, ROLE_LABEL, type AppRole } from "@/lib/roles";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function EditProjectForm({ p }: { p: any }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateProjectAction, undefined);
  if (!open) return <button onClick={() => setOpen(true)} className="btn-ghost py-1.5 text-xs">Edit details</button>;
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-10" onClick={() => setOpen(false)}>
      <form action={action} onClick={(e) => e.stopPropagation()} className="card w-full max-w-3xl space-y-4 p-5">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Edit project</h2><button type="button" onClick={() => setOpen(false)} className="text-ink-3">✕</button></div>
        <input type="hidden" name="id" value={p.id} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><label className="label">Project name</label><input name="name" defaultValue={p.name} className="input" required /></div>
          <div><label className="label">Status</label>
            <select name="status" defaultValue={p.status} className="input">{Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label">Address</label><input name="address_line" defaultValue={p.address_line ?? ""} className="input" /></div>
          <div><label className="label">Building / society</label><input name="building_society" defaultValue={p.building_society ?? ""} className="input" /></div>
          <div><label className="label">Flat number</label><input name="flat_number" defaultValue={p.flat_number ?? ""} className="input" /></div>
          <div><label className="label">City</label><input name="city" defaultValue={p.city ?? ""} className="input" /></div>
          <div><label className="label">PIN code</label><input name="pincode" defaultValue={p.pincode ?? ""} className="input" /></div>
          <div><label className="label">Configuration</label>
            <select name="property_config" defaultValue={p.property_config ?? ""} className="input"><option value="">—</option>{PROPERTY_CONFIGS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Carpet area (sq ft)</label><input name="carpet_area_sqft" type="number" defaultValue={p.carpet_area_sqft ?? ""} className="input" /></div>
          <div><label className="label">Possession</label>
            <select name="possession_status" defaultValue={p.possession_status ?? ""} className="input"><option value="">—</option>{Object.entries(POSSESSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label">Expected start</label><input name="expected_start_date" type="date" defaultValue={p.expected_start_date ?? ""} className="input" /></div>
          <div><label className="label">Target handover</label><input name="target_handover_date" type="date" defaultValue={p.target_handover_date ?? ""} className="input" /></div>
          <div><label className="label">Actual handover</label><input name="actual_handover_date" type="date" defaultValue={p.actual_handover_date ?? ""} className="input" /></div>
          <div className="sm:col-span-3"><label className="label">Notes</label><textarea name="description" defaultValue={p.description ?? ""} rows={3} className="input" /></div>
        </div>
        <div className="flex items-center justify-end gap-3">
          {state?.error && <p className="mr-auto text-sm text-red-600">{state.error}</p>}
          {state?.ok && <p className="mr-auto text-sm text-emerald-700">{state.ok}</p>}
          <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Close</button>
          <button disabled={pending} className="btn-brand">{pending ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}

type Person = { id: string; full_name: string; role: AppRole };
const ROLE_FOR: Record<string, AppRole[]> = {
  project_manager: ["owner", "admin", "project_manager"],
  designer: ["designer"],
  site_supervisor: ["site_supervisor"],
  execution: ["execution", "site_supervisor", "designer"],
  client: ["client"],
};

export function AddMemberForm({ projectId, people }: { projectId: string; people: Person[] }) {
  const [state, action, pending] = useActionState(addMemberAction, undefined);
  const [role, setRole] = useState("execution");
  const options = people.filter((p) => ROLE_FOR[role].includes(p.role));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div><label className="label">Assign as</label>
        <select name="member_role" value={role} onChange={(e) => setRole(e.target.value)} className="input py-1.5">
          {Object.entries(MEMBER_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div className="min-w-48 flex-1"><label className="label">Person</label>
        <select name="profile_id" className="input py-1.5" defaultValue="" key={role}>
          <option value="" disabled>{options.length ? "Choose" : "Nobody available"}</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {ROLE_LABEL[p.role]}</option>)}
        </select></div>
      <button disabled={pending} className="btn-ghost py-1.5">{pending ? "Adding…" : "Add"}</button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="w-full text-xs text-emerald-700">{state.ok}</p>}
    </form>
  );
}

export function ResetPasswordButton({ profileId }: { profileId: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="text-xs">
      <input type="hidden" name="profile_id" value={profileId} />
      {state?.tempPassword ? (
        <div className="rounded bg-amber-50 px-2 py-1.5 text-amber-900">New password (shown once): <span className="font-mono font-semibold">{state.tempPassword}</span></div>
      ) : (
        <button disabled={pending} className="text-brand hover:underline">{pending ? "Resetting…" : "Reset password"}</button>
      )}
      {state?.error && <p className="text-red-600">{state.error}</p>}
    </form>
  );
}
