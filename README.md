# Meraghar OS — Release 3 (Execution control) + Quotation reader

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

## What's in Release 4 (client experience)
- **Site updates**: the site team posts progress (area, work done, what's next, blockers) with photos. Large photos are reduced automatically. Updates go to the project manager for review, who can hide individual photos, send it back with a note, keep it internal, or share it with the client. Internal blockers and team-only photos never reach the client.
- **Client photo gallery**: clients see shared updates as a feed and all shared photos grouped by room, with a full-screen viewer.
- **Client purchase tracker**: managers list items the client must buy (size in mm/cm/inches with conversion, buy-by date, needed-at-site date, linked stage). Clients mark ordered/delivered, give a delivery date and remarks. Reminders go out 7/3/0 days before the buy date and when an item is late; a cross-project Procurement page shows what is at risk.
- **Snags (concerns)**: clients or the team raise a concern with photos. The manager assigns it, the team fixes it and uploads proof, the manager checks it, and the client confirms or reopens. Every step is kept in the history; team-only messages stay internal.
- **Documents**: upload drawings, agreements, invoices and handover documents per project, keep versions, and choose which ones the client can see.
- Database changes: `supabase/migrations/0007_release4.sql` (applied automatically at app start).
- Tests: `npm run test:security` (81 tests), `node scripts/e2e-release4.mjs` (browser walkthrough + screenshots).

## Quotation reader (PDF → project)
- On a project, management uploads the quotation PDF (**Project → Quotation**). Claude (`claude-opus-5-5`, via the Anthropic API with structured output) reads every line item (room/area, item, qty, unit, rate, amount), subtotal, discount, GST and grand total.
- Nothing is saved to the project until management checks it: the review screen flags lines where qty × rate ≠ amount and totals that don't add up, every field can be corrected, lines added or removed.
- **Confirm** makes it the project's quotation value (shown on the project and payments pages, compared with the payment schedule). A confirmed quotation is locked in the database; a revised PDF replaces it and the old one is kept as history.
- If the project has no payment schedule yet, it can be created from the quotation by percentages in one step.
- Management only (project's PM, owner, admin): clients and employees can't see quotations or their PDFs (row security).
- Needs the hosting env var `ANTHROPIC_API_KEY`. Without it the PDF can still be uploaded and the lines typed in by hand; `/status` shows whether reading is switched on.
- Database changes: `supabase/migrations/0006_quotations.sql` (applied automatically at app start).
- Tests: `npm run test:security` (68 tests), `node scripts/e2e-quotation.mjs` with the stand-in API `scripts/mock-claude.mjs` (see the file header).

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
