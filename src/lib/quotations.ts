import "server-only";
import type { Db } from "./db";

export type QuoteItem = {
  id?: string; section: string | null; description: string; unit: string | null;
  quantity: number | null; rate_paise: number | null; amount_paise: number;
};

/** All quotations of a project (management only; RLS returns nothing to others). */
export async function projectQuotations(db: Db, projectId: string) {
  const quotes = (await db.query(
    `select q.*, cb.full_name as created_by_name, fb.full_name as confirmed_by_name,
            (select coalesce(sum(amount_paise), 0) from project_quotation_items i where i.quotation_id = q.id) as items_total_paise,
            (select count(*) from project_quotation_items i where i.quotation_id = q.id) as item_count
       from project_quotations q
       left join profiles cb on cb.id = q.created_by
       left join profiles fb on fb.id = q.confirmed_by
      where q.project_id = $1
      order by (q.status = 'draft') desc, (q.status = 'confirmed') desc, q.created_at desc`, [projectId])).rows;
  const ids = quotes.filter((q) => q.status !== "replaced").map((q) => q.id);
  const items = ids.length
    ? (await db.query(
        `select id, quotation_id, section, description, unit, quantity, rate_paise, amount_paise
           from project_quotation_items where quotation_id = any($1) order by sort_order, created_at`, [ids])).rows
    : [];
  return {
    draft: quotes.find((q) => q.status === "draft") ?? null,
    current: quotes.find((q) => q.status === "confirmed") ?? null,
    history: quotes.filter((q) => q.status === "replaced"),
    itemsOf: (qid: string) => items.filter((i) => i.quotation_id === qid) as (QuoteItem & { id: string })[],
  };
}

/** The confirmed quotation's grand total, or null. */
export async function quotationValue(db: Db, projectId: string): Promise<{ id: string; grand_total_paise: number; quote_number: string | null; quote_date: string | null } | null> {
  return (await db.query(
    "select id, grand_total_paise, quote_number, quote_date from project_quotations where project_id = $1 and status = 'confirmed'",
    [projectId])).rows[0] ?? null;
}

export async function replaceItems(db: Db, quotationId: string, projectId: string, items: QuoteItem[]) {
  await db.query("delete from project_quotation_items where quotation_id = $1", [quotationId]);
  if (!items.length) return;
  const cols = 8;
  const values: unknown[] = [];
  const rows = items.map((it, i) => {
    values.push(quotationId, projectId, i + 1, it.section, it.description, it.unit, it.quantity, it.rate_paise);
    const b = i * cols;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8}, $${items.length * cols + i + 1})`;
  });
  items.forEach((it) => values.push(it.amount_paise));
  await db.query(
    `insert into project_quotation_items (quotation_id, project_id, sort_order, section, description, unit, quantity, rate_paise, amount_paise)
     values ${rows.join(",")}`, values);
}

/** Suggested payment schedule for an interior project (percent of the quotation). */
export const DEFAULT_SCHEDULE = [
  { name: "Booking advance", pct: 10 },
  { name: "Design sign-off / work start", pct: 40 },
  { name: "Carpentry midway", pct: 30 },
  { name: "Before installation", pct: 15 },
  { name: "Handover", pct: 5 },
];
