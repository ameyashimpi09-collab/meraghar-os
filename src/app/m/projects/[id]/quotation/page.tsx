import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { fmtDate, fmtDateTime, inr } from "@/lib/format";
import { DEFAULT_SCHEDULE, projectQuotations } from "@/lib/quotations";
import { quoteReaderConfigured } from "@/lib/quoteReader";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { discardQuotationAction, uploadQuotationAction } from "@/app/m/quotations/actions";
import { QuoteEditor } from "./QuoteEditor";
import { ScheduleForm } from "./ScheduleForm";

export const metadata = { title: "Quotation" };
// Reading a long quotation can take a minute or two.
export const maxDuration = 300;

type Item = { section: string | null; description: string; unit: string | null; quantity: number | null; rate_paise: number | null; amount_paise: number };

function ItemsTable({ items }: { items: Item[] }) {
  let last: string | null = null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qty</th>
            <th className="px-2 py-2 text-right font-medium">Rate</th><th className="px-4 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.flatMap((it, i) => {
            const out = [];
            if (it.section && it.section !== last) {
              out.push(<tr key={`s${i}`} className="bg-canvas/60"><td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">{it.section}</td></tr>);
            }
            last = it.section;
            out.push(
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{it.description}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums text-ink-2">{it.quantity != null ? `${it.quantity.toLocaleString("en-IN")}${it.unit ? ` ${it.unit}` : ""}` : it.unit ?? "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-2">{it.rate_paise != null ? inr(it.rate_paise) : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{inr(it.amount_paise)}</td>
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

function UploadForm({ projectId, replacing, aiOn }: { projectId: string; replacing: boolean; aiOn: boolean }) {
  return (
    <ActionForm action={uploadQuotationAction} className="space-y-3 p-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div>
        <label className="label">{replacing ? "Revised quotation PDF" : "Quotation PDF"}</label>
        <input type="file" name="pdf" accept="application/pdf,.pdf" required
          className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-canvas" />
        <p className="mt-1 text-xs text-ink-3">PDF up to 4 MB. The app reads every line item (name, quantity, rate, amount) and the grand total, then shows them here for you to check before anything is saved to the project.</p>
      </div>
      <div className="flex justify-end">
        {aiOn
          ? <Submit pendingText="Reading the quotation… this can take up to a minute">{replacing ? "Upload and read revised quotation" : "Upload and read quotation"}</Submit>
          : <Submit pendingText="Uploading…">{replacing ? "Upload revised quotation and enter lines" : "Upload quotation and enter lines"}</Submit>}
      </div>
    </ActionForm>
  );
}

export default async function QuotationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmed?: string }> }) {
  const user = await requireUser("management");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await withUser(user.id, async (db) => {
    const p = (await db.query("select id, name, project_code, can_manage_project(id) as can_manage from projects where id = $1 and deleted_at is null", [id])).rows[0];
    if (!p) return null;
    if (!p.can_manage) return { p, denied: true as const };
    const q = await projectQuotations(db, id);
    const pay = (await db.query(
      "select count(*)::int as n, coalesce(sum(amount_paise), 0) as total from payment_milestones where project_id = $1 and deleted_at is null", [id])).rows[0];
    return { p, denied: false as const, ...q, pay };
  });
  if (!data) notFound();
  if (data.denied) return <p className="text-sm text-ink-3">Only this project’s manager or an owner/admin can see its quotation.</p>;
  const { p, draft, current, history, itemsOf, pay } = data;
  const aiOn = quoteReaderConfigured();
  const justConfirmed = (await searchParams).confirmed === "1" && current && !draft;

  return (
    <>
      <div className="mb-1 text-xs text-ink-3"><Link href="/m/projects" className="hover:underline">Projects</Link> / <Link href={`/m/projects/${p.id}`} className="hover:underline">{p.project_code}</Link></div>
      <PageHeader title={`Quotation · ${p.name}`} subtitle="Upload the quotation PDF. The app reads the items and grand total for you to check, and the confirmed quotation becomes the project’s value. Visible to management only." />

      {!aiOn && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>Automatic reading unavailable: AI credits not available.</b> You can still upload the quotation PDF: it is saved with the project and you type the lines and grand total in by hand. Reading switches on automatically once the Claude API key is added.
        </div>
      )}

      {justConfirmed && (
        <div role="status" className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✓ Quotation confirmed and saved to the project. {pay.n === 0 ? "You can now create the payment schedule from it below." : "Compare it with the payment schedule below."}
        </div>
      )}

      {current && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Quotation value" value={inr(current.grand_total_paise)} hint={current.quote_number ? `No. ${current.quote_number}` : "Confirmed"} />
          <Stat label="Payment schedule" value={inr(pay.total)} hint={`${pay.n} milestone${pay.n === 1 ? "" : "s"}`} href={`/m/projects/${p.id}/payments`} />
          <Stat label="Not yet in schedule" value={inr(Math.max(0, current.grand_total_paise - pay.total))}
            tone={current.grand_total_paise - pay.total > 0 ? "amber" : "green"}
            hint={pay.total > current.grand_total_paise ? `Schedule is ${inr(pay.total - current.grand_total_paise)} more than the quotation` : current.grand_total_paise === pay.total ? "Fully scheduled" : "Add milestones to cover it"} />
          <Stat label="Line items" value={current.item_count} hint={`Confirmed ${fmtDateTime(current.confirmed_at)}`} />
        </div>
      )}

      {draft && (
        <div id="review" className="mb-6 scroll-mt-20">
          <Section title="Check the quotation before saving" action={<Badge tone="amber">Not saved to the project yet</Badge>}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-canvas/40 px-4 py-2.5 text-xs text-ink-2">
              {draft.file_id && <a href={fileUrl(draft.file_id)} target="_blank" rel="noopener" className="font-medium text-brand hover:underline">Open the PDF ({draft.file_name}) ↗</a>}
              <span>Uploaded by {draft.created_by_name} · {fmtDateTime(draft.created_at)}</span>
              <span>{draft.read_by?.startsWith("ai") ? `Read automatically: ${draft.item_count} line${draft.item_count === 1 ? "" : "s"}` : "Entered by hand"}</span>
            </div>
            {draft.read_notes && (
              <p className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><span className="font-medium">Please check: </span>{draft.read_notes}</p>
            )}
            <QuoteEditor q={draft} items={itemsOf(draft.id)} />
            <ActionForm action={discardQuotationAction} className="border-t border-line px-4 py-2.5 text-right" confirm="Discard this quotation and its PDF?">
              <input type="hidden" name="id" value={draft.id} />
              <Submit className="text-xs text-ink-3 hover:text-red-600" pendingText="Discarding…">Discard this upload</Submit>
            </ActionForm>
          </Section>
        </div>
      )}

      {current ? (
        <Section title={current.title || "Confirmed quotation"} className="mb-6"
          action={<span className="text-xs text-ink-3">{[current.quote_number && `No. ${current.quote_number}`, current.quote_date && fmtDate(current.quote_date)].filter(Boolean).join(" · ")}</span>}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-ink-2">
            {current.file_id && <a href={fileUrl(current.file_id)} target="_blank" rel="noopener" className="font-medium text-brand hover:underline">Open the PDF ↗</a>}
            {current.client_name && <span>For {current.client_name}</span>}
            <span>Confirmed by {current.confirmed_by_name} · {fmtDateTime(current.confirmed_at)}</span>
          </div>
          <ItemsTable items={itemsOf(current.id)} />
          <dl className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-sm">
            {current.subtotal_paise != null && <><dt className="text-ink-2">Subtotal</dt><dd className="text-right tabular-nums">{inr(current.subtotal_paise)}</dd></>}
            {!!current.discount_paise && <><dt className="text-ink-2">Discount</dt><dd className="text-right tabular-nums">− {inr(current.discount_paise)}</dd></>}
            {current.tax_paise != null && <><dt className="text-ink-2">{current.tax_label || "Tax"}</dt><dd className="text-right tabular-nums">{inr(current.tax_paise)}</dd></>}
            <dt className="font-semibold">Grand total</dt><dd className="text-right font-semibold tabular-nums">{inr(current.grand_total_paise)}</dd>
          </dl>
        </Section>
      ) : !draft && (
        <Section title="No quotation yet" className="mb-6"><div className="p-4"><Empty title="Upload the quotation PDF below">The line items and grand total will be read for you.</Empty></div></Section>
      )}

      {current && pay.n === 0 && (
        <Section title="Create the payment schedule from this quotation" className="mb-6">
          <ScheduleForm projectId={p.id} totalPaise={current.grand_total_paise} preset={DEFAULT_SCHEDULE} />
        </Section>
      )}

      <Section title={current || draft ? "Upload a revised quotation" : "Upload quotation"} className="mb-6">
        {draft && <p className="border-b border-line px-4 py-2 text-xs text-ink-3">Uploading again replaces the unconfirmed upload above.</p>}
        {current && <p className="border-b border-line px-4 py-2 text-xs text-ink-3">The current quotation stays in place until you confirm the revised one. It is then kept below as history.</p>}
        <UploadForm projectId={p.id} replacing={Boolean(current || draft)} aiOn={aiOn} />
      </Section>

      {history.length > 0 && (
        <Section title="Earlier quotations">
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">{h.title || h.quote_number || "Quotation"}<span className="ml-2 text-xs text-ink-3">confirmed {fmtDateTime(h.confirmed_at)} by {h.confirmed_by_name}</span></span>
                {h.file_id && <a href={fileUrl(h.file_id)} target="_blank" rel="noopener" className="text-xs text-brand hover:underline">PDF</a>}
                <span className="tabular-nums">{inr(h.grand_total_paise)}</span>
                <Badge>Replaced</Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
