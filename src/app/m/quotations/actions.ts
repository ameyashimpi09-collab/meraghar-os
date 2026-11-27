"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import { MAX_FILE_BYTES, saveFile } from "@/lib/files";
import { rupeesToPaise } from "@/lib/format";
import { QUOTE_MODEL, QuoteReadError, readQuotationPdf, type ReadQuote } from "@/lib/quoteReader";
import { replaceItems, type QuoteItem } from "@/lib/quotations";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const toPaise = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(Math.abs(n) * 100));
const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);
const isoDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

function refresh() {
  revalidatePath("/", "layout");
}

/** Upload the quotation PDF, read it, and keep the result as a draft for checking. */
export async function uploadQuotationAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const pid = id.safeParse(form.get("project_id"));
  if (!pid.success) return { error: "Project not found." };
  const f = form.get("pdf");
  if (!(f instanceof File) || f.size === 0) return { error: "Choose the quotation PDF first." };
  if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return { error: "Please upload the quotation as a PDF file." };
  if (f.size > MAX_FILE_BYTES) return { error: "This PDF is larger than 4 MB. Please export a smaller copy (e.g. 'Reduce file size' when saving) and try again." };
  const pdf = new File([await f.arrayBuffer()], f.name || "quotation.pdf", { type: "application/pdf" });

  // Check permission before spending time reading the PDF.
  const allowed = await withUser(me.id, async (db) => (await db.query("select can_manage_project($1) as ok", [pid.data])).rows[0]?.ok === true);
  if (!allowed) return { error: "Only this project's manager or an owner/admin can add its quotation." };

  let read: ReadQuote | null = null;
  let problem: string | null = null;
  try {
    read = await readQuotationPdf(Buffer.from(await pdf.arrayBuffer()));
  } catch (e) {
    if (!(e instanceof QuoteReadError)) console.error(e);
    problem = e instanceof QuoteReadError ? e.message : "The quotation could not be read automatically.";
  }

  try {
    await withUser(me.id, async (db) => {
      // Only one draft at a time: a new upload replaces an unconfirmed one.
      const old = (await db.query("select id from project_quotations where project_id = $1 and status = 'draft'", [pid.data])).rows;
      for (const o of old) {
        await db.query("delete from stored_files where entity_type = 'quotation' and entity_id = $1", [o.id]);
        await db.query("delete from project_quotations where id = $1", [o.id]);
      }
      const items: QuoteItem[] = (read?.items ?? [])
        .filter((it) => it.description?.trim())
        .slice(0, 500)
        .map((it) => ({
          section: clip(it.section, 120),
          description: clip(it.description, 500)!,
          unit: clip(it.unit, 30),
          quantity: it.quantity != null && Number.isFinite(it.quantity) ? Math.round(it.quantity * 1000) / 1000 : null,
          rate_paise: toPaise(it.rate),
          amount_paise: toPaise(it.amount) ?? 0,
        }));
      const itemsTotal = items.reduce((s, it) => s + it.amount_paise, 0);
      const grand = toPaise(read?.grand_total) ?? 0;
      const notes = [problem, read?.notes?.trim(), read && !read.grand_total ? "No grand total was printed on the quotation. Please enter it." : null]
        .filter(Boolean).join(" ") || null;
      const q = (await db.query(
        `insert into project_quotations (project_id, status, title, quote_number, quote_date, client_name, subtotal_paise, discount_paise,
                                         tax_paise, tax_label, grand_total_paise, read_notes, read_by, created_by, file_name)
         values ($1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, auth.uid(), $13) returning id`,
        [pid.data, clip(read?.title, 200), clip(read?.quote_number, 60), isoDate(read?.quote_date), clip(read?.client_name, 120),
         toPaise(read?.subtotal) ?? (items.length ? itemsTotal : null), toPaise(read?.discount), toPaise(read?.tax_amount), clip(read?.tax_label, 60),
         grand, notes, read ? `ai:${QUOTE_MODEL}` : "manual", pdf.name.slice(0, 150)],
      )).rows[0];
      const file = await saveFile(db, pdf, { projectId: pid.data, entityType: "quotation", entityId: q.id, userId: me.id });
      await db.query("update project_quotations set file_id = $2 where id = $1", [q.id, file.id]);
      await replaceItems(db, q.id, pid.data, items);
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  redirect(`/m/projects/${pid.data}/quotation#review`);
}

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

/** Save the checked lines and totals; optionally confirm in the same step. */
export async function saveQuotationAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const head = z.object({
    id, project_id: id, title: optText(200), quote_number: optText(60), client_name: optText(120), tax_label: optText(60),
    quote_date: z.string().optional().transform((v) => isoDate(v)),
    intent: z.enum(["save", "confirm"]).optional().default("save"),
  }).safeParse(Object.fromEntries(form));
  if (!head.success) return { error: "Some details are not valid." };

  const money = (k: string): number | null | "bad" => {
    const v = String(form.get(k) ?? "").trim();
    if (!v) return null;
    const p = rupeesToPaise(v);
    return Number.isFinite(p) && p >= 0 ? p : "bad";
  };
  const sections = form.getAll("section").map(String);
  const descs = form.getAll("description").map(String);
  const units = form.getAll("unit").map(String);
  const qtys = form.getAll("quantity").map(String);
  const rates = form.getAll("rate").map(String);
  const amounts = form.getAll("amount").map(String);
  const items: QuoteItem[] = [];
  for (let i = 0; i < descs.length; i++) {
    const d = descs[i].trim();
    const a = amounts[i]?.trim() ?? "";
    if (!d && !a) continue; // empty row
    if (!d) return { error: `Line ${i + 1}: enter the item name.` };
    const amt = rupeesToPaise(a || "0");
    if (!Number.isFinite(amt) || amt < 0) return { error: `Line ${i + 1} (“${d.slice(0, 40)}”): enter the amount in rupees, e.g. 45000.` };
    const qs = (qtys[i] ?? "").replace(/,/g, "").trim();
    const qn = qs ? Number(qs) : null;
    if (qn != null && !Number.isFinite(qn)) return { error: `Line ${i + 1}: quantity must be a number.` };
    const rs = (rates[i] ?? "").trim();
    const rp = rs ? rupeesToPaise(rs) : null;
    if (rp != null && (!Number.isFinite(rp) || rp < 0)) return { error: `Line ${i + 1}: rate must be an amount in rupees.` };
    items.push({ section: clip(sections[i], 120), description: d.slice(0, 500), unit: clip(units[i], 30), quantity: qn, rate_paise: rp, amount_paise: amt });
  }
  if (items.length > 500) return { error: "A quotation can have up to 500 lines." };
  const subtotal = money("subtotal"), discount = money("discount"), tax = money("tax"), grand = money("grand_total");
  if ([subtotal, discount, tax, grand].includes("bad")) return { error: "Totals must be amounts in rupees, e.g. 1250000." };
  if (head.data.intent === "confirm") {
    if (!grand) return { error: "Enter the grand total before confirming." };
    if (!items.length) return { error: "Add at least one line before confirming." };
  }

  try {
    await withUser(me.id, async (db) => {
      const r = await db.query(
        `update project_quotations set title = $3, quote_number = $4, quote_date = $5, client_name = $6, subtotal_paise = $7,
                discount_paise = $8, tax_paise = $9, tax_label = $10, grand_total_paise = $11
          where id = $1 and project_id = $2 and status = 'draft'`,
        [head.data.id, head.data.project_id, head.data.title, head.data.quote_number, head.data.quote_date, head.data.client_name,
         subtotal, discount, tax, head.data.tax_label, grand ?? 0]);
      if (!r.rowCount) throw Object.assign(new Error("This quotation was already confirmed or removed. Refresh the page."), { code: "P0001" });
      await replaceItems(db, head.data.id, head.data.project_id, items);
      if (head.data.intent === "confirm") await db.query("select quotation_confirm($1)", [head.data.id]);
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  if (head.data.intent === "confirm") redirect(`/m/projects/${head.data.project_id}/quotation?confirmed=1`);
  return { ok: "Changes saved. Confirm when everything looks right." };
}

/** Throw away an unconfirmed quotation and its PDF. */
export async function discardQuotationAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const q = id.safeParse(form.get("id"));
  if (!q.success) return { error: "Quotation not found." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("delete from project_quotations where id = $1 and status = 'draft'", [q.data]);
      if (!r.rowCount) throw Object.assign(new Error("Only an unconfirmed quotation can be discarded."), { code: "P0001" });
      await db.query("delete from stored_files where entity_type = 'quotation' and entity_id = $1", [q.data]);
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  return { ok: "Discarded." };
}

/** Create the payment schedule as percentages of the confirmed quotation. */
export async function scheduleFromQuotationAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const pid = id.safeParse(form.get("project_id"));
  if (!pid.success) return { error: "Project not found." };
  const names = form.getAll("ms_name").map((s) => String(s).trim());
  const pcts = form.getAll("ms_pct").map((s) => String(s).trim());
  const rows = names
    .map((n, i) => ({ name: n.slice(0, 120), raw: (pcts[i] ?? "").replace("%", ""), pct: Number((pcts[i] ?? "").replace("%", "")) }))
    .filter((r) => r.name || r.raw);
  if (!rows.length) return { error: "Add at least one milestone." };
  for (const r of rows) {
    if (!r.name) return { error: "Name every milestone." };
    if (!Number.isFinite(r.pct) || r.pct <= 0 || r.pct > 100) return { error: `“${r.name}”: enter a percentage between 1 and 100.` };
  }
  const total = Math.round(rows.reduce((s, r) => s + r.pct, 0) * 100) / 100;
  if (total !== 100) return { error: `The percentages add up to ${total}%. They must add up to 100%.` };
  try {
    await withUser(me.id, async (db) => {
      const q = (await db.query("select grand_total_paise from project_quotations where project_id = $1 and status = 'confirmed'", [pid.data])).rows[0];
      if (!q) throw Object.assign(new Error("Confirm the quotation first."), { code: "P0001" });
      const existing = (await db.query("select count(*)::int as n from payment_milestones where project_id = $1 and deleted_at is null", [pid.data])).rows[0].n;
      if (existing > 0) throw Object.assign(new Error("This project already has a payment schedule. Change it on the Payments page."), { code: "P0001" });
      // Whole rupees per milestone; the last one takes the rounding difference.
      let left = q.grand_total_paise;
      for (let i = 0; i < rows.length; i++) {
        const amt = i === rows.length - 1 ? left : Math.round((q.grand_total_paise * rows[i].pct) / 100 / 100) * 100;
        left -= amt;
        if (amt <= 0) throw Object.assign(new Error(`“${rows[i].name}” would be ₹0. Adjust the percentages.`), { code: "P0001" });
        await db.query(
          `insert into payment_milestones (project_id, name, description, amount_paise, sort_order, created_by)
           values ($1, $2, $3, $4, $5, auth.uid())`,
          [pid.data, rows[i].name, `${rows[i].pct}% of quotation`, amt, i + 1]);
      }
    });
  } catch (e) {
    return { error: friendlyDbError(e) };
  }
  refresh();
  redirect(`/m/projects/${pid.data}/payments`);
}
