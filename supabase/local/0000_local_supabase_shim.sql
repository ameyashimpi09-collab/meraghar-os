-- =====================================================================
-- LOCAL DEVELOPMENT ONLY
-- Recreates the small pieces of Supabase that the schema depends on
-- (auth schema, auth.users, auth.uid(), and the anon/authenticated/
-- service_role database roles). On a real Supabase project these already
-- exist, so this file is NOT run there.
-- =====================================================================

do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid,
  aud                 varchar(255),
  role                varchar(255),
  email               text unique,
  email_confirmed_at  timestamptz,
  encrypted_password  text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  last_sign_in_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
grant all on auth.users to service_role;

-- Same definition Supabase uses: reads the signed-in user's id from the
-- request's JWT claims, which the server sets per transaction.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase keeps pgcrypto in the "extensions" schema
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
