# Meraghar OS — Release 3 (Execution control)

Interior project operating system for Meraki Interior E-Solutions LLP.

## What's in Release 1
- Login with roles: Owner, Admin, Project Manager, Designer, Site Supervisor, Execution, Client
- Management portal: business overview, priority action centre, project health, projects, project creation, team assignment, team & client accounts
- Employee portal: my dashboard, my tasks (status updates save), my projects
- Client portal: premium overview answering "what's happening / progress / what we need from you / what's next", project details and timeline, account
- Full PostgreSQL schema for all six releases (`supabase/migrations`), with Row Level Security on every table, business-rule triggers (immutable approvals, non-deletable payments, etc.) and an audit trail

## What's in Release 2
- **Design & material approvals**: per project / area / category / item, with design images and PDFs, brand, type, specs, colour, finish, dimensions, quantity, commercial impact, deadline, manager's notes. Client can Approve (explicit tick), Request changes or Ask a question. Every sent revision is locked in the database; an approved revision can never change; revising creates a new revision. Full history with who/when.
- **Payments**: custom schedule per project, partial and full payments, receipts (optionally shared with the client), void with reason (never delete), due-date changes with a recorded reason, management-only "On hold", paused reminders, internal collection notes, collection history. Balances and statuses are always calculated from recorded payments.
- **Reminders**: daily at 8:00 AM IST via Supabase Cron (`run_reminders()`), payments at -7/-3/0/+1 days then every 3 days (limit configurable), approvals at -2/0 days then the same overdue pattern. Each reminder is sent once (dedupe key).
- **In-app notifications** for all three portals. Files are stored privately and served only through `/files/<id>` after a permission check.
- Database changes: `supabase/migrations/0004_release2.sql` (same content as `supabase/release2.sql`, safe to run repeatedly).
- Tests: `npm run test:security` (43 database permission/workflow tests), `node scripts/e2e-release2.mjs` (browser walkthrough + screenshots).

## What's in Release 3
- **Project stages**: start from the default stages (editable under Settings) or add them one by one. Each stage has dates, progress, status, team, milestone flag and client-visible wording. Stages wait for each other (no loops, same project only).
- **Delay tracking**: a delayed stage or blocked task must record its cause (company-controlled, client approval, client purchase, vendor, site/builder). The app projects how a late stage pushes later stages and the handover, and can move the affected stages in one step. Every date change or reassignment needs a reason and is kept in the schedule history.
- **Views**: stage list, timeline (Gantt, planned vs expected), calendar and milestones per project; a cross-project Execution Schedule page shows where delays start and what is causing them.
- **Tasks**: create, assign (project team only), prioritise, set reviewers, depend on other tasks, client approvals or client purchases (released automatically when they are done). Completion with notes and photo evidence, manager review (accept / send back), comments, files, cancel with reason. Workload by person.
- **Blockers**: anyone on the project can flag one; managers are notified; resolving it puts the task back in progress.
- **Reminders and notifications**: task due tomorrow / today / overdue (managers told on day 1 overdue), stage overdue, task assigned / rescheduled / completed / ready. The client gets one "timeline updated" note per change (never internal reasons) and a note when a milestone completes.
- Database changes: `supabase/migrations/0005_release3.sql` (applied automatically at app start).
- Tests: `npm run test:security` (61 tests), `node scripts/e2e-release3.mjs` (browser walkthrough + screenshots).

### Database updates are automatic
The app updates its own database when a new version starts (`src/instrumentation.ts` → `src/lib/migrate.ts`). Every file in `supabase/migrations` is bundled at build time (`scripts/gen-migrations.mjs`, runs as `prebuild`), applied once inside a transaction under an advisory lock, and recorded in `app_migrations`. Databases set up by hand are recognised and not re-run. `/status` shows the result and re-checks the daily reminder job. Nobody needs to paste SQL into Supabase any more. Set `SKIP_DB_MIGRATIONS=1` to turn this off (e.g. locally, where `db-reset.sh` applies migrations).

## Tech
Next.js 15 (App Router) · PostgreSQL 16 (Supabase-compatible) · Tailwind CSS 4

All data access runs as the signed-in user inside the database (`set role authenticated` + JWT claims), so RLS enforces permissions exactly as Supabase does.

## Run locally
```bash
npm install
bash scripts/db-reset.sh      # creates DB, applies migrations, loads demo data
npm run build && npm start    # http://localhost:3000
npm run test:security         # 61 permission/workflow tests (run on fresh demo data)
node scripts/e2e.mjs          # browser end-to-end checks + screenshots
node scripts/e2e-release3.mjs # Release 3 walkthrough (run on fresh demo data)
```
Demo logins (password `Demo@1234`): rahul@meraghar.demo (owner), aditya@ / neha@meraghar.demo (PMs), pooja@ (designer), sanjay@ (supervisor), ganesh@ (execution), amit@client.demo / kavita@client.demo / rohan@client.demo (clients).

## Moving to Supabase (later)
Apply `supabase/migrations/*.sql` (not `supabase/local/`), set `DATABASE_URL` to the Supabase connection string and a strong `SESSION_SECRET`. Passwords are bcrypt, the same format as Supabase Auth.

## Supabase setup (production)
1. Supabase → SQL Editor → paste and run `supabase/setup.sql` (all tables, security rules, audit trail).
2. Edit the 4 "CHANGE ME" values in `supabase/first-owner.sql`, paste and run it once (organisation, default lists, owner login).
3. Hosting env vars: `DATABASE_URL` (Supabase pooler connection string), `SESSION_SECRET` (random, 32+ chars). Optional `DATABASE_SSL_CA` to verify the certificate.

`supabase/setup.sql` is generated from `supabase/migrations/*.sql`; regenerate it when migrations change.
