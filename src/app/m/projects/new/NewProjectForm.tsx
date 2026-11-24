"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createProjectAction } from "../../actions";
import { PROPERTY_CONFIGS, POSSESSION_LABEL } from "@/lib/format";
import { ROLE_LABEL, type AppRole } from "@/lib/roles";

type Person = { id: string; full_name: string; role: AppRole; designation: string | null };

function Block({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-dark">{n}</span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-ink-3">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function NewProjectForm({ me, managers, designers, execution, clients, categories }: {
  me: { id: string; role: AppRole }; managers: Person[]; designers: Person[]; execution: Person[]; clients: Person[]; categories: string[];
}) {
  const [state, action, pending] = useActionState(createProjectAction, undefined);
  const [clientMode, setClientMode] = useState<"new" | "existing" | "later">("new");
  const [scope, setScope] = useState(categories.map((c) => ({ category: c, on: false })));
  const [custom, setCustom] = useState("");

  if (state?.projectId && state.tempPassword) {
    return (
      <div className="card mx-auto max-w-lg p-6">
        <div className="text-sm font-semibold text-emerald-700">Project created</div>
        <p className="mt-2 text-sm text-ink-2">The client&apos;s login is ready. Share these details with them personally. The password is shown only once, and they can change it after signing in.</p>
        <dl className="mt-4 space-y-2 rounded-md bg-canvas p-4 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-ink-3">Login email</dt><dd className="font-medium">{state.email}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-3">Temporary password</dt><dd className="font-mono font-medium">{state.tempPassword}</dd></div>
        </dl>
        <Link href={`/m/projects/${state.projectId}`} className="btn-brand mt-5 w-full">Open project</Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5 pb-24">
      <Block n={1} title="Client" hint="Each client gets their own login and only ever sees their own project.">
        <div className="mb-4 inline-flex rounded-md border border-line p-0.5 text-sm">
          {(["new", "existing", "later"] as const).map((m) => (
            <button type="button" key={m} onClick={() => setClientMode(m)}
              className={`rounded px-3 py-1.5 ${clientMode === m ? "bg-ink text-white" : "text-ink-2"}`}>
              {m === "new" ? "New client" : m === "existing" ? "Existing client" : "Add later"}
            </button>
          ))}
        </div>
        <input type="hidden" name="client_mode" value={clientMode} />
        {clientMode === "new" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">Client name *</label><input name="client_name" className="input" required placeholder="e.g. Amit Jain" /></div>
            <div><label className="label">Email (used as login) *</label><input name="client_email" type="email" className="input" required /></div>
            <div><label className="label">Primary contact number</label><input name="client_phone" className="input" placeholder="+91 98xxx xxxxx" /></div>
            <div><label className="label">Preferred communication</label>
              <select name="preferred_contact_method" className="input" defaultValue="whatsapp">
                <option value="whatsapp">WhatsApp</option><option value="phone">Phone call</option><option value="email">Email</option><option value="in_app">In the app</option>
              </select></div>
            <div><label className="label">Secondary contact name</label><input name="secondary_contact_name" className="input" placeholder="Optional" /></div>
            <div><label className="label">Secondary contact number</label><input name="secondary_contact_phone" className="input" placeholder="Optional" /></div>
          </div>
        )}
        {clientMode === "existing" && (
          <div className="max-w-md"><label className="label">Client *</label>
            <select name="client_id" className="input" required defaultValue="">
              <option value="" disabled>Choose a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select></div>
        )}
        {clientMode === "later" && <p className="text-sm text-ink-3">You can add the client from the project page later. The project will show up in the action centre until a client is added.</p>}
      </Block>

      <Block n={2} title="Project information">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3"><label className="label">Project name *</label><input name="name" className="input" required placeholder="e.g. Amit Jain – 2BHK, Baner" /></div>
          <div className="sm:col-span-2"><label className="label">Address</label><input name="address_line" className="input" /></div>
          <div><label className="label">Building / society</label><input name="building_society" className="input" /></div>
          <div><label className="label">Flat / unit number</label><input name="flat_number" className="input" /></div>
          <div><label className="label">City</label><input name="city" className="input" defaultValue="Pune" /></div>
          <div><label className="label">PIN code</label><input name="pincode" className="input" inputMode="numeric" /></div>
          <div><label className="label">Property configuration</label>
            <select name="property_config" className="input" defaultValue="">
              <option value="">Select</option>{PROPERTY_CONFIGS.map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div><label className="label">Approx. carpet area (sq ft)</label><input name="carpet_area_sqft" type="number" min="1" step="1" className="input" /></div>
          <div><label className="label">Possession status</label>
            <select name="possession_status" className="input" defaultValue="">
              <option value="">Select</option>{Object.entries(POSSESSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="label">Expected start date</label><input name="expected_start_date" type="date" className="input" /></div>
          <div><label className="label">Target handover date</label><input name="target_handover_date" type="date" className="input" /></div>
        </div>
      </Block>

      <Block n={3} title="Team assignment" hint="People only see projects they are assigned to.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Project manager</label>
            <select name="project_manager_id" className="input" defaultValue={me.role === "project_manager" ? me.id : ""}>
              <option value="">Not yet</option>
              {managers.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {ROLE_LABEL[p.role]}</option>)}
            </select></div>
          <div><label className="label">Designer</label>
            <select name="designer_id" className="input" defaultValue="">
              <option value="">Not yet</option>
              {designers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select></div>
        </div>
        <div className="mt-4">
          <div className="label">Execution team</div>
          {execution.filter((p) => p.role !== "designer").length === 0 ? <p className="text-sm text-ink-3">No site staff added yet. Add them from Team &amp; Clients.</p> : (
            <div className="flex flex-wrap gap-2">
              {execution.filter((p) => p.role !== "designer").map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="checkbox" name="execution_ids" value={p.id} className="accent-[var(--color-brand)]" />
                  {p.full_name} <span className="text-xs text-ink-3">{p.designation ?? ROLE_LABEL[p.role]}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Block>

      <Block n={4} title="Scope of work" hint="Tick what's included. Estimated cost is visible to management only, never to clients or site staff.">
        <div className="divide-y divide-line rounded-md border border-line">
          {scope.map((s, i) => (
            <div key={s.category + i} className={`grid items-center gap-2 px-3 py-2 sm:grid-cols-[200px_1fr_150px] ${s.on ? "bg-brand-soft/40" : ""}`}>
              <input type="hidden" name="scope_category" value={s.category} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`scope_included_${i}`} checked={s.on} className="accent-[var(--color-brand)]"
                  onChange={(e) => setScope(scope.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                {s.category}
              </label>
              <input name={`scope_description_${i}`} disabled={!s.on} placeholder={s.on ? "Short description" : ""} className="input py-1.5" />
              <input name={`scope_cost_${i}`} disabled={!s.on} inputMode="numeric" placeholder={s.on ? "Est. cost ₹" : ""} className="input py-1.5" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add a custom category" className="input max-w-xs" />
          <button type="button" className="btn-ghost" onClick={() => { if (custom.trim()) { setScope([...scope, { category: custom.trim(), on: true }]); setCustom(""); } }}>Add</button>
        </div>
      </Block>

      <Block n={5} title="Notes">
        <textarea name="description" rows={3} className="input" placeholder="Anything the team should know about this project" />
      </Block>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:left-[232px]">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-3">
          {state?.error && <p role="alert" className="mr-auto text-sm text-red-600">{state.error}</p>}
          <Link href="/m/projects" className="btn-ghost">Cancel</Link>
          <button disabled={pending} className="btn-brand">{pending ? "Creating…" : "Create project"}</button>
        </div>
      </div>
    </form>
  );
}
