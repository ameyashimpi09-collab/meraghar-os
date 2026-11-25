"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type FormResult = { error?: string; ok?: string } | undefined;
type Action = (prev: FormResult, form: FormData) => Promise<FormResult>;

const Pending = createContext<boolean | null>(null);

/**
 * A form that runs a server action and shows its result (error or success)
 * right inside the form. Use <Submit> inside it for a button that shows
 * "Saving…" while the action runs.
 *
 * The form is submitted by hand rather than through React's form action, so
 * that what the person typed stays in the fields when the action refuses it
 * (React would otherwise clear the form after every submit), and so that the
 * name/value of the button that was pressed is always sent.
 */
export function ActionForm({
  action, children, className = "", resetOnSuccess = false, confirm,
}: { action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string }) {
  const [state, run, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => run(data));
      }}
    >
      <Pending.Provider value={pending}>{children}</Pending.Provider>
      {state?.error && <p role="alert" className="form-error mt-2 w-full text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p role="status" className="form-ok mt-2 w-full text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, pendingText = "Saving…", className = "btn-brand", name, value }: {
  children: React.ReactNode; pendingText?: string; className?: string; name?: string; value?: string;
}) {
  const inActionForm = useContext(Pending);
  const status = useFormStatus();
  const pending = inActionForm ?? status.pending;
  return (
    <button type="submit" disabled={pending} className={className} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
