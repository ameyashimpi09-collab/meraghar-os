"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type FormResult = { error?: string; ok?: string } | undefined;
type Action = (prev: FormResult, form: FormData) => Promise<FormResult>;

/**
 * A form that runs a server action and shows its result (error or success)
 * right inside the form. Use <Submit> inside it for a button that shows
 * "Saving…" while the action runs.
 */
export function ActionForm({
  action, children, className = "", resetOnSuccess = false, confirm,
}: { action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string }) {
  const [state, run] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && <p role="alert" className="form-error mt-2 w-full text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p role="status" className="form-ok mt-2 w-full text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, pendingText = "Saving…", className = "btn-brand", name, value }: {
  children: React.ReactNode; pendingText?: string; className?: string; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
