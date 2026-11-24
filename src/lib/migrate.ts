import "server-only";
import { Client } from "pg";
import { parseDatabaseUrl } from "./db";
import { MIGRATIONS } from "./migrations.generated";

/**
 * Keeps the database up to date by itself, so nobody has to paste SQL into
 * Supabase. On start-up the app applies any database update it hasn't
 * applied yet, one at a time, each inside a transaction (all or nothing),
 * and records it in app_migrations. A lock stops two servers doing it at once.
 *
 * Databases set up by hand before this existed are recognised: updates that
 * are already present are recorded as done instead of being run again.
 */
export type MigrationResult = { applied: string[]; pending: string[]; error?: string };

let running: Promise<MigrationResult> | null = null;

export function ensureMigrations(): Promise<MigrationResult> {
  if (!running) {
    running = runMigrations().then((r) => {
      if (r.error) running = null; // try again on the next request
      return r;
    });
  }
  return running;
}

function connection() {
  const url = parseDatabaseUrl(process.env.DATABASE_URL);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  url.searchParams.delete("sslmode");
  return new Client({ connectionString: url.toString(), ssl: local ? undefined : { rejectUnauthorized: false } });
}

// What each early update created, to recognise hand-applied ones.
const ALREADY_PRESENT: Record<string, string> = {
  "0001_schema": "select to_regclass('public.organisations') is not null as ok",
  "0002_security": "select to_regprocedure('public.create_project(jsonb)') is not null as ok",
  "0003_auth_functions": "select to_regprocedure('public.app_auth_find_login(text)') is not null as ok",
};

const ENSURE_REMINDER_JOB = `
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then null;
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.schedule('meraghar-daily-reminders', '30 2 * * *', 'select public.run_reminders()')
               where not exists (select 1 from cron.job where jobname = 'meraghar-daily-reminders')$q$;
  end if;
end $$`;

/** Re-checks the daily reminder job (used by /status, e.g. after Cron is switched on). */
export async function ensureReminderJob(): Promise<void> {
  const db = connection();
  try {
    await db.connect();
    if ((await db.query("select to_regprocedure('public.run_reminders(date)') is not null as ok")).rows[0].ok) await db.query(ENSURE_REMINDER_JOB);
  } catch (e) {
    console.error("[meraghar] reminder job:", (e as Error).message);
  } finally {
    await db.end().catch(() => {});
  }
}

async function runMigrations(): Promise<MigrationResult> {
  const applied: string[] = [];
  let pending: string[] = [];
  if (process.env.SKIP_DB_MIGRATIONS === "1") return { applied, pending };
  const db = connection();
  try {
    await db.connect();
    await db.query(`create table if not exists public.app_migrations (
      id text primary key, applied_at timestamptz not null default now())`);
    await db.query("alter table public.app_migrations enable row level security");
    await db.query("revoke all on public.app_migrations from public");
    for (const r of ["anon", "authenticated"]) {
      const exists = (await db.query("select 1 from pg_roles where rolname = $1", [r])).rowCount;
      if (exists) await db.query(`revoke all on public.app_migrations from ${r}`);
    }
    const done = new Set((await db.query("select id from public.app_migrations")).rows.map((r) => r.id as string));
    pending = MIGRATIONS.map((m) => m.id).filter((id) => !done.has(id));

    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await db.query("begin");
      try {
        // Only one server at a time; lock is released at commit/rollback
        await db.query("select pg_advisory_xact_lock(724501)");
        const again = (await db.query("select 1 from public.app_migrations where id = $1", [m.id])).rowCount;
        if (!again) {
          const check = ALREADY_PRESENT[m.id];
          const present = check ? (await db.query(check)).rows[0].ok : false;
          if (!present) await db.query(m.sql);
          await db.query("insert into public.app_migrations (id) values ($1) on conflict do nothing", [m.id]);
          applied.push(m.id + (present ? " (already present)" : ""));
        }
        await db.query("commit");
        pending = pending.filter((id) => id !== m.id);
      } catch (e) {
        await db.query("rollback").catch(() => {});
        throw new Error(`Database update ${m.id} failed: ${(e as Error).message}`);
      }
    }
    // Make sure the daily reminder job exists (also if Cron was switched on later)
    if (done.has("0004_release2") || applied.some((a) => a.startsWith("0004_release2"))) {
      await db.query(ENSURE_REMINDER_JOB).catch((e) => console.error("[meraghar] reminder job:", e.message));
    }
    if (applied.length) console.log("[meraghar] database updated:", applied.join(", "));
    return { applied, pending };
  } catch (e) {
    console.error("[meraghar]", e);
    return { applied, pending, error: (e as Error).message };
  } finally {
    await db.end().catch(() => {});
  }
}
