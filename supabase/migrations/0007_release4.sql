-- =====================================================================
-- MERAGHAR OS — RELEASE 4: client experience
--
-- Applied automatically when the app starts. Safe to run more than once.
--
-- What it adds
--   * Site progress updates with photos: the team writes them, the
--     project manager reviews and shares them with the client. Internal
--     updates and internal photos are never shown to the client.
--   * Client purchase tracker: items the client buys, with dimensions,
--     dates and status; the client updates the status; alerts before the
--     dates and when a purchase is late
--   * Snags / concerns: the client raises one with photos, the manager
--     assigns it, the team uploads resolution photos, the manager checks,
--     the client confirms or reopens with a reason. Every step is kept.
--   * Project documents shared with the client, with versions
--   * Reminders: purchase dates and late deliveries, and a nudge to the
--     manager when a project's regular client update is due
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FILES for site photos, snag photos, purchase reference images and
--    project documents. Extra policies are added next to the existing
--    ones (policies add up), so earlier file rules stay as they are.
-- ---------------------------------------------------------------------
alter table stored_files drop constraint if exists stored_files_entity_type_check;
alter table stored_files add constraint stored_files_entity_type_check
  check (entity_type in ('approval_revision', 'payment_transaction', 'task', 'quotation',
                         'site_update', 'snag', 'purchase', 'document'));

-- A file can be opened only by someone who can see the record pointing to
-- it. Those records have their own row security, so a client only gets
-- photos of shared updates, documents marked for them, and so on.
drop policy if exists files_select_r4 on stored_files;
create policy files_select_r4 on stored_files for select using (
  (entity_type = 'site_update'
     and exists (select 1 from site_update_media m where m.storage_path = stored_files.id::text
                   and m.project_id = stored_files.project_id and m.deleted_at is null))
  or (entity_type = 'snag'
     and exists (select 1 from snag_attachments a join snags s on s.id = a.snag_id
                  where a.storage_path = stored_files.id::text and s.project_id = stored_files.project_id and a.deleted_at is null))
  or (entity_type = 'purchase'
     and exists (select 1 from purchase_requirements p where p.reference_image_path = stored_files.id::text
                   and p.project_id = stored_files.project_id and p.deleted_at is null))
  or (entity_type = 'document'
     and exists (select 1 from project_documents d where d.storage_path = stored_files.id::text
                   and d.project_id = stored_files.project_id and d.deleted_at is null))
);
drop policy if exists files_insert_r4 on stored_files;
create policy files_insert_r4 on stored_files for insert with check (
  uploaded_by = auth.uid() and (
    (entity_type = 'site_update' and is_project_staff(project_id)
       and exists (select 1 from site_updates u where u.id = entity_id and u.project_id = stored_files.project_id
                     and u.deleted_at is null and (can_manage_project(u.project_id) or u.created_by = auth.uid())))
    or (entity_type = 'snag' and can_view_project(project_id)
       and exists (select 1 from snags s where s.id = entity_id and s.project_id = stored_files.project_id and s.deleted_at is null))
    or (entity_type = 'purchase' and can_manage_project(project_id)
       and exists (select 1 from purchase_requirements p where p.id = entity_id and p.project_id = stored_files.project_id))
    or (entity_type = 'document' and is_project_staff(project_id))
  )
);

-- ---------------------------------------------------------------------
-- 2. NEW COLUMNS AND TABLES
-- ---------------------------------------------------------------------
alter table site_updates add column if not exists title text;
alter table site_updates add column if not exists submitted_at timestamptz;
alter table site_updates add column if not exists review_note text;
alter table site_update_media add column if not exists file_name text;
alter table site_update_media add column if not exists mime_type text;
create index if not exists site_updates_status_idx on site_updates (status) where deleted_at is null;
create index if not exists site_update_media_project_idx on site_update_media (project_id) where deleted_at is null;

alter table purchase_requirements add column if not exists client_delivery_on date;
alter table purchase_requirements add column if not exists client_updated_at timestamptz;
alter table purchase_requirements add column if not exists informed_at timestamptz;

alter table snags add column if not exists resolution_note text;
alter table snags add column if not exists resolution_submitted_at timestamptz;
alter table snags add column if not exists resolution_submitted_by uuid references profiles(id);
alter table snag_attachments add column if not exists file_name text;
alter table snag_attachments add column if not exists mime_type text;

alter table project_documents add column if not exists supersedes_id uuid references project_documents(id);
create index if not exists project_documents_supersedes_idx on project_documents (supersedes_id);

