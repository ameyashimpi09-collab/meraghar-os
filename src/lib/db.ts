import "server-only";
import { Pool, PoolClient, types } from "pg";

// Calendar dates stay as plain "YYYY-MM-DD" strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);
// bigint (money in paise, counts) -> JS number. Safe up to ₹90 trillion.
types.setTypeParser(20, (v) => Number(v));
// numeric -> JS number
types.setTypeParser(1700, (v) => Number(v));

const globalForPg = globalThis as unknown as { __mgPool?: Pool };

/**
 * Hosted databases (Supabase) need an encrypted connection. If the
 * provider's CA certificate is supplied in DATABASE_SSL_CA it is verified;
 * otherwise the connection is still encrypted but the certificate isn't pinned.
 */
function connectionConfig() {
  const raw = process.env.DATABASE_URL ?? "";
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  url.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl: local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

export const pool: Pool =
  globalForPg.__mgPool ??
  (globalForPg.__mgPool = new Pool({
    ...connectionConfig(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
  }));

export type Db = PoolClient;

/**
 * Run database work AS the signed-in user.
 * The database's Row Level Security then decides what this person may see
 * or change — exactly how Supabase enforces it. Everything inside runs in
 * one transaction: it all succeeds or nothing is saved.
 */
export async function withUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Privileged server-only work (login checks, creating accounts).
 * Only call this AFTER the app has checked the caller is allowed.
 * `actorId` is recorded in the audit log as the person responsible.
 */
export async function withService<T>(actorId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (actorId) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: actorId, role: "service_role" }),
      ]);
    }
    await client.query("set local role service_role");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inside a withUser() transaction, briefly switch to privileged mode for a
 * step the user's role can't do directly (e.g. creating a login account),
 * then switch back. Only call after checking the user is allowed.
 */
export async function asService<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await db.query("set local role authenticated");
  }
}

/** Turns database errors into short messages a person can act on. */
export function friendlyDbError(err: unknown): string {
  const e = err as { code?: string; message?: string; constraint?: string };
  if (e?.code === "42501") return e.message?.replace(/^new row violates row-level security.*$/, "You don't have permission to do that.") || "You don't have permission to do that.";
  if (e?.code === "23505") {
    if (e.constraint?.includes("email")) return "An account with this email already exists.";
    return "This record already exists.";
  }
  if (e?.code === "23514") return "Some values are not valid. Please check dates and numbers.";
  if (e?.code === "22P02" || e?.code === "22007" || e?.code === "22008") return "Some values are in the wrong format.";
  if (e?.code === "P0001") return e.message ?? "Could not save.";
  console.error(err);
  return "Something went wrong while saving. Please try again.";
}
