"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-8 space-y-5">
      <div>
        <label className="mb-1.5 block text-xs tracking-wide text-stone uppercase" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          className="w-full border-0 border-b border-divider bg-transparent px-0 py-2 text-charcoal outline-none focus:border-charcoal" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs tracking-wide text-stone uppercase" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className="w-full border-0 border-b border-divider bg-transparent px-0 py-2 text-charcoal outline-none focus:border-charcoal" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-alert">{state.error}</p>}
      <button disabled={pending} className="w-full bg-charcoal py-3 text-sm tracking-wide text-ivory transition hover:bg-black disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-xs text-stone">Forgot your password? Please contact your project manager.</p>
    </form>
  );
}
