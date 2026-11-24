# Meraghar OS — Release 1 (Operational foundation)

Interior project operating system for Meraki Interior E-Solutions LLP.

## What's in Release 1
- Login with roles: Owner, Admin, Project Manager, Designer, Site Supervisor, Execution, Client
- Management portal: business overview, priority action centre, project health, projects, project creation, team assignment, team & client accounts
- Employee portal: my dashboard, my tasks (status updates save), my projects
- Client portal: premium overview answering "what's happening / progress / what we need from you / what's next", project details and timeline, account
- Full PostgreSQL schema for all six releases (`supabase/migrations`), with Row Level Security on every table, business-rule triggers (immutable approvals, non-deletable payments, etc.) and an audit trail

## Tech
Next.js 15 (App Router) · PostgreSQL 16 (Supabase-compatible) · Tailwind CSS 4

All data access runs as the signed-in user inside the database (`set role authenticated` + JWT claims), so RLS enforces permissions exactly as Supabase does.

## Run locally
```bash
npm install
bash scripts/db-reset.sh      # creates DB, applies migrations, loads demo data
npm run build && npm start    # http://localhost:3000
npm run test:security         # 22 permission tests (run on fresh demo data)
node scripts/e2e.mjs          # browser end-to-end checks + screenshots
```
Demo logins (password `Demo@1234`): rahul@meraghar.demo (owner), aditya@ / neha@meraghar.demo (PMs), pooja@ (designer), sanjay@ (supervisor), ganesh@ (execution), amit@client.demo / kavita@client.demo / rohan@client.demo (clients).

## Moving to Supabase (later)
Apply `supabase/migrations/*.sql` (not `supabase/local/`), set `DATABASE_URL` to the Supabase connection string and a strong `SESSION_SECRET`. Passwords are bcrypt, the same format as Supabase Auth.

## Supabase setup (production)
1. Supabase → SQL Editor → paste and run `supabase/setup.sql` (all tables, security rules, audit trail).
2. Edit the 4 "CHANGE ME" values in `supabase/first-owner.sql`, paste and run it once (organisation, default lists, owner login).
3. Hosting env vars: `DATABASE_URL` (Supabase pooler connection string), `SESSION_SECRET` (random, 32+ chars). Optional `DATABASE_SSL_CA` to verify the certificate.

`supabase/setup.sql` is generated from `supabase/migrations/*.sql`; regenerate it when migrations change.
