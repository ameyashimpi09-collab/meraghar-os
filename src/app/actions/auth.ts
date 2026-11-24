"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { endSession, getCurrentUser, hashPassword, startSession, verifyLogin } from "@/lib/auth";
import { homeFor } from "@/lib/roles";
import { withService, withUser } from "@/lib/db";
import bcrypt from "bcryptjs";

// Simple brute-force protection: 8 failed attempts per email+IP per 15 minutes.
const attempts = new Map<string, { n: number; until: number }>();

export type FormState = { error?: string; ok?: string } | undefined;

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: z.string().trim().email("Enter a valid email"), password: z.string().min(1, "Enter your password") })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? "local";
  const key = `${parsed.data.email.toLowerCase()}|${ip}`;
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) return { error: "Too many attempts. Please wait 15 minutes and try again." };

  const user = await verifyLogin(parsed.data.email, parsed.data.password);
  if (!user) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    return { error: "Email or password is incorrect." };
  }
  attempts.delete(key);
  await startSession(user.id);
  const me = await getCurrentUser();
  redirect(me ? homeFor(me.role) : "/login");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== String(form.get("confirm") ?? "")) return { error: "New passwords do not match." };
  const ok = await withService(me.id, async (db) => {
    const r = await db.query("select app_auth_get_hash($1) as h", [me.id]);
    if (!r.rows[0]?.h || !(await bcrypt.compare(current, r.rows[0].h))) return false;
    await db.query("select app_auth_set_password($1, $2)", [me.id, await hashPassword(next)]);
    return true;
  });
  return ok ? { ok: "Password updated." } : { error: "Current password is incorrect." };
}

export async function updateMyContact(_: FormState, form: FormData): Promise<FormState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const phone = String(form.get("phone") ?? "").trim().slice(0, 30) || null;
  const pref = String(form.get("preferred_contact_method") ?? "phone");
  if (!["phone", "whatsapp", "email", "in_app"].includes(pref)) return { error: "Invalid contact preference." };
  await withUser(me.id, (db) =>
    db.query("update profiles set phone = $1, preferred_contact_method = $2 where id = auth.uid()", [phone, pref]),
  );
  return { ok: "Contact details saved." };
}
