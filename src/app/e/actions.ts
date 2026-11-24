"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";

const ALLOWED = ["not_started", "in_progress", "waiting_client", "waiting_vendor", "blocked", "completed"] as const;

/** Employees update progress on their own tasks. The database refuses anything else. */
export async function updateTaskStatus(form: FormData) {
  const user = await requireUser("employee");
  const id = z.string().uuid().parse(form.get("task_id"));
  const status = z.enum(ALLOWED).parse(form.get("status"));
  await withUser(user.id, (db) =>
    db.query(
      `update tasks set status = $2::task_status,
              blocked_reason = case when $2::text = 'blocked' then coalesce(blocked_reason, 'Flagged by assignee') else blocked_reason end
        where id = $1 and assigned_to = auth.uid()`,
      [id, status],
    ),
  );
  revalidatePath("/e", "layout");
}
