-- =====================================================================
-- MERAGHAR OS — STEP 2: create your company and your owner login
-- Run AFTER Step 1 (setup.sql). Safe to run again if something failed.
--
-- Only change the text BETWEEN the single quotes ' ' on the 4 lines below.
-- Keep the quotes and the semicolon at the end of each line.
-- =====================================================================
do $$
declare
  v_owner_name  text := 'Rahul';                  -- your name
  v_email       text := 'you@example.com';        -- your login email
  v_password    text := 'Temp-Password-123';      -- a temporary password, at least 8 characters
  v_phone       text := '';                       -- your mobile number (optional)
  -- ------------- nothing below this line needs changing -------------
  v_org uuid; v_user uuid;
begin
  if to_regclass('public.organisations') is null then
    raise exception 'Step 1 has not been run yet. Please run setup.sql first, then this script.';
  end if;
  v_email := lower(trim(v_email));
  if v_email = 'you@example.com' or v_email not like '%_@_%._%' then
    raise exception 'Please put your real email address on the "your login email" line.';
  end if;
  if length(v_password) < 8 then
    raise exception 'The password must be at least 8 characters.';
  end if;

  -- Company (created once; reused if this script is run again)
  select id into v_org from organisations where slug = 'meraghar';
  if v_org is null then
    insert into organisations (name, legal_name, slug, project_code_prefix)
    values ('Meraghar Interiors', 'Meraki Interior E-Solutions LLP', 'meraghar', 'MG') returning id into v_org;
  end if;

  insert into scope_categories (organisation_id, name, sort_order)
  select v_org, n, o from unnest(array['Civil work','Electrical work','Plumbing','False ceiling','Carpentry','Kitchen',
    'Wardrobes','Painting','Wall treatments','Furniture','Lighting','Curtains and soft furnishings',
    'Client-supplied items','Other custom work']) with ordinality as t(n, o)
  on conflict (organisation_id, name) do nothing;

  insert into stage_templates (organisation_id, name, sort_order, default_duration_days)
  select v_org, n, o, d from unnest(
    array['Project onboarding','Site measurement','Design development','Design finalisation','Material finalisation',
          'Civil work','Electrical and plumbing','False ceiling','Painting and wall finishes','Carpentry',
          'Kitchen installation','Wardrobe installation','Furniture and lighting','Client-supplied item installation',
          'Final finishing','Snag rectification','Handover'],
    array[3,3,14,7,7,10,10,7,10,21,5,5,5,3,5,5,1]) with ordinality as t(n, d, o)
  on conflict (organisation_id, name) do nothing;

  -- Standard tasks for each stage (added once; editable under Settings)
  if to_regprocedure('public.seed_default_task_templates(uuid)') is not null then
    perform seed_default_task_templates(v_org);
  end if;

  -- Owner login (if this email already exists, its password is reset)
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
            extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)), updated_at = now()
     where id = v_user;
  end if;

  insert into profiles (id, organisation_id, role, full_name, email, phone, designation)
  values (v_user, v_org, 'owner', coalesce(nullif(trim(v_owner_name), ''), 'Owner'), v_email, nullif(trim(v_phone), ''), 'Founder & Director')
  on conflict (id) do update set role = 'owner', is_active = true, deleted_at = null, organisation_id = excluded.organisation_id;

  raise notice 'Done. You can now sign in as %', v_email;
end $$;
