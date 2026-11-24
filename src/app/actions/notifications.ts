"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";

export async function markAllReadAction() {
  const me = await requireUser();
  await withUser(me.id, (db) => db.query("update notifications set read_at = now() where recipient_id = auth.uid() and read_at is null"));
  revalidatePath("/", "layout");
  return { ok: "All marked as read." };
}
