-- =====================================================================
-- MERAGHAR OS — LOGIN ACCOUNT FUNCTIONS
-- On Supabase the login table (auth.users) is locked down. The app never
-- touches it directly; it calls these five small functions instead. They
-- can only be called by the server's privileged role (service_role),
-- never by signed-in users or visitors.
-- =====================================================================

create or replace function app_auth_find_login(p_email text)
returns table (id uuid, password_hash text, is_active boolean, deleted boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.encrypted_password::text, p.is_active, p.deleted_at is not null
    from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim(p_email))
   limit 1
$$;

create or replace function app_auth_email_exists(p_email text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)))
$$;

create or replace function app_auth_create_user(p_email text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(trim(p_email)), p_password_hash, now(), now(), now());
  return v_id;
end $$;

create or replace function app_auth_get_hash(p_id uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select encrypted_password::text from auth.users where id = p_id
$$;

create or replace function app_auth_set_password(p_id uuid, p_password_hash text) returns void
language sql security definer set search_path = public, auth as $$
  update auth.users set encrypted_password = p_password_hash, updated_at = now() where id = p_id
$$;

create or replace function app_auth_touch_login(p_id uuid) returns void
language sql security definer set search_path = public, auth as $$
  update auth.users set last_sign_in_at = now() where id = p_id
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'app_auth_find_login(text)', 'app_auth_email_exists(text)', 'app_auth_create_user(text, text)',
    'app_auth_get_hash(uuid)', 'app_auth_set_password(uuid, text)', 'app_auth_touch_login(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
