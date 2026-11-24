-- =====================================================================
-- MERAGHAR OS — RESET A LOGIN PASSWORD (run in Supabase → SQL Editor)
-- Only change the text BETWEEN the single quotes ' ' on the 2 lines below.
-- =====================================================================
do $$
declare
  v_email     text := 'you@example.com';      -- the login email
  v_password  text := 'New-Password-123';     -- the new password, at least 8 characters
  -- ------------- nothing below this line needs changing -------------
  v_id uuid; v_found text;
begin
  v_email := lower(trim(v_email));
  if length(v_password) < 8 then raise exception 'The password must be at least 8 characters.'; end if;
  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then
    select string_agg(email, ', ') into v_found from public.profiles where role = 'owner';
    raise exception 'No login found for %. Owner login(s) in the app: %', v_email, coalesce(v_found, 'none - run first-owner.sql');
  end if;
  update auth.users set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = v_id;
  update public.profiles set is_active = true where id = v_id;
  raise notice 'Done. Password changed for %', v_email;
end $$;
