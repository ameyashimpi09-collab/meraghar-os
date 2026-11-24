import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { homeFor } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Opening a notification marks it read and takes you to the record. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  let link: string | null = null;
  if (z.string().uuid().safeParse(id).success) {
    link = await withUser(user.id, async (db) =>
      (await db.query("update notifications set read_at = coalesce(read_at, now()) where id = $1 and recipient_id = auth.uid() returning link_path", [id])).rows[0]?.link_path ?? null);
  }
  // Only ever redirect inside this app
  const safe = link && /^\/[a-z0-9/_-]*$/i.test(link) ? link : homeFor(user.role);
  return NextResponse.redirect(new URL(safe, req.url));
}
