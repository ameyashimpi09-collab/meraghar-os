import { parseDatabaseUrl, withService } from "@/lib/db";
import { ensureMigrations, ensureReminderJob } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/**
 * Setup self-check at /status. Shows whether each setting works, in plain
 * words, WITHOUT revealing any secret values. Safe to open in a browser.
 */
export async function GET() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  let urlOk = false;
  try {
    const u = parseDatabaseUrl(process.env.DATABASE_URL);
    urlOk = true;
    const pooler = u.hostname.includes("pooler.supabase.com");
    checks.push({
      name: "Database address (DATABASE_URL)",
      ok: true,
      detail: pooler ? "Looks right (Supabase pooler)." : "Readable, but it isn't the Supabase pooler address. Use Connect → Transaction pooler in Supabase.",
    });
  } catch (e) {
    checks.push({ name: "Database address (DATABASE_URL)", ok: false, detail: (e as Error).message });
  }

  const secretLen = (process.env.SESSION_SECRET ?? "").length;
  checks.push({
    name: "Login secret (SESSION_SECRET)",
    ok: secretLen >= 32,
    detail: secretLen === 0 ? "Missing. Add it in Vercel → Settings → Environment Variables." : secretLen < 32 ? `Too short (${secretLen} characters). It needs at least 32.` : "OK.",
  });

  if (urlOk) {
    const mig = await ensureMigrations();
    if (!mig.error) await ensureReminderJob();
    checks.push({
      name: "Automatic database updates",
      ok: !mig.error && mig.pending.length === 0,
      detail: mig.error
        ? `Could not update the database: ${mig.error.slice(0, 240)}`
        : mig.applied.length ? `Just applied: ${mig.applied.join(", ")}.` : "Database is up to date.",
    });
    try {
      const r = await withService(null, async (db) => {
        const tables = (await db.query("select to_regclass('public.organisations') is not null as ok")).rows[0].ok;
        const owners = tables ? (await db.query("select count(*)::int as n from profiles where role = 'owner' and is_active")).rows[0].n : 0;
        const loginFns = (await db.query("select to_regprocedure('public.app_auth_find_login(text)') is not null as ok")).rows[0].ok;
        if (loginFns) await db.query("select * from app_auth_find_login('status-check@invalid')"); // same path as sign-in
        const r2 = (await db.query(
          "select to_regclass('public.stored_files') is not null and to_regprocedure('public.approval_publish(uuid)') is not null and to_regprocedure('public.app_reminder_status()') is not null as ok")).rows[0].ok as boolean;
        const reminders = r2 ? ((await db.query("select app_reminder_status() as s")).rows[0].s as {
          cron_installed: boolean; job_scheduled: boolean; last_run: string | null; last_count: number | null }) : null;
        await db.query("set local role authenticated");
        return { tables, owners, loginFns, r2, reminders };
      });
      checks.push({ name: "Connect to database", ok: true, detail: "Connected." });
      checks.push({ name: "Step 1 (setup.sql)", ok: r.tables, detail: r.tables ? "Tables found." : "Tables not found. Run setup.sql in Supabase SQL Editor." });
      checks.push({ name: "Step 2 (owner login)", ok: r.owners > 0, detail: r.owners > 0 ? "Owner account found." : "No owner yet. Run first-owner.sql." });
      checks.push({ name: "Sign-in functions (step 3)", ok: r.loginFns, detail: r.loginFns ? "Sign-in works." : "Missing. Run supabase/migrations/0003_auth_functions.sql in Supabase SQL Editor." });
      checks.push({
        name: "Release 2 update (release2.sql)",
        ok: r.r2,
        detail: r.r2 ? "Approvals, payments and reminders are set up." : "Not applied yet. It is applied automatically; reload this page in a minute.",
      });
      if (r.r2 && r.reminders) {
        const rm = r.reminders;
        const last = rm.last_run ? new Date(rm.last_run).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : null;
        checks.push({
          name: "Daily reminders (8:00 AM)",
          ok: rm.cron_installed && rm.job_scheduled,
          detail: !rm.cron_installed
            ? "Supabase Cron is switched off. In Supabase open Integrations → Cron → Enable, then reload this page."
            : !rm.job_scheduled
              ? "Cron is on but the reminder job is missing. Reload this page; if it stays red, contact support."
              : `Scheduled every day at 8:00 AM India time.${last ? ` Last run ${last}, ${rm.last_count ?? 0} reminder(s) sent.` : " It has not run yet."}`,
        });
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      let hint = "";
      if (err.code === "28P01" || /password authentication/i.test(err.message ?? "")) hint = " The database password inside DATABASE_URL is wrong. Use the one from Supabase → Project Settings → Database (reset it if unsure).";
      else if (/ENOTFOUND|EAI_AGAIN/.test(err.message ?? "")) hint = " The server name in DATABASE_URL can't be found. Copy it again from Supabase → Connect → Transaction pooler.";
      else if (/Tenant or user not found/i.test(err.message ?? "")) hint = " The user name in DATABASE_URL is wrong. It should look like postgres.xxxxxxxx (copy it again from the Transaction pooler box).";
      checks.push({ name: "Connect to database", ok: false, detail: `${(err.message ?? "Unknown error").slice(0, 200)}.${hint}` });
    }
  }

  const keyLen = (process.env.ANTHROPIC_API_KEY ?? "").trim().length;
  const optional = [{
    name: "Quotation PDF reading (ANTHROPIC_API_KEY)",
    ok: keyLen > 0,
    detail: keyLen > 0 ? "Switched on." : "Optional. Not switched on yet: add your Claude API key as ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables. Until then quotations can be typed in by hand.",
  }];
  const allOk = checks.every((c) => c.ok);
  const rows = [...checks.map((c) => ({ ...c, mark: c.ok ? "✅" : "❌" })), ...optional.map((c) => ({ ...c, mark: c.ok ? "✅" : "⚠️" }))]
    .map((c) => `<li><b>${c.mark} ${c.name}</b><br><span>${c.detail.replace(/</g, "&lt;")}</span></li>`)
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meraghar OS · Setup check</title>
<body style="font-family:system-ui;background:#f6f2eb;color:#2b2925;max-width:640px;margin:40px auto;padding:0 16px">
<h1 style="font-weight:500">Setup check</h1><p>${allOk ? "Everything looks good. <a href='/login'>Go to sign in</a>." : "Something needs fixing. See the ❌ lines below."}</p>
<ul style="list-style:none;padding:0;line-height:1.5">${rows.replace(/<li>/g, "<li style='margin:14px 0'>")}</ul></body>`;
  return new Response(html, { status: allOk ? 200 : 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
