import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { ALLOWED_MIME } from "@/lib/files";

export const dynamic = "force-dynamic";

/**
 * Opens a stored file. The query runs as the signed-in person, so the
 * database only returns the file if they may see the record it belongs to
 * (e.g. clients never get draft designs or unpublished receipts).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser().catch(() => null);
  if (!user) return new Response("Please sign in", { status: 401 });

  const file = await withUser(user.id, async (db) =>
    (await db.query("select file_name, mime_type, data from stored_files where id = $1", [id])).rows[0] as
      | { file_name: string; mime_type: string; data: Buffer }
      | undefined,
  );
  if (!file) return new Response("Not found", { status: 404 });

  const safeType = ALLOWED_MIME[file.mime_type] ? file.mime_type : "application/octet-stream";
  const download = new URL(req.url).searchParams.has("download") || safeType === "application/octet-stream";
  const asciiName = file.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": safeType,
      "content-length": String(file.data.length),
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "cache-control": "private, max-age=300",
      ...(safeType.startsWith("image/") ? { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } : {}),
      "x-content-type-options": "nosniff",
    },
  });
}
