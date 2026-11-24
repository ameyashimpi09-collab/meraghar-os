import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { withService, withUser } from "./db";
import type { AppRole } from "./roles";
import { homeFor, isManagement, isStaff } from "./roles";

const COOKIE = "mg_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters). Open /status to check your setup.");
  return new TextEncoder().encode(s);
}

export type CurrentUser = {
  id: string;
  organisationId: string;
  organisationName: string;
  role: AppRole;
  fullName: string;
  email: string;
  phone: string | null;
  designation: string | null;
};

/**
 * Checks email + password. Same password format (bcrypt) as Supabase Auth,
 * so accounts carry over when we move to the hosted database.
 */
export async function verifyLogin(email: string, password: string): Promise<{ id: string } | null> {
  const row = await withService(null, async (db) => {
    const r = await db.query(
      `select u.id, u.encrypted_password, p.is_active, p.deleted_at
         from auth.users u join public.profiles p on p.id = u.id
        where lower(u.email) = lower($1)`,
      [email.trim()],
    );
    return r.rows[0];
  });
  // Always run a bcrypt compare so response time doesn't reveal whether the email exists
  const hash = row?.encrypted_password ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  if (!row || !ok || !row.is_active || row.deleted_at) return null;
  await withService(row.id, (db) => db.query("update auth.users set last_sign_in_at = now() where id = $1", [row.id]));
  return { id: row.id };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function startSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

async function sessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** The signed-in person, re-checked against the database on every request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const uid = await sessionUserId();
  if (!uid) return null;
  return withUser(uid, async (db) => {
    const r = await db.query(
      `select p.id, p.organisation_id, o.name as org_name, p.role, p.full_name, p.email, p.phone, p.designation
         from profiles p join organisations o on o.id = p.organisation_id
        where p.id = auth.uid() and p.is_active and p.deleted_at is null`,
    );
    const p = r.rows[0];
    if (!p) return null;
    return {
      id: p.id,
      organisationId: p.organisation_id,
      organisationName: p.org_name,
      role: p.role,
      fullName: p.full_name,
      email: p.email,
      phone: p.phone,
      designation: p.designation,
    };
  });
});

/** Use at the top of every protected page/action. */
export async function requireUser(area?: "management" | "employee" | "client"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (area === "management" && !isManagement(user.role)) redirect(homeFor(user.role));
  if (area === "employee" && (!isStaff(user.role) || isManagement(user.role))) redirect(homeFor(user.role));
  if (area === "client" && user.role !== "client") redirect(homeFor(user.role));
  return user;
}
