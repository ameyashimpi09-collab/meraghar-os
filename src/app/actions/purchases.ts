"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import { readUploads, saveFile } from "@/lib/files";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);
const size = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!(n > 0) || n > 100000) { ctx.addIssue({ code: "custom", message: "Dimensions must be positive numbers" }); return z.NEVER; }
  return n;
});
const optId = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const fail = (e: unknown): FormResult => ({ error: friendlyDbError(e) });
const refresh = () => revalidatePath("/", "layout");
const denied = () => Object.assign(new Error("You can't change this item."), { code: "42501" });

const STATUSES = ["not_yet_required", "purchase_required", "client_informed", "purchased", "delivery_scheduled", "delivered", "installed", "delayed", "cancelled"] as const;

const Item = z.object({
  item_name: z.string().trim().min(2, "Name the item, e.g. Refrigerator").max(120),
  category: text(60), area: text(80), description: text(1500), brand: text(80), model: text(120),
  width: size, height: size, depth: size, unit: z.enum(["mm", "cm", "m", "in"]).default("mm"),
  technical_specs: text(1500), quantity: z.coerce.number().int().min(1).max(999).default(1), suggested_options: text(1500),
  responsibility: z.enum(["client", "company", "shared"]).default("client"),
  required_purchase_date: date, required_delivery_date: date, installation_date: date,
  depends_on_stage_id: optId, status: z.enum(STATUSES).default("not_yet_required"), manager_remarks: text(1000),
});

/** Project manager: add or edit a purchase item. */
export async function savePurchaseAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = Item.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const itemId = String(form.get("id") ?? "");
  const projectId = String(form.get("project_id") ?? "");
  const up = readUploads(form, "image");
  if (up.error) return { error: up.error };
  if (up.files[0] && !up.files[0].type.startsWith("image/")) return { error: "The reference image must be a photo (JPG, PNG or WebP)." };
  const d = p.data;
  const vals = [d.item_name, d.category, d.area, d.description, d.brand, d.model, d.width, d.height, d.depth, d.unit, d.technical_specs,
    d.quantity, d.suggested_options, d.responsibility, d.required_purchase_date, d.required_delivery_date, d.installation_date,
    d.depends_on_stage_id, d.status, d.manager_remarks];
  try {
    await withUser(me.id, async (db) => {
      let row: { id: string; project_id: string };
      if (itemId) {
        if (!id.safeParse(itemId).success) throw denied();
        const r = await db.query(
          `update purchase_requirements set item_name=$2, category=$3, area=$4, description=$5, brand=$6, model=$7, width=$8, height=$9, depth=$10,
                  unit=$11, technical_specs=$12, quantity=$13, suggested_options=$14, responsibility=$15, required_purchase_date=$16,
                  required_delivery_date=$17, installation_date=$18, depends_on_stage_id=$19, status=$20, manager_remarks=$21
            where id = $1 and deleted_at is null and can_manage_project(project_id) returning id, project_id`, [itemId, ...vals]);
        if (!r.rowCount) throw denied();
        row = r.rows[0];
      } else {
        if (!id.safeParse(projectId).success) throw denied();
        row = (await db.query(
          `insert into purchase_requirements (project_id, item_name, category, area, description, brand, model, width, height, depth, unit,
              technical_specs, quantity, suggested_options, responsibility, required_purchase_date, required_delivery_date, installation_date,
              depends_on_stage_id, status, manager_remarks, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, auth.uid()) returning id, project_id`,
          [projectId, ...vals])).rows[0];
      }
      if (up.files[0]) {
        const f = await saveFile(db, up.files[0], { projectId: row.project_id, entityType: "purchase", entityId: row.id, userId: me.id });
        await db.query("update purchase_requirements set reference_image_path = $2 where id = $1", [row.id, f.id]);
      }
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: itemId ? "Item saved." : d.status === "purchase_required" || d.status === "client_informed" ? "Item added. The client has been asked to purchase it." : "Item added." };
}

/** Team / project manager: quick status change with a remark. */
export async function purchaseStatusAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  if (me.role === "client") return { error: "Not allowed." };
  const p = z.object({ id, status: z.enum(STATUSES), manager_remarks: text(1000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a status." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update purchase_requirements set status = $2, manager_remarks = coalesce($3, manager_remarks) where id = $1 and deleted_at is null",
        [p.data.id, p.data.status, p.data.manager_remarks]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.status === "client_informed" || p.data.status === "purchase_required" ? "Updated. The client has been notified." : "Status updated." };
}

export async function removePurchaseAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const itemId = String(form.get("id") ?? "");
  if (!id.safeParse(itemId).success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query("update purchase_requirements set deleted_at = now() where id = $1 and deleted_at is null and can_manage_project(project_id)", [itemId]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Item removed." };
}

/** Client: update their purchase status, delivery date and remarks. */
export async function clientPurchaseAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("client");
  const p = z.object({
    id, status: z.enum(["purchased", "delivery_scheduled", "delivered"]).optional().or(z.literal("")).transform((v) => v || null),
    client_delivery_on: date, client_remarks: text(1000),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Please check the details." };
  if (p.data.status === "delivery_scheduled" && !p.data.client_delivery_on) return { error: "Tell us the delivery date." };
  try {
    await withUser(me.id, async (db) => {
      const r = await db.query(
        `update purchase_requirements set status = coalesce($2::purchase_status, status), client_delivery_on = coalesce($3::date, client_delivery_on),
                client_remarks = coalesce($4, client_remarks) where id = $1 and deleted_at is null`,
        [p.data.id, p.data.status, p.data.client_delivery_on, p.data.client_remarks]);
      if (!r.rowCount) throw denied();
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: "Thank you. Your project manager has been told." };
}
