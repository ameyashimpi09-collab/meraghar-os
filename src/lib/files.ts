import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "./db";

// Files (design images, PDFs, receipts) are stored privately in the
// database. They are only ever served through /files/<id>, which checks
// the signed-in person may see the record the file belongs to.

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // hosting limit is ~4.5 MB per upload
export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "application/pdf": "PDF",
};

export type StoredFile = { id: string; name: string; mime: string; size: number };

/** Reads and validates uploaded files from a form field. */
export function readUploads(form: FormData, field = "files"): { files: File[]; error?: string } {
  const files = form.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  let total = 0;
  for (const f of files) {
    if (!ALLOWED_MIME[f.type]) return { files: [], error: `"${f.name}" is not a supported file. Use JPG, PNG, WebP or PDF.` };
    if (f.size > MAX_FILE_BYTES) return { files: [], error: `"${f.name}" is larger than 4 MB. Please reduce its size and try again.` };
    total += f.size;
  }
  if (total > MAX_FILE_BYTES + 256 * 1024) return { files: [], error: "These files are too large to send together. Upload them a few at a time." };
  return { files };
}

export async function saveFile(
  db: Db,
  f: File,
  ctx: { projectId: string; entityType: "approval_revision" | "payment_transaction" | "task" | "quotation" | "site_update" | "snag" | "purchase" | "document"; entityId: string; userId: string },
): Promise<StoredFile> {
  const buf = Buffer.from(await f.arrayBuffer());
  const name = (f.name || "file").replace(/[\\/\r\n"]/g, "_").slice(0, 150);
  // The id is made here (not read back with RETURNING): some files only
  // become readable once the record that points to them has been saved.
  const id = randomUUID();
  await db.query(
    `insert into stored_files (id, project_id, entity_type, entity_id, file_name, mime_type, size_bytes, data, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, ctx.projectId, ctx.entityType, ctx.entityId, name, f.type, buf.length, buf, ctx.userId],
  );
  return { id, name, mime: f.type, size: buf.length };
}

export function fileUrl(id: string, download = false) {
  return `/files/${id}${download ? "?download=1" : ""}`;
}

export function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
