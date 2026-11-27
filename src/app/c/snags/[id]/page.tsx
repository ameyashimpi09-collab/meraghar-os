import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { fmtDateTime } from "@/lib/format";
import { snagDetail, SNAG_CATEGORY_LABEL, SNAG_CLIENT_LABEL } from "@/lib/release4";
import { ActionForm, Submit } from "@/components/ActionForm";
import { FileInput } from "@/components/FileInput";
import { PhotoGrid } from "@/components/client/Lightbox";
import { snagCommentAction, snagStepAction } from "@/app/actions/snags";

export const metadata = { title: "Concern" };

const EVENT: Record<string, string> = {
  raised: "You raised this concern", under_review: "Our team is reviewing it", assigned: "Assigned to our team", in_progress: "Work started",
  resolved: "Marked as resolved", confirmed: "You confirmed it is fixed", reopened: "Reopened",
};

export default async function ClientSnag({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser("client");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const d = await withUser(user.id, (db) => snagDetail(db, id)).catch(() => null);
  if (!d) notFound();
  const fresh = (await searchParams).new;
  const s = d.snag;
  const report = d.files.filter((f) => f.kind === "report" && (f.mime_type ?? "image/").startsWith("image/"));
  const fixes = d.files.filter((f) => f.kind === "resolution" && (f.mime_type ?? "image/").startsWith("image/"));
  const timeline = [
    ...d.events.map((e) => ({ at: e.created_at, text: EVENT[e.event] ?? e.event, note: e.note, who: e.actor_role === "client" ? null : e.actor_name })),
    ...d.comments.map((c) => ({ at: c.created_at, text: c.author_role === "client" ? "You wrote" : `${c.author_name} wrote`, note: c.body, who: null })),
  ].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const field = "mt-1 w-full border border-divider bg-paper px-3 py-2.5 text-sm";

  return (
    <>
      <Link href="/c/snags" className="text-sm text-stone hover:text-charcoal">← Snags &amp; concerns</Link>
      {fresh && <div className="mt-6 border-l-2 border-sage bg-sage-soft/60 px-5 py-3 text-sm">Thank you. Your project manager has been notified and will get back to you.</div>}
      <div className="mt-6 text-[11px] tracking-[0.25em] text-stone uppercase">{s.area} · {SNAG_CATEGORY_LABEL[s.category]}</div>
      <h1 className="mt-2 max-w-3xl font-serif text-4xl leading-tight">{s.description}</h1>
      <div className={`mt-3 text-sm ${s.status === "resolved" ? "text-sage" : s.status === "awaiting_client_confirmation" ? "text-amber" : "text-stone"}`}>{SNAG_CLIENT_LABEL[s.status]}{s.assignee_name && !["resolved"].includes(s.status) ? ` · ${s.assignee_name.split(" ")[0]} from our team is handling it` : ""}</div>

      {s.status === "awaiting_client_confirmation" && (
        <section className="mt-10 border border-amber/40 bg-amber-soft/50 p-6">
          <h2 className="font-serif text-2xl">Is it fixed?</h2>
          {s.resolution_note && <p className="mt-2 text-charcoal/80">{s.resolution_note}</p>}
          {fixes.length > 0 && <div className="mt-5"><PhotoGrid photos={fixes.map((f) => ({ src: fileUrl(f.storage_path), meta: `After the fix · ${fmtDateTime(f.created_at)}` }))} className="grid grid-cols-2 gap-2 sm:grid-cols-4" tile="aspect-square" /></div>}
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <ActionForm action={snagStepAction}><input type="hidden" name="snag_id" value={s.id} /><Submit name="step" value="confirm" className="bg-charcoal px-6 py-3 text-sm text-ivory hover:bg-black" pendingText="Saving…">Yes, it is fixed</Submit></ActionForm>
            <ActionForm action={snagStepAction} className="space-y-2">
              <input type="hidden" name="snag_id" value={s.id} />
              <label className="text-xs text-stone" htmlFor="reason">Not right yet? Tell us why</label>
              <textarea id="reason" name="note" rows={2} className={field} required />
              <Submit name="step" value="reopen" className="border border-charcoal px-5 py-2 text-sm hover:bg-paper">Reopen</Submit>
            </ActionForm>
          </div>
        </section>
      )}

      <div className="mt-12 grid gap-14 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-12">
          {report.length > 0 && <section><div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">Your photographs</div><PhotoGrid photos={report.map((f) => ({ src: fileUrl(f.storage_path), meta: fmtDateTime(f.created_at) }))} className="grid grid-cols-2 gap-2 sm:grid-cols-3" tile="aspect-square" /></section>}
          {fixes.length > 0 && s.status !== "awaiting_client_confirmation" && <section><div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">After the fix</div><PhotoGrid photos={fixes.map((f) => ({ src: fileUrl(f.storage_path), meta: fmtDateTime(f.created_at) }))} className="grid grid-cols-2 gap-2 sm:grid-cols-3" tile="aspect-square" /></section>}
        </div>
        <section>
          <div className="mb-4 text-[11px] tracking-[0.25em] text-stone uppercase">History</div>
          <ol className="space-y-5 border-l border-divider pl-5">
            {timeline.map((t, i) => (
              <li key={i} className="relative">
                <span className="absolute top-2 -left-[23px] h-1.5 w-1.5 rounded-full bg-stone" />
                <div className="text-sm">{t.text}{t.who ? <span className="text-stone"> · {t.who}</span> : null}</div>
                {t.note && <p className="mt-1 whitespace-pre-line text-[15px] text-charcoal/80">{t.note}</p>}
                <div className="mt-0.5 text-xs text-stone">{fmtDateTime(t.at)}</div>
              </li>
            ))}
          </ol>
          {s.status !== "resolved" && (
            <ActionForm action={snagCommentAction} className="mt-8 space-y-2" resetOnSuccess>
              <input type="hidden" name="snag_id" value={s.id} />
              <label className="text-xs text-stone" htmlFor="body">Message our team</label>
              <textarea id="body" name="body" rows={3} className={field} required />
              <FileInput name="photos" label="" />
              <Submit className="border border-charcoal px-5 py-2 text-sm hover:bg-paper" pendingText="Sending…">Send</Submit>
            </ActionForm>
          )}
          {s.status === "resolved" && s.client_confirmed_at && <p className="mt-8 text-sm text-sage">Closed with your confirmation on {fmtDateTime(s.client_confirmed_at)}.</p>}
        </section>
      </div>
    </>
  );
}
