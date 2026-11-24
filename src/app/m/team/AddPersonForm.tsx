"use client";

import { useActionState, useRef, useEffect } from "react";
import { createPersonAction } from "../actions";
import { ROLE_LABEL, type AppRole } from "@/lib/roles";

export default function AddPersonForm({ roles }: { roles: AppRole[] }) {
  const [state, action, pending] = useActionState(createPersonAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.tempPassword) ref.current?.reset(); }, [state]);
  if (roles.length === 0) return null;
  const isClient = roles.length === 1 && roles[0] === "client";
  return (
    <form ref={ref} action={action} className="card h-fit space-y-3 p-4">
      <h2 className="text-sm font-semibold">{isClient ? "Add a client" : "Add a team member"}</h2>
      <div><label className="label">Role</label>
        <select name="role" className="input" defaultValue={roles[0]}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
      <div><label className="label">Full name</label><input name="full_name" className="input" required /></div>
      <div><label className="label">Email (login)</label><input name="email" type="email" className="input" required /></div>
      <div><label className="label">Phone</label><input name="phone" className="input" /></div>
      {!isClient && <div><label className="label">Designation</label><input name="designation" className="input" placeholder="e.g. Site Supervisor" /></div>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.tempPassword && (
        <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-medium">{state.ok}</div>
          <div className="mt-1 text-xs">Share these login details personally. The password is shown only once.</div>
          <div className="mt-2 text-xs">Email: <span className="font-medium">{state.email}</span></div>
          <div className="text-xs">Temporary password: <span className="font-mono font-semibold">{state.tempPassword}</span></div>
        </div>
      )}
      <button disabled={pending} className="btn-brand w-full">{pending ? "Creating…" : "Create account"}</button>
    </form>
  );
}
