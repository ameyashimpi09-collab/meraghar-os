"use client";

import { useActionState } from "react";
import { changePassword, updateMyContact } from "@/app/actions/auth";

export function ContactForm({ phone, pref, tone = "internal" }: { phone: string | null; pref: string; tone?: "internal" | "client" }) {
  const [state, action, pending] = useActionState(updateMyContact, undefined);
  const input = tone === "client" ? "w-full border-0 border-b border-divider bg-transparent px-0 py-2 outline-none focus:border-charcoal" : "input";
  return (
    <form action={action} className="space-y-3">
      <div><label className="label">Phone</label><input name="phone" defaultValue={phone ?? ""} className={input} /></div>
      <div><label className="label">Preferred communication</label>
        <select name="preferred_contact_method" defaultValue={pref} className={input}>
          <option value="whatsapp">WhatsApp</option><option value="phone">Phone call</option><option value="email">Email</option><option value="in_app">In the app</option>
        </select></div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
      <button disabled={pending} className={tone === "client" ? "bg-charcoal px-5 py-2 text-sm text-ivory" : "btn-primary"}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}

export function PasswordForm({ tone = "internal" }: { tone?: "internal" | "client" }) {
  const [state, action, pending] = useActionState(changePassword, undefined);
  const input = tone === "client" ? "w-full border-0 border-b border-divider bg-transparent px-0 py-2 outline-none focus:border-charcoal" : "input";
  return (
    <form action={action} className="space-y-3">
      <div><label className="label">Current password</label><input name="current" type="password" autoComplete="current-password" required className={input} /></div>
      <div><label className="label">New password (8+ characters)</label><input name="next" type="password" autoComplete="new-password" required minLength={8} className={input} /></div>
      <div><label className="label">Confirm new password</label><input name="confirm" type="password" autoComplete="new-password" required className={input} /></div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
      <button disabled={pending} className={tone === "client" ? "bg-charcoal px-5 py-2 text-sm text-ivory" : "btn-primary"}>{pending ? "Updating…" : "Change password"}</button>
    </form>
  );
}
