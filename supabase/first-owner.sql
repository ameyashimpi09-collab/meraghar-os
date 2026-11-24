-- =====================================================================
-- MERAGHAR OS — FIRST-TIME SETUP (run ONCE, after setup.sql)
-- Creates your organisation, its default lists, and the owner login.
--
-- BEFORE RUNNING: change the 4 values marked "CHANGE ME" below.
-- Choose your own password here; it is stored only as a secure hash.
-- =====================================================================
do $$
declare
  v_owner_name  text := 'ameya';                       -- CHANGE ME: your name
  v_email       text := 'merakiinterior01@gmail.com';             -- CHANGE ME: your login email
  v_password    text := 'Rahul@1234$';  -- CHANGE ME: at least 8 characters
  v_phone       text := '+919028885152 ';                        -- CHANGE ME: your mobile number
  v_org uuid; v_user uuid;
begin
  if v_email = 'you@example.com' or v_password = 'Choose-A-Strong-Password-1' then
    raise exception 'Please change the email and password at the top of this script first.';
  end if;
  if length(v_password) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
  if exists (select 1 from organisations) then raise exception 'Setup has already been done.'; end if;

  insert into organisations (name, legal_name, slug, project_code_prefix)
  values ('Meraghar Interiors', 'Meraki Interior E-Solutions LLP', 'meraghar', 'MG') returning id into v_org;

  insert into scope_categories (organisation_id, name, sort_order)
  select v_org, n, o from unnest(array['Civil work','Electrical work','Plumbing','False ceiling','Carpentry','Kitchen',
    'Wardrobes','Painting','Wall treatments','Furniture','Lighting','Curtains and soft furnishings',
    'Client-supplied items','Other custom work']) with ordinality as t(n, o);

  insert into stage_templates (organisation_id, name, sort_order, default_duration_days)
  select v_org, n, o, d from unnest(
    array['Project onboarding','Site measurement','Design development','Design finalisation','Material finalisation',
          'Civil work','Electrical and plumbing','False ceiling','Painting and wall finishes','Carpentry',
          'Kitchen installation','Wardrobe installation','Furniture and lighting','Client-supplied item installation',
          'Final finishing','Snag rectification','Handover'],
    array[3,3,14,7,7,10,10,7,10,21,5,5,5,3,5,5,1]) with ordinality as t(n, d, o);

  insert into auth.users (instance_id, aud, role, email, encrypted_password, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(v_email),
          extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now())
  returning id into v_user;

  insert into profiles (id, organisation_id, role, full_name, email, phone, designation)
  values (v_user, v_org, 'owner', v_owner_name, lower(v_email), nullif(trim(v_phone), '+91'), 'Founder & Director');

  raise notice 'Done. You can now sign in as %', lower(v_email);
end $$;
