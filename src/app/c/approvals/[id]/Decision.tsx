"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { respondToApprovalAction } from "../../actions";

function Send({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="mt-5 w-full bg-charcoal px-6 py-3.5 text-sm tracking-wide text-ivory transition hover:bg-black disabled:opacity-60 sm:w-auto">
      {pending ? "Sending…" : children}
    </button>
  );
}

const TABS = [
  { key: "approve", label: "Approve" },
  { key: "request_changes", label: "Request changes" },
  { key: "raise_query", label: "Ask a question" },
] as const;

export function Decision({ approvalId, revisionId, revisionNo, title }: { approvalId: string; revisionId: string; revisionNo: number; title: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("approve");
  const [state, action] = useActionState(respondToApprovalAction, undefined);
  if (state?.ok) {
    return <div className="border border-sage/40 bg-sage-soft px-6 py-5 text-charcoal" role="status">{state.ok}</div>;
  }
  return (
    <div className="border border-divider bg-paper">
      <div className="grid grid-cols-3 border-b border-divider text-center text-sm">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-2 py-3.5 transition ${tab === t.key ? "bg-ivory font-medium text-charcoal" : "text-stone hover:text-charcoal"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <form action={action} className="p-5 sm:p-6">
        <input type="hidden" name="approval_id" value={approvalId} />
        <input type="hidden" name="revision_id" value={revisionId} />
        <input type="hidden" name="action" value={tab} />
        {tab === "approve" ? (
          <>
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4 accent-[#2b2925]" />
              <span>I approve <b>revision {revisionNo}</b> of “{title}” exactly as shown on this page, including the specifications and any commercial impact.</span>
            </label>
            <textarea name="comment" rows={2} maxLength={2000} placeholder="Add a note (optional)" className="mt-4 w-full border border-divider bg-white px-3 py-2.5 text-sm outline-none focus:border-charcoal" />
            <Send>Confirm approval</Send>
          </>
        ) : (
          <>
            <textarea name="comment" rows={4} required maxLength={2000}
              placeholder={tab === "raise_query" ? "What would you like to know?" : "What would you like changed? Please be as specific as you can."}
              className="w-full border border-divider bg-white px-3 py-2.5 text-sm outline-none focus:border-charcoal" />
            <Send>{tab === "raise_query" ? "Send question" : "Request changes"}</Send>
          </>
        )}
        {state?.error && <p role="alert" className="mt-3 text-sm text-alert">{state.error}</p>}
        <p className="mt-4 text-xs text-stone">Your response is recorded with your name and the time, and shared with your project manager.</p>
      </form>
    </div>
  );
}
