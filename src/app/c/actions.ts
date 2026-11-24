"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { friendlyDbError, withUser } from "@/lib/db";
import type { FormResult } from "@/components/ActionForm";

const Schema = z.object({
  approval_id: z.string().uuid(),
  revision_id: z.string().uuid(),
  action: z.enum(["approve", "request_changes", "raise_query"]),
  comment: z.string().trim().max(2000).optional().transform((v) => v || null),
  confirm: z.string().optional(),
});

/**
 * The client's decision. It is recorded permanently with who, when and from
 * which device. Approval needs an explicit tick; changes and queries need a comment.
 */
export async function respondToApprovalAction(_: FormResult, form: FormData): Promise<FormResult> {
  const me = await requireUser("client");
  const p = Schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Please try again." };
  const v = p.data;
  if (v.action === "approve" && v.confirm !== "yes") return { error: "Please tick the box to confirm your approval." };
  if (v.action !== "approve" && !v.comment) return { error: v.action === "raise_query" ? "Please write your question." : "Please describe the changes you would like." };
  const ua = ((await headers()).get("user-agent") ?? "").slice(0, 300);
  try {
    await withUser(me.id, (db) => db.query(
      `insert into approval_responses (approval_id, revision_id, project_id, action, comment, responded_by, user_agent)
       select a.id, $2, a.project_id, $3, $4, auth.uid(), $5 from approvals a where a.id = $1`,
      [v.approval_id, v.revision_id, v.action, v.comment, ua],
    ));
  } catch (e) {
    const msg = friendlyDbError(e);
    return { error: /latest published revision/.test(msg) ? "This design has been updated since you opened it. Please refresh the page to see the latest version." : msg };
  }
  revalidatePath("/", "layout");
  return {
    ok: v.action === "approve" ? "Thank you. Your approval has been recorded." : v.action === "raise_query" ? "Your question has been sent to your project manager." : "Thank you. Your project manager will share a revised design.",
  };
}
