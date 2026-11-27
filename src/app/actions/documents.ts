"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import { readUploads, saveFile } from "@/lib/files";
import type { FormResult } from "@/components/ActionForm";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const fail = (e: unknown): FormResult => ({ error: friendlyDbError(e) });
const refresh = () => revalidatePath("/", "layout");
const TYPES = ["floor_plan", "site_measurement", "design_presentation", "render_3d", "quotation", "work_order", "electrical_layout", "plumbing_layout", "material_spec", "other"] as const;

/** Upload a document (or a new version of one). */
export async function uploadDocumentAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser();
  if (me.role === "client") return { error: "Not allowed." };
  const p = z.object({
    project_id: id, title: z.string().trim().min(2, "Give the document a title").max(150), description: text(1000),
    doc_type: z.enum(TYPES).default("other"), client_visible: z.string().optional(), supersedes_id: id.optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const up = readUploads(form, "file");
  if (up.error) return { error: up.error };
  if (!up.files[0]) return { error: "Choose the file to upload." };
  const f = up.files[0];
  try {
    await withUser(me.id, async (db) => {
      const prev = p.data.supersedes_id
        ? (await db.query("select id, version from project_documents where id = $1 and project_id = $2 and deleted_at is null", [p.data.supersedes_id, p.data.project_id])).rows[0]
        : null;
      if (p.data.supersedes_id && !prev) throw Object.assign(new Error("The earlier version was not found."), { code: "P0001" });
      const docId = (await db.query("select gen_random_uuid() as id")).rows[0].id;
      const saved = await saveFile(db, f, { projectId: p.data.project_id, entityType: "document", entityId: docId, userId: me.id });
      await db.query(
        `insert into project_documents (id, project_id, doc_type, title, description, storage_path, file_name, mime_type, size_bytes, version, client_visible, uploaded_by, supersedes_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, auth.uid(), $12)`,
        [docId, p.data.project_id, p.data.doc_type, p.data.title, p.data.description, saved.id, saved.name, saved.mime, saved.size,
          (prev?.version ?? 0) + 1, p.data.client_visible === "on", prev?.id ?? null]);
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.client_visible === "on" ? "Uploaded and shared with the client." : "Uploaded (team only)." };
}

export async function documentVisibilityAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("management");
  const p = z.object({ id, share: z.enum(["yes", "no", "remove"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await withUser(me.id, async (db) => {
      const r = p.data.share === "remove"
        ? await db.query("update project_documents set deleted_at = now() where id = $1 and deleted_at is null and can_manage_project(project_id)", [p.data.id])
        : await db.query("update project_documents set client_visible = $2 where id = $1 and deleted_at is null and can_manage_project(project_id)", [p.data.id, p.data.share === "yes"]);
      if (!r.rowCount) throw Object.assign(new Error("Only the project manager can do this."), { code: "42501" });
    });
  } catch (e) { return fail(e); }
  refresh();
  return { ok: p.data.share === "yes" ? "Shared with the client." : p.data.share === "no" ? "Hidden from the client." : "Removed." };
}