-- Every status change of a purchase item: who, when, from what to what.
create table if not exists purchase_status_changes (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references purchase_requirements(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  old_status    purchase_status,
  new_status    purchase_status not null,
  note          text,
  changed_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists purchase_status_changes_idx on purchase_status_changes (purchase_id, created_at);

-- The story of a concern, step by step (raised, assigned, fixed, confirmed...)
create table if not exists snag_events (
  id              uuid primary key default gen_random_uuid(),
  snag_id         uuid not null references snags(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  event           text not null,
  note            text,
  client_visible  boolean not null default true,
  actor_id        uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists snag_events_snag_idx on snag_events (snag_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['purchase_status_changes', 'snag_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop trigger if exists trg_%s_updated_at on %I', t, t);
    execute format('create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
    execute format('drop trigger if exists trg_%s_immutable on %I', t, t);
    execute format('create trigger trg_%s_immutable before update or delete on %I for each row execute function forbid_change()', t, t);
  end loop;
end $$;

grant select on purchase_status_changes, snag_events to authenticated;
revoke insert, update, delete on purchase_status_changes, snag_events from authenticated;
grant all on purchase_status_changes, snag_events to service_role;
revoke all on purchase_status_changes, snag_events from anon;

drop policy if exists psc_select on purchase_status_changes;
create policy psc_select on purchase_status_changes for select using (can_view_project(project_id));
drop policy if exists snagev_select on snag_events;
create policy snagev_select on snag_events for select using (
  is_project_staff(project_id) or (is_project_client(project_id) and client_visible)
);

-- Comments and photos on a concern are a permanent record.
drop trigger if exists trg_snag_comments_immutable on snag_comments;
create trigger trg_snag_comments_immutable before update or delete on snag_comments
  for each row execute function forbid_change();
drop trigger if exists trg_snag_attachments_immutable on snag_attachments;
create trigger trg_snag_attachments_immutable before update or delete on snag_attachments
  for each row execute function forbid_change();
drop trigger if exists trg_snag_comments_audit on snag_comments;
create trigger trg_snag_comments_audit after insert on snag_comments
  for each row execute function write_audit_log();
drop trigger if exists trg_site_update_media_audit on site_update_media;
create trigger trg_site_update_media_audit after insert or update on site_update_media
  for each row execute function write_audit_log();

-- Clients see the team's names on updates and concerns, nothing more.
-- (profiles already shows people who share a project)

-- Note: the guard functions below run as the person making the change
-- (not security definer), so they can tell a signed-in person apart from
-- the workflow functions, which run with full rights.
-- ---------------------------------------------------------------------
-- 3. SITE UPDATES
-- draft          = being written
-- pending_review = sent to the project manager to share with the client
-- published      = recorded. Shared with the client only if client_visible.
-- archived       = taken back (hidden from the client)
-- ---------------------------------------------------------------------
create or replace function guard_site_update() returns trigger
language plpgsql set search_path = public as $$
declare v_shared_before boolean := false; v_mgr boolean;
begin
  if tg_op = 'UPDATE' then
    v_shared_before := old.status = 'published' and old.client_visible;
    if new.project_id <> old.project_id then raise exception 'A site update cannot be moved to another project'; end if;
  end if;
  v_mgr := auth.uid() is null or can_manage_project(new.project_id);
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' and new.status not in ('draft', 'pending_review', 'published') then
      raise exception 'A new site update starts as a draft, goes for review, or is saved as internal' using errcode = '42501';
    end if;
    -- Only the project manager can show an update to the client
    if new.status = 'published' and new.client_visible and not v_shared_before and not v_mgr then
      raise exception 'Only the project manager can share a site update with the client. Send it for review instead.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and v_shared_before and not v_mgr then
      raise exception 'This update is already shared with the client. Ask the project manager to change it.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
      raise exception 'The author of an update cannot be changed' using errcode = '42501';
    end if;
  end if;
  if new.status = 'pending_review' and (tg_op = 'INSERT' or old.status <> 'pending_review') then
    new.submitted_at := now();
    new.client_visible := true;      -- review = a request to share with the client
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published' or (new.client_visible and not old.client_visible)) then
    new.published_at := now();
    new.published_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists trg_site_updates_guard on site_updates;
create trigger trg_site_updates_guard before insert or update on site_updates
  for each row execute function guard_site_update();

create or replace function notify_site_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rec uuid; v_project text; v_who text;
  v_shared boolean := new.status = 'published' and new.client_visible and new.deleted_at is null;
  v_was_shared boolean := tg_op = 'UPDATE' and old.status = 'published' and old.client_visible and old.deleted_at is null;
  v_head text := coalesce(nullif(trim(new.title), ''), nullif(trim(new.work_category), ''), 'Site progress');
begin
  select name into v_project from projects where id = new.project_id;
  select full_name into v_who from profiles where id = new.created_by;
  if new.status = 'pending_review' and (tg_op = 'INSERT' or old.status <> 'pending_review') then
    for v_rec in select project_manager_ids(new.project_id) loop
      continue when v_rec = new.created_by;
      perform notify(v_rec, new.project_id, 'site_update.submitted', 'Site update to review · ' || v_project,
        coalesce(v_who, 'Team') || ': ' || v_head || coalesce(' (' || new.area || ')', '') || '. Review the photos and share it with the client.',
        '/m/updates/' || new.id, 'site_update', new.id, false, 'su-sub:' || new.id || ':' || new.submitted_at);
    end loop;
  end if;
  if v_shared and not v_was_shared then
    for v_rec in select project_client_ids(new.project_id) loop
      perform notify(v_rec, new.project_id, 'site_update.published', 'New site update: ' || v_head,
        coalesce(new.area || ' · ', '') || coalesce(left(new.work_completed, 160), 'New progress photos from your home.'),
        '/c/updates#u-' || new.id, 'site_update', new.id, false, 'su-pub:' || new.id);
    end loop;
    if new.created_by is not null and new.created_by is distinct from auth.uid() then
      perform notify(new.created_by, new.project_id, 'site_update.published', 'Your site update was shared with the client',
        v_project || ' · ' || v_head, case when exists (select 1 from profiles where id = new.created_by and role in ('owner','admin','project_manager'))
          then '/m/updates/' || new.id else '/e/updates/' || new.id end, 'site_update', new.id, false, 'su-pub-author:' || new.id);
    end if;
  end if;
  -- Sent back to the author with a note
  if tg_op = 'UPDATE' and old.status = 'pending_review' and new.status = 'draft' and new.created_by is distinct from auth.uid() then
    perform notify(new.created_by, new.project_id, 'site_update.returned', 'Site update sent back · ' || v_project,
      coalesce(new.review_note, 'Please make a few changes and send it again.'), '/e/updates/' || new.id,
      'site_update', new.id, false, null);
  end if;
  return new;
end $$;
drop trigger if exists trg_site_updates_notify on site_updates;
create trigger trg_site_updates_notify after insert or update on site_updates
  for each row execute function notify_site_update();

-- Photos: same project as their update, added only by someone who can edit it.
create or replace function guard_site_update_media() returns trigger
language plpgsql set search_path = public as $$
declare u site_updates;
begin
  select * into u from site_updates where id = new.site_update_id;
  if u.id is null or u.project_id <> new.project_id then raise exception 'Photo and update must belong to the same project'; end if;
  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' and (new.site_update_id, new.storage_path, new.uploaded_by) is distinct from (old.site_update_id, old.storage_path, old.uploaded_by) then
      raise exception 'A photo cannot be moved. Remove it and upload again.' using errcode = '42501';
    end if;
    if not can_manage_project(u.project_id) then
      if u.created_by <> auth.uid() or u.status not in ('draft', 'pending_review') then
        raise exception 'Only the author (before sharing) or the project manager can change these photos' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_site_update_media_guard on site_update_media;
create trigger trg_site_update_media_guard before insert or update on site_update_media
  for each row execute function guard_site_update_media();

-- ---------------------------------------------------------------------
-- 4. CLIENT PURCHASES
-- ---------------------------------------------------------------------
create or replace function purchase_label(s purchase_status) returns text
language sql immutable as $$
  select case s
    when 'not_yet_required' then 'Not yet required' when 'purchase_required' then 'Purchase required'
    when 'client_informed' then 'Client informed' when 'purchased' then 'Purchased'
    when 'delivery_scheduled' then 'Delivery scheduled' when 'delivered' then 'Delivered'
    when 'installed' then 'Installed' when 'delayed' then 'Delayed' when 'cancelled' then 'Cancelled' end
$$;

-- Clients may update the status (to their own steps), their remarks and
-- their delivery date. The team may update progress and remarks. Only
-- the project manager edits the specification itself.
create or replace function guard_purchase_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if new.project_id <> old.project_id then raise exception 'A purchase item cannot be moved to another project' using errcode = '42501'; end if;
    if my_role() = 'client' then
      if (to_jsonb(new) - array['status','client_remarks','client_delivery_on','client_updated_at','updated_at','width_mm','height_mm','depth_mm'])
         is distinct from (to_jsonb(old) - array['status','client_remarks','client_delivery_on','client_updated_at','updated_at','width_mm','height_mm','depth_mm']) then
        raise exception 'Clients can only update purchase status, delivery date and their remarks' using errcode = '42501';
      end if;
      if old.responsibility = 'company' then
        raise exception 'This item is being bought by our team' using errcode = '42501';
      end if;
      if new.status is distinct from old.status then
        if new.status not in ('purchased', 'delivery_scheduled', 'delivered') then
          raise exception 'Clients can mark items as purchased, delivery scheduled or delivered' using errcode = '42501';
        end if;
        if old.status in ('installed', 'cancelled') then
          raise exception 'This item is already closed' using errcode = '42501';
        end if;
      end if;
      new.client_updated_at := now();
    elsif not can_manage_project(old.project_id) then
      if (to_jsonb(new) - array['status','manager_remarks','updated_at','informed_at','width_mm','height_mm','depth_mm'])
         is distinct from (to_jsonb(old) - array['status','manager_remarks','updated_at','informed_at','width_mm','height_mm','depth_mm']) then
        raise exception 'Only the project manager can change the item details' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.status in ('client_informed') and old.status is distinct from new.status then
    new.informed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_purchase_guard on purchase_requirements;
create trigger trg_purchase_guard before update on purchase_requirements
  for each row execute function guard_purchase_update();

create or replace function validate_purchase() returns trigger
language plpgsql set search_path = public as $$
begin
  if length(trim(coalesce(new.item_name, ''))) = 0 then raise exception 'Name the item'; end if;
  if new.depends_on_stage_id is not null
     and not exists (select 1 from project_stages where id = new.depends_on_stage_id and project_id = new.project_id) then
    raise exception 'That stage belongs to another project';
  end if;
  if new.required_purchase_date is not null and new.required_delivery_date is not null
     and new.required_delivery_date < new.required_purchase_date then
    raise exception 'The site delivery date cannot be before the purchase date';
  end if;
  if new.installation_date is not null and new.required_delivery_date is not null
     and new.installation_date < new.required_delivery_date then
    raise exception 'The installation date cannot be before the delivery date';
  end if;
  if tg_op = 'INSERT' and current_user = 'authenticated' then
    new.created_by := auth.uid();
    if new.status = 'client_informed' then new.informed_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_purchase_validate on purchase_requirements;
create trigger trg_purchase_validate before insert or update on purchase_requirements
  for each row execute function validate_purchase();

create or replace function track_purchase_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rec uuid; v_project text; v_who text; v_client boolean;
  v_when date := coalesce(new.required_delivery_date, new.required_purchase_date);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.client_delivery_on is not distinct from old.client_delivery_on and new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;
  if new.deleted_at is not null then return new; end if;
  select name into v_project from projects where id = new.project_id;
  select full_name, role = 'client' into v_who, v_client from profiles where id = auth.uid();
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into purchase_status_changes (purchase_id, project_id, old_status, new_status, note, changed_by)
    values (new.id, new.project_id, case when tg_op = 'UPDATE' then old.status end, new.status,
            case when coalesce(v_client, false) then new.client_remarks else null end, auth.uid());
  end if;

  if coalesce(v_client, false) then
    -- The client updated their purchase: tell the managers
    for v_rec in select project_manager_ids(new.project_id) loop
      perform notify(v_rec, new.project_id,
        case when new.status = 'delivered' and old.status <> 'delivered' then 'purchase.delivered' else 'purchase.updated' end,
        case when new.status = 'delivered' and old.status <> 'delivered' then 'Delivery confirmed · ' else 'Client purchase update · ' end || v_project,
        new.item_name || ': ' || purchase_label(new.status)
          || coalesce(' · delivery on ' || fmt_day(new.client_delivery_on), '')
          || coalesce(' · "' || left(new.client_remarks, 120) || '"', ''),
        '/m/projects/' || new.project_id || '/purchases#p-' || new.id, 'purchase', new.id, false, null);
    end loop;
  elsif new.responsibility <> 'company' then
    -- The team asked the client to buy it, or flagged it as late
    if new.status in ('purchase_required', 'client_informed')
       and (tg_op = 'INSERT' or old.status not in ('purchase_required', 'client_informed')) then
      for v_rec in select project_client_ids(new.project_id) loop
        perform notify(v_rec, new.project_id, 'purchase.required', 'Please purchase: ' || new.item_name,
          'Your ' || lower(new.item_name) || ' is required at the site'
            || coalesce(' by ' || to_char(v_when, 'FMDD Month'), '')
            || '. Please ensure that the final dimensions and delivery schedule match the specifications shared by our team.',
          '/c/purchases#p-' || new.id, 'purchase', new.id, true, 'pur-req:' || new.id || ':' || coalesce(v_when::text, ''));
      end loop;
    elsif new.status = 'delayed' and tg_op = 'UPDATE' and old.status <> 'delayed' then
      for v_rec in select project_client_ids(new.project_id) loop
        perform notify(v_rec, new.project_id, 'purchase.delayed', 'Purchase running late: ' || new.item_name,
          'This item is now holding up work at your home. Please update its status or speak to your project manager.',
          '/c/purchases#p-' || new.id, 'purchase', new.id, true, null);
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_purchase_track on purchase_requirements;
create trigger trg_purchase_track after insert or update on purchase_requirements
  for each row execute function track_purchase_change();

-- ---------------------------------------------------------------------
-- 5. SNAGS / CONCERNS
-- Raising one is a plain insert (checked below). Every later step goes
-- through the workflow functions, which check permissions themselves.
-- ---------------------------------------------------------------------
create or replace function snag_log(p_snag uuid, p_project uuid, p_event text, p_note text, p_client_visible boolean)
returns void language sql security definer set search_path = public as $$
  insert into snag_events (snag_id, project_id, event, note, client_visible, actor_id)
  values (p_snag, p_project, p_event, nullif(trim(coalesce(p_note, '')), ''), p_client_visible, auth.uid())
$$;

create or replace function snag_link(p_recipient uuid, p_snag uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when r.role = 'client' then '/c/snags/' || p_snag
    when r.role in ('owner', 'admin', 'project_manager') then '/m/snags/' || p_snag
    else '/e/snags/' || p_snag end
  from profiles r where r.id = p_recipient
$$;

create or replace function guard_snag() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.assigned_to is not null or new.resolved_at is not null
       or new.client_confirmed_at is not null or new.resolution_submitted_at is not null or new.reopen_count <> 0 then
      raise exception 'A new concern starts as open' using errcode = '42501';
    end if;
    if new.raised_by <> auth.uid() then raise exception 'Raise concerns in your own name' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.status, new.assigned_to, new.assigned_by, new.resolved_at, new.resolved_by, new.client_confirmed_at,
      new.reopen_count, new.resolution_note, new.resolution_submitted_at, new.resolution_submitted_by,
      new.raised_by, new.project_id, new.description, new.created_at)
     is distinct from
     (old.status, old.assigned_to, old.assigned_by, old.resolved_at, old.resolved_by, old.client_confirmed_at,
      old.reopen_count, old.resolution_note, old.resolution_submitted_at, old.resolution_submitted_by,
      old.raised_by, old.project_id, old.description, old.created_at) then
    raise exception 'Concern status changes only through the concern workflow' using errcode = '42501';
  end if;
  if not can_manage_project(old.project_id) then
    raise exception 'Only the project manager can edit a concern' using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'A concern cannot be deleted. Resolve it instead.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_snags_guard on snags;
drop trigger if exists trg_snags_guard2 on snags;
create trigger trg_snags_guard before insert or update on snags
  for each row execute function guard_snag();

create or replace function notify_snag_raised() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rec uuid; v_project text; v_who text; v_client boolean;
begin
  select name into v_project from projects where id = new.project_id;
  select full_name, role = 'client' into v_who, v_client from profiles where id = new.raised_by;
  perform snag_log(new.id, new.project_id, 'raised', null, true);
  for v_rec in select project_manager_ids(new.project_id) loop
    continue when v_rec = new.raised_by;
    perform notify(v_rec, new.project_id, 'snag.new',
      case when v_client then 'New concern from client · ' else 'New snag · ' end || v_project,
      coalesce(v_who, 'Someone') || coalesce(' · ' || new.area, '') || ': ' || left(new.description, 160),
      '/m/snags/' || new.id, 'snag', new.id, coalesce(new.urgency in ('critical', 'high'), false), 'snag-new:' || new.id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_snags_notify on snags;
create trigger trg_snags_notify after insert on snags
  for each row execute function notify_snag_raised();

-- Photos on a concern: resolution photos are added by the team only.
create or replace function guard_snag_attachment() returns trigger
language plpgsql set search_path = public as $$
declare s snags;
begin
  select * into s from snags where id = new.snag_id;
  if s.id is null then raise exception 'Concern not found'; end if;
  if current_user = 'authenticated' then
    if new.kind = 'resolution' and not is_project_staff(s.project_id) then
      raise exception 'Only the team can add resolution photos' using errcode = '42501';
    end if;
    if new.kind = 'resolution' and not (can_manage_project(s.project_id) or s.assigned_to = auth.uid()) then
      raise exception 'Only the person assigned (or the project manager) can add resolution photos' using errcode = '42501';
    end if;
    if new.kind = 'report' and s.status = 'resolved' then
      raise exception 'This concern is closed. Reopen it to add photos.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_snag_attachments_guard on snag_attachments;
create trigger trg_snag_attachments_guard before insert on snag_attachments
  for each row execute function guard_snag_attachment();

-- Comments: the client hears about replies meant for them; the team hears
-- about the client's messages.
create or replace function notify_snag_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare s snags; v_rec uuid; v_who text; v_client boolean; v_project text;
begin
  select * into s from snags where id = new.snag_id;
  select full_name, role = 'client' into v_who, v_client from profiles where id = new.author_id;
  select name into v_project from projects where id = s.project_id;
  if v_client then
    for v_rec in select project_manager_ids(s.project_id) union select s.assigned_to where s.assigned_to is not null loop
      perform notify(v_rec, s.project_id, 'snag.comment', 'Client message on a concern · ' || v_project,
        left(new.body, 180), snag_link(v_rec, s.id), 'snag', s.id, false, null);
    end loop;
  else
    if not new.is_internal then
      for v_rec in select project_client_ids(s.project_id) loop
        perform notify(v_rec, s.project_id, 'snag.comment', 'Reply on your concern', left(new.body, 180),
          '/c/snags/' || s.id, 'snag', s.id, false, null);
      end loop;
    end if;
    for v_rec in select project_manager_ids(s.project_id) union select s.assigned_to where s.assigned_to is not null loop
      continue when v_rec = new.author_id;
      perform notify(v_rec, s.project_id, 'snag.comment', coalesce(v_who, 'Team') || ' commented on a snag · ' || v_project,
        left(new.body, 180), snag_link(v_rec, s.id), 'snag', s.id, false, null);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_snag_comments_notify on snag_comments;
create trigger trg_snag_comments_notify after insert on snag_comments
  for each row execute function notify_snag_comment();

-- Manager: looking into it
create or replace function snag_review(p_snag uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s snags;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not can_manage_project(s.project_id) then
    raise exception 'Only the project manager can review concerns' using errcode = '42501';
  end if;
  if s.status not in ('open', 'reopened') then return; end if;
  update snags set status = 'under_review' where id = s.id;
  perform snag_log(s.id, s.project_id, 'under_review', null, true);
end $$;

-- Manager: hand it to someone on the project team
create or replace function snag_assign(p_snag uuid, p_assignee uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s snags; v_name text; v_project text; v_rec uuid;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not can_manage_project(s.project_id) then
    raise exception 'Only the project manager can assign concerns' using errcode = '42501';
  end if;
  if s.status = 'resolved' then raise exception 'This concern is closed. It has to be reopened first.'; end if;
  if not exists (select 1 from project_members m join profiles pr on pr.id = m.profile_id and pr.is_active and pr.role <> 'client'
                  where m.project_id = s.project_id and m.profile_id = p_assignee and m.removed_at is null) then
    raise exception 'Assign the concern to someone on this project''s team';
  end if;
  select full_name into v_name from profiles where id = p_assignee;
  select name into v_project from projects where id = s.project_id;
  update snags set assigned_to = p_assignee, assigned_by = auth.uid(),
    status = case when status in ('in_progress') and assigned_to = p_assignee then status else 'assigned' end,
    resolution_submitted_at = null, resolution_submitted_by = null
   where id = s.id;
  perform snag_log(s.id, s.project_id, 'assigned', 'Assigned to ' || v_name, true);
  if length(trim(coalesce(p_note, ''))) > 0 then
    insert into snag_comments (snag_id, author_id, body, is_internal) values (s.id, auth.uid(), trim(p_note), true);
  end if;
  if p_assignee <> auth.uid() then
    perform notify(p_assignee, s.project_id, 'snag.assigned', 'Snag assigned to you · ' || v_project,
      coalesce(s.area || ': ', '') || left(s.description, 160), snag_link(p_assignee, s.id), 'snag', s.id, false,
      'snag-asg:' || s.id || ':' || p_assignee || ':' || extract(epoch from now())::bigint);
  end if;
  for v_rec in select project_client_ids(s.project_id) loop
    continue when s.status not in ('open', 'under_review', 'reopened');
    perform notify(v_rec, s.project_id, 'snag.status', 'Your concern is being handled',
      'Our team member ' || split_part(v_name, ' ', 1) || ' will look into it' || coalesce(' (' || s.area || ')', '') || '.',
      '/c/snags/' || s.id, 'snag', s.id, false, null);
  end loop;
end $$;

-- Assignee: started working on it
create or replace function snag_start(p_snag uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s snags;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not (can_manage_project(s.project_id) or (s.assigned_to = auth.uid() and is_project_staff(s.project_id))) then
    raise exception 'Only the person assigned can start work on this concern' using errcode = '42501';
  end if;
  if s.status not in ('assigned', 'reopened', 'under_review', 'open') then return; end if;
  update snags set status = 'in_progress' where id = s.id;
  perform snag_log(s.id, s.project_id, 'in_progress', null, true);
end $$;

-- Assignee: work done, here are the photos. The manager checks before the client is told.
create or replace function snag_submit_resolution(p_snag uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s snags; v_rec uuid; v_project text; v_who text;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not (can_manage_project(s.project_id) or (s.assigned_to = auth.uid() and is_project_staff(s.project_id))) then
    raise exception 'Only the person assigned can submit the fix' using errcode = '42501';
  end if;
  if s.status not in ('assigned', 'in_progress', 'reopened') then raise exception 'This concern is not open for work'; end if;
  if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Describe what was done to fix it'; end if;
  if not exists (select 1 from snag_attachments where snag_id = s.id and kind = 'resolution' and created_at >= coalesce(
                   (select max(created_at) from snag_events where snag_id = s.id and event in ('reopened', 'sent_back')), s.created_at)) then
    raise exception 'Add at least one photo of the finished work';
  end if;
  update snags set status = 'in_progress', resolution_note = trim(p_note), resolution_submitted_at = now(),
                   resolution_submitted_by = auth.uid() where id = s.id;
  perform snag_log(s.id, s.project_id, 'fix_submitted', trim(p_note), false);
  select name into v_project from projects where id = s.project_id;
  select full_name into v_who from profiles where id = auth.uid();
  for v_rec in select project_manager_ids(s.project_id) loop
    continue when v_rec = auth.uid();
    perform notify(v_rec, s.project_id, 'snag.fix_submitted', 'Snag fix to check · ' || v_project,
      coalesce(v_who, 'Team') || ': ' || left(trim(p_note), 160), '/m/snags/' || s.id, 'snag', s.id, false, null);
  end loop;
end $$;

-- Manager: accept the fix (the client is asked to confirm), or send it back.
create or replace function snag_resolve(p_snag uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s snags; v_rec uuid; v_client_login boolean;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not can_manage_project(s.project_id) then
    raise exception 'Only the project manager can resolve concerns' using errcode = '42501';
  end if;
  if s.status in ('resolved', 'awaiting_client_confirmation') then raise exception 'This concern is already resolved'; end if;
  if p_accept then
    v_client_login := exists (select project_client_ids(s.project_id));
    if not exists (select 1 from snag_attachments where snag_id = s.id and kind = 'resolution') then
      raise exception 'Add a photo of the finished work before marking it resolved';
    end if;
    update snags set status = case when v_client_login then 'awaiting_client_confirmation'::snag_status else 'resolved'::snag_status end,
      resolved_at = now(), resolved_by = auth.uid(),
      resolution_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), resolution_note)
     where id = s.id;
    perform snag_log(s.id, s.project_id, 'resolved', coalesce(nullif(trim(coalesce(p_note, '')), ''), s.resolution_note), true);
    for v_rec in select project_client_ids(s.project_id) loop
      perform notify(v_rec, s.project_id, 'snag.resolved', 'Your concern has been resolved',
        'Please check' || coalesce(' the ' || lower(s.area), '') || ' and confirm, or reopen it if something is still not right.',
        '/c/snags/' || s.id, 'snag', s.id, false, 'snag-res:' || s.id || ':' || s.reopen_count);
    end loop;
    if s.assigned_to is not null and s.assigned_to <> auth.uid() then
      perform notify(s.assigned_to, s.project_id, 'snag.status', 'Your snag fix was accepted', left(s.description, 160),
        snag_link(s.assigned_to, s.id), 'snag', s.id, false, null);
    end if;
  else
    if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say what still needs to be done'; end if;
    update snags set status = case when assigned_to is null then 'under_review'::snag_status else 'in_progress'::snag_status end,
      resolution_submitted_at = null, resolution_submitted_by = null where id = s.id;
    perform snag_log(s.id, s.project_id, 'sent_back', trim(p_note), false);
    if s.assigned_to is not null and s.assigned_to <> auth.uid() then
      perform notify(s.assigned_to, s.project_id, 'snag.status', 'Snag fix needs more work', left(trim(p_note), 180),
        snag_link(s.assigned_to, s.id), 'snag', s.id, false, null);
    end if;
  end if;
end $$;

-- Client: confirm it is fixed
create or replace function snag_client_confirm(p_snag uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s snags; v_rec uuid; v_project text;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not is_project_client(s.project_id) then
    raise exception 'Only the client can confirm this' using errcode = '42501';
  end if;
  if s.status <> 'awaiting_client_confirmation' then raise exception 'This concern is not waiting for your confirmation'; end if;
  update snags set status = 'resolved', client_confirmed_at = now() where id = s.id;
  perform snag_log(s.id, s.project_id, 'confirmed', null, true);
  select name into v_project from projects where id = s.project_id;
  for v_rec in select project_manager_ids(s.project_id) union select s.assigned_to where s.assigned_to is not null loop
    perform notify(v_rec, s.project_id, 'snag.confirmed', 'Client confirmed the fix · ' || v_project, left(s.description, 160),
      snag_link(v_rec, s.id), 'snag', s.id, false, null);
  end loop;
end $$;

-- Client: not fixed, reopen with a reason
create or replace function snag_client_reopen(p_snag uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s snags; v_rec uuid; v_project text;
begin
  select * into s from snags where id = p_snag and deleted_at is null for update;
  if s.id is null or not (is_project_client(s.project_id) or can_manage_project(s.project_id)) then
    raise exception 'Only the client or the project manager can reopen this' using errcode = '42501';
  end if;
  if s.status not in ('awaiting_client_confirmation', 'resolved') then raise exception 'This concern is still open'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Tell us what is still not right'; end if;
  update snags set status = 'reopened', reopen_count = reopen_count + 1, client_confirmed_at = null,
                   resolved_at = null, resolved_by = null, resolution_submitted_at = null, resolution_submitted_by = null
   where id = s.id;
  perform snag_log(s.id, s.project_id, 'reopened', trim(p_reason), true);
  select name into v_project from projects where id = s.project_id;
  for v_rec in select project_manager_ids(s.project_id) union select s.assigned_to where s.assigned_to is not null loop
    continue when v_rec = auth.uid();
    perform notify(v_rec, s.project_id, 'snag.reopened', 'Concern reopened · ' || v_project, left(trim(p_reason), 180),
      snag_link(v_rec, s.id), 'snag', s.id, true, null);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. DOCUMENTS: the client hears when something is shared with them
-- ---------------------------------------------------------------------
create or replace function validate_document() returns trigger
language plpgsql set search_path = public as $$
begin
  if length(trim(coalesce(new.title, ''))) = 0 then raise exception 'Give the document a title'; end if;
  if new.supersedes_id is not null and not exists (
       select 1 from project_documents where id = new.supersedes_id and project_id = new.project_id) then
    raise exception 'The earlier version belongs to another project';
  end if;
  if new.doc_type = 'quotation' and new.client_visible and current_user = 'authenticated' and not can_manage_project(new.project_id) then
    raise exception 'Only the project manager can share a quotation' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and (new.storage_path, new.project_id, new.uploaded_by) is distinct from (old.storage_path, old.project_id, old.uploaded_by) then
    raise exception 'Upload a new version instead of replacing the file' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_project_documents_validate on project_documents;
create trigger trg_project_documents_validate before insert or update on project_documents
  for each row execute function validate_document();

create or replace function notify_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rec uuid;
begin
  if new.client_visible and new.deleted_at is null and (tg_op = 'INSERT' or not old.client_visible or old.deleted_at is not null) then
    for v_rec in select project_client_ids(new.project_id) loop
      perform notify(v_rec, new.project_id, 'document.shared',
        case when new.supersedes_id is not null then 'Updated document: ' else 'New document: ' end || new.title,
        coalesce(left(new.description, 160), 'A document has been shared with you.'),
        '/c/documents#d-' || new.id, 'document', new.id, false, 'doc:' || new.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_project_documents_notify on project_documents;
create trigger trg_project_documents_notify after insert or update on project_documents
  for each row execute function notify_document();

-- ---------------------------------------------------------------------
-- 7. DAILY REMINDERS now include client purchases and the regular
--    client site update.
-- Purchases (client / shared items not yet bought): 7 and 3 days before
-- the purchase date and on the day. Bought but not delivered: 2 days
-- before and on the site delivery date. Not delivered by the delivery
-- date: the client and the managers, the day after, then every 3 days.
-- Site updates: the managers and site supervisor are reminded when a
-- project has gone longer than its update frequency without a shared update.
-- ---------------------------------------------------------------------
create or replace function run_reminders(p_today date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, today_ist());
  v_org uuid;
  v_total integer := 0;
  r record; d integer; n integer; v_rec uuid; v_event text; v_title text; v_body text; v_key text;
begin
  if auth.uid() is not null then
    if not is_org_admin() then
      raise exception 'Only an owner or admin can run reminders' using errcode = '42501';
    end if;
    v_org := my_org_id();
    v_today := today_ist();
  end if;

  -- Payments
  for r in
    select m.id, m.project_id, m.name, m.due_date, p.name as project_name,
           (m.amount_paise - coalesce((select sum(t.amount_paise) from payment_transactions t
                                       where t.milestone_id = m.id and t.voided_at is null), 0))::bigint as outstanding,
           greatest(0, least(30, coalesce(nullif(o.settings ->> 'overdue_reminder_limit', '')::int, 5))) as lim
      from payment_milestones m
      join projects p on p.id = m.project_id and p.deleted_at is null and p.status in ('active', 'on_hold')
      join organisations o on o.id = p.organisation_id
     where m.deleted_at is null and m.status <> 'on_hold' and not m.reminders_paused and m.due_date is not null
       and (v_org is null or p.organisation_id = v_org)
  loop
    continue when r.outstanding <= 0;
    d := r.due_date - v_today;
    v_event := null;
    if d in (7, 3) then
      v_event := 'payment.upcoming';
      v_title := 'Payment due in ' || d || ' days';
      v_body := fmt_inr(r.outstanding) || ' for "' || r.name || '" is due on ' || fmt_day(r.due_date) || '.';
    elsif d = 0 then
      v_event := 'payment.due';
      v_title := 'Payment due today';
      v_body := fmt_inr(r.outstanding) || ' for "' || r.name || '" is due today.';
    elsif d < 0 then
      n := -d;
      if n = 1 or ((n - 1) % 3 = 0 and (n - 1) / 3 <= r.lim) then
        v_event := 'payment.overdue';
        v_title := 'Payment overdue';
        v_body := fmt_inr(r.outstanding) || ' for "' || r.name || '" was due on ' || fmt_day(r.due_date)
                  || ' (' || n || ' day' || case when n = 1 then '' else 's' end || ' ago).';
      end if;
    end if;
    continue when v_event is null;
    v_key := 'pay:' || r.id || ':' || r.due_date || ':' || d;
    for v_rec in select project_client_ids(r.project_id) loop
      v_total := v_total + notify(v_rec, r.project_id, v_event, v_title, v_body, '/c/payments', 'payment_milestone', r.id, true, v_key);
    end loop;
    if v_event = 'payment.overdue' then
      for v_rec in select project_manager_ids(r.project_id) loop
        v_total := v_total + notify(v_rec, r.project_id, v_event, 'Client payment overdue · ' || r.project_name, v_body,
          '/m/projects/' || r.project_id || '/payments', 'payment_milestone', r.id, true, v_key);
      end loop;
    end if;
  end loop;

  -- Approvals waiting for the client
  for r in
    select a.id, a.project_id, a.title, a.deadline, a.current_revision_no, p.name as project_name,
           greatest(0, least(30, coalesce(nullif(o.settings ->> 'overdue_reminder_limit', '')::int, 5))) as lim
      from approvals a
      join projects p on p.id = a.project_id and p.deleted_at is null and p.status in ('active', 'on_hold')
      join organisations o on o.id = p.organisation_id
     where a.deleted_at is null and a.status = 'pending' and a.deadline is not null
       and (v_org is null or p.organisation_id = v_org)
  loop
    d := r.deadline - v_today;
    v_event := null;
    if d = 2 then
      v_event := 'approval.deadline';
      v_title := 'Approval needed in 2 days';
      v_body := 'Please review "' || r.title || '" by ' || fmt_day(r.deadline) || '.';
    elsif d = 0 then
      v_event := 'approval.deadline';
      v_title := 'Approval needed today';
      v_body := 'Please review "' || r.title || '" today so work can continue on time.';
    elsif d < 0 then
      n := -d;
      if n = 1 or ((n - 1) % 3 = 0 and (n - 1) / 3 <= r.lim) then
        v_event := 'approval.overdue';
        v_title := 'Approval overdue';
        v_body := '"' || r.title || '" was due for your decision on ' || fmt_day(r.deadline)
                  || '. Waiting may delay the next stage of work.';
      end if;
    end if;
    continue when v_event is null;
    v_key := 'appr:' || r.id || ':' || r.current_revision_no || ':' || r.deadline || ':' || d;
    for v_rec in select project_client_ids(r.project_id) loop
      v_total := v_total + notify(v_rec, r.project_id, v_event, v_title, v_body, '/c/approvals/' || r.id, 'approval', r.id, true, v_key);
    end loop;
    if v_event = 'approval.overdue' then
      for v_rec in select project_manager_ids(r.project_id) loop
        v_total := v_total + notify(v_rec, r.project_id, v_event, 'Client approval overdue · ' || r.project_name,
          '"' || r.title || '" was due on ' || fmt_day(r.deadline) || ' (' || n || ' day' || case when n = 1 then '' else 's' end || ' ago).',
          '/m/approvals/' || r.id, 'approval', r.id, true, v_key);
      end loop;
    end if;
  end loop;

  -- Task deadlines (internal team only; clients never get these)
  for r in
    select t.id, t.project_id, t.title, t.due_date, t.assigned_to, p.name as project_name,
           greatest(0, least(30, coalesce(nullif(o.settings ->> 'overdue_reminder_limit', '')::int, 5))) as lim
      from tasks t
      join projects p on p.id = t.project_id and p.deleted_at is null and p.status in ('active', 'on_hold')
      join organisations o on o.id = p.organisation_id
     where t.deleted_at is null and t.status not in ('completed', 'cancelled') and t.due_date is not null and t.assigned_to is not null
       and (v_org is null or p.organisation_id = v_org)
  loop
    d := r.due_date - v_today;
    v_event := null;
    if d = 1 then
      v_event := 'task.deadline'; v_title := 'Task due tomorrow: ' || r.title;
      v_body := r.project_name || ' · due ' || fmt_day(r.due_date) || '.';
    elsif d = 0 then
      v_event := 'task.deadline'; v_title := 'Task due today: ' || r.title;
      v_body := r.project_name || '. If something is stopping you, flag a blocker so your manager knows.';
    elsif d < 0 then
      n := -d;
      if n = 1 or ((n - 1) % 3 = 0 and (n - 1) / 3 <= r.lim) then
        v_event := 'task.overdue'; v_title := 'Task overdue: ' || r.title;
        v_body := r.project_name || ' · was due ' || fmt_day(r.due_date) || ' (' || n || ' day' || case when n = 1 then '' else 's' end || ' ago).';
      end if;
    end if;
    continue when v_event is null;
    v_key := 'task:' || r.id || ':' || r.due_date || ':' || d;
    v_total := v_total + notify(r.assigned_to, r.project_id, v_event, v_title, v_body, task_link(r.assigned_to, r.id), 'task', r.id, false, v_key);
    if v_event = 'task.overdue' and n = 1 then
      for v_rec in select project_manager_ids(r.project_id) loop
        continue when v_rec = r.assigned_to;
        v_total := v_total + notify(v_rec, r.project_id, v_event, 'Task overdue · ' || r.project_name,
          '"' || r.title || '" (' || coalesce((select full_name from profiles where id = r.assigned_to), 'unassigned')
          || ') was due ' || fmt_day(r.due_date) || '.', '/m/tasks/' || r.id, 'task', r.id, false, v_key);
      end loop;
    end if;
  end loop;

  -- Stages that missed their planned end date yesterday
  for r in
    select s.id, s.project_id, s.name, s.planned_end_date, p.name as project_name
      from project_stages s
      join projects p on p.id = s.project_id and p.deleted_at is null and p.status in ('active', 'on_hold')
     where s.deleted_at is null and s.status not in ('completed', 'skipped') and s.planned_end_date = v_today - 1
       and (v_org is null or p.organisation_id = v_org)
  loop
    for v_rec in select project_manager_ids(r.project_id) loop
      v_total := v_total + notify(v_rec, r.project_id, 'stage.overdue', 'Stage behind schedule · ' || r.project_name,
        '"' || r.name || '" was planned to finish on ' || fmt_day(r.planned_end_date) || ' and is not complete. Update its status or dates.',
        '/m/projects/' || r.project_id || '/schedule', 'stage', r.id, true, 'stage:' || r.id || ':' || r.planned_end_date);
    end loop;
  end loop;

  -- Client purchases (items the client buys)
  for r in
    select x.id, x.project_id, x.item_name, x.status, x.required_purchase_date, x.required_delivery_date, p.name as project_name,
           greatest(0, least(30, coalesce(nullif(o.settings ->> 'overdue_reminder_limit', '')::int, 5))) as lim
      from purchase_requirements x
      join projects p on p.id = x.project_id and p.deleted_at is null and p.status in ('active', 'on_hold')
      join organisations o on o.id = p.organisation_id
     where x.deleted_at is null and x.responsibility <> 'company'
       and x.status not in ('delivered', 'installed', 'cancelled')
       and (v_org is null or p.organisation_id = v_org)
  loop
    v_event := null;
    if r.required_delivery_date is not null and r.required_delivery_date < v_today then
      n := v_today - r.required_delivery_date;
      if n = 1 or ((n - 1) % 3 = 0 and (n - 1) / 3 <= r.lim) then
        v_event := 'purchase.delayed';
        v_title := 'Purchase overdue: ' || r.item_name;
        v_body := 'Your ' || lower(r.item_name) || ' was needed at the site by ' || fmt_day(r.required_delivery_date)
                  || '. Please update its status so our team can plan the installation.';
        v_key := 'pur-late:' || r.id || ':' || r.required_delivery_date || ':' || n;
      end if;
    elsif r.status in ('not_yet_required', 'purchase_required', 'client_informed', 'delayed') and r.required_purchase_date is not null then
      d := r.required_purchase_date - v_today;
      if d in (7, 3, 0) then
        v_event := 'purchase.deadline';
        v_title := case when d = 0 then 'Please purchase today: ' else 'Purchase needed in ' || d || ' days: ' end || r.item_name;
        v_body := 'Your ' || lower(r.item_name) || ' is required at the site by '
                  || to_char(coalesce(r.required_delivery_date, r.required_purchase_date), 'FMDD Month')
                  || '. Please ensure that the final dimensions and delivery schedule match the specifications shared by our team.';
        v_key := 'pur-buy:' || r.id || ':' || r.required_purchase_date || ':' || d;
      end if;
    elsif r.status in ('purchased', 'delivery_scheduled') and r.required_delivery_date is not null then
      d := r.required_delivery_date - v_today;
      if d in (2, 0) then
        v_event := 'purchase.deadline';
        v_title := case when d = 0 then 'Delivery due today: ' else 'Delivery due in 2 days: ' end || r.item_name;
        v_body := 'Please make sure your ' || lower(r.item_name) || ' reaches the site by ' || fmt_day(r.required_delivery_date)
                  || ', and mark it delivered here once it arrives.';
        v_key := 'pur-del:' || r.id || ':' || r.required_delivery_date || ':' || d;
      end if;
    end if;
    continue when v_event is null;
    for v_rec in select project_client_ids(r.project_id) loop
      v_total := v_total + notify(v_rec, r.project_id, v_event, v_title, v_body, '/c/purchases#p-' || r.id, 'purchase', r.id, true, v_key);
    end loop;
    if v_event = 'purchase.delayed' then
      for v_rec in select project_manager_ids(r.project_id) loop
        v_total := v_total + notify(v_rec, r.project_id, v_event, 'Client purchase late · ' || r.project_name,
          r.item_name || ' was needed at the site by ' || fmt_day(r.required_delivery_date) || ' (' || n || ' day'
          || case when n = 1 then '' else 's' end || ' ago). It may delay work.',
          '/m/projects/' || r.project_id || '/purchases#p-' || r.id, 'purchase', r.id, true, v_key);
      end loop;
    end if;
  end loop;

  -- Regular client site update is due (internal reminder only)
  for r in
    select p.id as project_id, p.name as project_name, p.site_update_frequency_days as freq,
           coalesce((select max((u.published_at at time zone 'Asia/Kolkata')::date) from site_updates u
                      where u.project_id = p.id and u.deleted_at is null and u.status = 'published' and u.client_visible),
                    p.expected_start_date) as since
      from projects p
     where p.deleted_at is null and p.status = 'active' and p.expected_start_date is not null and p.expected_start_date <= v_today
       and p.actual_handover_date is null
       and (v_org is null or p.organisation_id = v_org)
  loop
    d := v_today - r.since;
    continue when d < r.freq;
    -- once when it becomes due, then once per further period
    continue when (d - r.freq) % r.freq <> 0;
    v_key := 'su-due:' || r.project_id || ':' || r.since || ':' || d;
    for v_rec in
      select project_manager_ids(r.project_id)
      union
      select m.profile_id from project_members m join profiles pr on pr.id = m.profile_id and pr.is_active
       where m.project_id = r.project_id and m.member_role = 'site_supervisor' and m.removed_at is null
    loop
      v_total := v_total + notify(v_rec, r.project_id, 'site_update.due', 'Client site update due · ' || r.project_name,
        'The client has not had a progress update for ' || d || ' days (planned every ' || r.freq || ' days). Share photos from the site.',
        case when exists (select 1 from profiles where id = v_rec and role in ('owner', 'admin', 'project_manager'))
             then '/m/updates/new?project=' || r.project_id else '/e/updates/new?project=' || r.project_id end,
        'project', r.project_id, false, v_key);
    end loop;
  end loop;

  insert into reminder_runs (run_for, notifications_created, triggered_by) values (v_today, v_total, auth.uid());
  return v_total;
end $$;

-- ---------------------------------------------------------------------
-- 8. WHO MAY CALL WHAT
-- ---------------------------------------------------------------------
revoke all on function snag_log(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function snag_link(uuid, uuid) from public, anon, authenticated;
revoke all on function snag_review(uuid) from public, anon;
revoke all on function snag_assign(uuid, uuid, text) from public, anon;
revoke all on function snag_start(uuid) from public, anon;
revoke all on function snag_submit_resolution(uuid, text) from public, anon;
revoke all on function snag_resolve(uuid, boolean, text) from public, anon;
revoke all on function snag_client_confirm(uuid) from public, anon;
revoke all on function snag_client_reopen(uuid, text) from public, anon;
revoke all on function run_reminders(date) from public, anon;
grant execute on function snag_review(uuid), snag_assign(uuid, uuid, text), snag_start(uuid),
  snag_submit_resolution(uuid, text), snag_resolve(uuid, boolean, text), snag_client_confirm(uuid),
  snag_client_reopen(uuid, text), run_reminders(date) to authenticated;
grant execute on function run_reminders(date) to service_role;
