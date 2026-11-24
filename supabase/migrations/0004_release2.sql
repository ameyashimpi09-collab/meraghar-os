-- =====================================================================
-- MERAGHAR OS — RELEASE 2: approvals, payments, reminders, files
--
-- Safe to run more than once (every step checks before it creates).
-- Paste this whole file into Supabase → SQL Editor → Run.
--
-- What it adds
--   * Design / material approval workflow with locked revisions
--   * Payment schedule rules (partial payments, due-date changes with
--     a reason, holds, paused reminders)
--   * In-app notifications for approvals and payments
--   * Daily automatic reminders (8:00 AM India time) using Supabase Cron
--   * Private file storage for design files and payment receipts
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FILES (design images / PDFs / receipts), kept inside the database.
--    A file can only be opened by someone who can see the record it
--    belongs to. Files are never served publicly.
-- ---------------------------------------------------------------------
create table if not exists stored_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  entity_type  text not null check (entity_type in ('approval_revision', 'payment_transaction')),
  entity_id    uuid not null,
  file_name    text not null check (length(trim(file_name)) > 0),
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  data         bytea not null,
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists stored_files_entity_idx on stored_files (entity_type, entity_id);

-- Manager replies to a client's query on an approval.
create table if not exists approval_messages (
  id           uuid primary key default gen_random_uuid(),
  approval_id  uuid not null references approvals(id) on delete cascade,
  revision_id  uuid references approval_revisions(id),
  project_id   uuid not null references projects(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  author_id    uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists approval_messages_approval_idx on approval_messages (approval_id, created_at);

-- A record of each reminder run (shown on the status and payments pages).
create table if not exists reminder_runs (
  id                     uuid primary key default gen_random_uuid(),
  run_for                date not null,
  notifications_created  integer not null default 0,
  triggered_by           uuid references profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists reminder_runs_created_idx on reminder_runs (created_at desc);

do $$
declare t text;
begin
  foreach t in array array['stored_files', 'approval_messages', 'reminder_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop trigger if exists trg_%s_updated_at on %I', t, t);
    execute format('create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

grant select, insert, delete on stored_files to authenticated;
grant select, insert on approval_messages to authenticated;
grant select on reminder_runs to authenticated;
grant all on stored_files, approval_messages, reminder_runs to service_role;
revoke all on stored_files, approval_messages, reminder_runs from anon;

-- ---------------------------------------------------------------------
-- 2. ROW SECURITY for the new tables
-- ---------------------------------------------------------------------
drop policy if exists files_select on stored_files;
create policy files_select on stored_files for select using (
  (entity_type = 'approval_revision'
     and exists (select 1 from approval_revisions r where r.id = entity_id and r.project_id = stored_files.project_id))
  or (entity_type = 'payment_transaction'
     and exists (select 1 from payment_transactions t where t.id = entity_id and t.project_id = stored_files.project_id
                   and (can_manage_project(t.project_id) or (t.receipt_published and t.voided_at is null))))
);
drop policy if exists files_insert on stored_files;
create policy files_insert on stored_files for insert with check (
  uploaded_by = auth.uid() and can_manage_project(project_id) and (
    (entity_type = 'approval_revision'
       and exists (select 1 from approval_revisions r where r.id = entity_id and r.project_id = stored_files.project_id and r.status = 'draft'))
    or (entity_type = 'payment_transaction'
       and exists (select 1 from payment_transactions t where t.id = entity_id and t.project_id = stored_files.project_id and t.voided_at is null)))
);
-- Only files of a draft revision can be removed. Sent designs and receipts stay.
drop policy if exists files_delete on stored_files;
create policy files_delete on stored_files for delete using (
  can_manage_project(project_id) and entity_type = 'approval_revision'
  and exists (select 1 from approval_revisions r where r.id = entity_id and r.status = 'draft')
);

drop policy if exists apprmsg_select on approval_messages;
create policy apprmsg_select on approval_messages for select using (
  is_project_staff(project_id) or is_project_client(project_id)
);
drop policy if exists apprmsg_insert on approval_messages;
create policy apprmsg_insert on approval_messages for insert with check (
  author_id = auth.uid() and can_manage_project(project_id)
);

drop policy if exists remruns_select on reminder_runs;
create policy remruns_select on reminder_runs for select using (is_management());

-- Files and messages can't be edited once saved.
drop trigger if exists trg_stored_files_immutable on stored_files;
create trigger trg_stored_files_immutable before update on stored_files
  for each row execute function forbid_change();
drop trigger if exists trg_approval_messages_immutable on approval_messages;
create trigger trg_approval_messages_immutable before update or delete on approval_messages
  for each row execute function forbid_change();

drop trigger if exists trg_approval_messages_audit on approval_messages;
create trigger trg_approval_messages_audit after insert or update or delete on approval_messages
  for each row execute function write_audit_log();

-- ---------------------------------------------------------------------
-- 3. SMALL HELPERS
-- ---------------------------------------------------------------------
-- ₹ with Indian grouping, e.g. 15000000 paise -> ₹1,50,000
create or replace function fmt_inr(p bigint) returns text
language plpgsql immutable as $$
declare s text := round(coalesce(p, 0) / 100.0)::bigint::text; head text; tail text;
begin
  if length(s) <= 3 then return '₹' || s; end if;
  tail := right(s, 3);
  head := left(s, length(s) - 3);
  head := regexp_replace(head, '(\d)(?=(\d\d)+$)', '\1,', 'g');
  return '₹' || head || ',' || tail;
end $$;

create or replace function fmt_day(d date) returns text
language sql immutable as $$ select to_char(d, 'FMDD Mon YYYY') $$;

-- People to tell about something on a project
create or replace function project_client_ids(pid uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct m.profile_id from project_members m
    join profiles pr on pr.id = m.profile_id and pr.is_active and pr.deleted_at is null
   where m.project_id = pid and m.member_role = 'client' and m.removed_at is null
$$;

-- The project's managers; if none is assigned, the owners / admins.
create or replace function project_manager_ids(pid uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct m.profile_id from project_members m
    join profiles pr on pr.id = m.profile_id and pr.is_active and pr.deleted_at is null
   where m.project_id = pid and m.member_role = 'project_manager' and m.removed_at is null
  union
  select pr.id from profiles pr
    join projects p on p.id = pid and p.organisation_id = pr.organisation_id
   where pr.role in ('owner', 'admin') and pr.is_active and pr.deleted_at is null
     and not exists (select 1 from project_members m2 join profiles x on x.id = m2.profile_id and x.is_active
                      where m2.project_id = pid and m2.member_role = 'project_manager' and m2.removed_at is null)
$$;

-- Adds one in-app notification. A repeat with the same dedupe key is ignored,
-- so a reminder can never be sent twice.
create or replace function notify(
  p_recipient uuid, p_project uuid, p_event text, p_title text, p_body text, p_link text,
  p_entity_type text, p_entity_id uuid, p_critical boolean, p_dedupe text
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_org uuid; n integer;
begin
  select organisation_id into v_org from profiles where id = p_recipient;
  if v_org is null then return 0; end if;
  insert into notifications (organisation_id, recipient_id, project_id, event_type, title, body, link_path,
                             entity_type, entity_id, is_critical, dedupe_key)
  values (v_org, p_recipient, p_project, p_event, p_title, p_body, p_link, p_entity_type, p_entity_id, p_critical, p_dedupe)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 4. APPROVAL RULES
-- Direct edits by a signed-in person are limited; the controlled steps
-- (create, send to client, new revision, reply) go through the functions
-- below, which check permissions themselves.
-- ---------------------------------------------------------------------
create or replace function guard_approval() returns trigger
language plpgsql as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'Create approvals from the Approvals screen' using errcode = '42501';
  end if;
  if (new.status, new.current_revision_no, new.project_id, new.created_by)
     is distinct from (old.status, old.current_revision_no, old.project_id, old.created_by) then
    raise exception 'Approval status changes only through the approval workflow' using errcode = '42501';
  end if;
  if old.current_revision_no > 0 and (new.title, new.area, new.category, new.item_name)
     is distinct from (old.title, old.area, old.category, old.item_name) then
    raise exception 'The title, area, category and item are locked once sent to the client' using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at and old.current_revision_no > 0 then
    raise exception 'An approval that was sent to the client cannot be deleted' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_approvals_guard on approvals;
create trigger trg_approvals_guard before insert or update on approvals
  for each row execute function guard_approval();

create or replace function guard_approval_revision_workflow() returns trigger
language plpgsql as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'Create revisions from the Approvals screen' using errcode = '42501';
  end if;
  if (new.status, new.published_at, new.published_by, new.decided_at)
     is distinct from (old.status, old.published_at, old.published_by, old.decided_at) then
    raise exception 'Revision status changes only through the approval workflow' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_approval_revisions_workflow on approval_revisions;
create trigger trg_approval_revisions_workflow before insert or update on approval_revisions
  for each row execute function guard_approval_revision_workflow();

-- Create an approval with its first (draft) revision
create or replace function approval_create(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_pid uuid := nullif(payload ->> 'project_id', '')::uuid; v_id uuid;
begin
  if v_pid is null or not can_manage_project(v_pid) then
    raise exception 'Only the project''s manager can create approvals' using errcode = '42501';
  end if;
  if length(trim(coalesce(payload ->> 'title', ''))) = 0 or length(trim(coalesce(payload ->> 'area', ''))) = 0
     or length(trim(coalesce(payload ->> 'category', ''))) = 0 or length(trim(coalesce(payload ->> 'item_name', ''))) = 0 then
    raise exception 'Title, area, category and item are required';
  end if;
  insert into approvals (project_id, title, area, category, item_name, status, current_revision_no, deadline, created_by)
  values (v_pid, trim(payload ->> 'title'), trim(payload ->> 'area'), trim(payload ->> 'category'), trim(payload ->> 'item_name'),
          'draft', 0, nullif(payload ->> 'deadline', '')::date, auth.uid())
  returning id into v_id;
  insert into approval_revisions (approval_id, project_id, revision_no, status, created_by)
  values (v_id, v_pid, 1, 'draft', auth.uid());
  return v_id;
end $$;

-- Send the draft revision to the client
create or replace function approval_publish(p_approval_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare a approvals; r approval_revisions; v_rec uuid;
begin
  select * into a from approvals where id = p_approval_id and deleted_at is null for update;
  if a.id is null or not can_manage_project(a.project_id) then
    raise exception 'Only the project''s manager can send approvals' using errcode = '42501';
  end if;
  select * into r from approval_revisions where approval_id = a.id and status = 'draft'
   order by revision_no desc limit 1 for update;
  if r.id is null then raise exception 'There is no draft revision to send'; end if;
  if a.deadline is null then raise exception 'Set a decision deadline before sending this to the client'; end if;
  if a.deadline < today_ist() then raise exception 'The deadline is in the past. Choose a new deadline first'; end if;
  if length(trim(coalesce(r.client_description, ''))) = 0 then
    raise exception 'Write the description the client will read before sending';
  end if;
  if not exists (select project_client_ids(a.project_id)) then
    raise exception 'This project has no client login yet. Link the client on the project page first';
  end if;

  update approval_revisions set status = 'superseded'
   where approval_id = a.id and id <> r.id and status in ('published', 'changes_requested', 'query_raised');
  update approval_revisions set status = 'published', published_at = now(), published_by = auth.uid() where id = r.id;
  update approvals set status = 'pending', current_revision_no = r.revision_no, last_reminder_at = null where id = a.id;

  for v_rec in select project_client_ids(a.project_id) loop
    perform notify(v_rec, a.project_id, 'approval.requested',
      case when r.revision_no = 1 then 'Your approval is needed: ' else 'Revised design for your approval: ' end || a.title,
      a.area || ' · ' || a.item_name || '. Please review and respond by ' || fmt_day(a.deadline) || '.',
      '/c/approvals/' || a.id, 'approval', a.id, true, 'appr-pub:' || r.id);
  end loop;
  return r.id;
end $$;

-- Start a new revision (copies the latest one so only the changes need editing)
create or replace function approval_new_revision(p_approval_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare a approvals; last approval_revisions; v_id uuid;
begin
  select * into a from approvals where id = p_approval_id and deleted_at is null for update;
  if a.id is null or not can_manage_project(a.project_id) then
    raise exception 'Only the project''s manager can revise approvals' using errcode = '42501';
  end if;
  select id into v_id from approval_revisions where approval_id = a.id and status = 'draft' limit 1;
  if v_id is not null then return v_id; end if;
  select * into last from approval_revisions where approval_id = a.id order by revision_no desc limit 1;
  insert into approval_revisions (approval_id, project_id, revision_no, status, client_description, material_brand,
    material_type, specifications, colour, finish, dimensions, quantity, quantity_unit, commercial_impact_paise, files, created_by)
  values (a.id, a.project_id, coalesce(last.revision_no, 0) + 1, 'draft', last.client_description, last.material_brand,
    last.material_type, last.specifications, last.colour, last.finish, last.dimensions, last.quantity, last.quantity_unit,
    last.commercial_impact_paise, coalesce(last.files, '[]'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Answer a client's query (puts the approval back in the client's hands)
create or replace function approval_reply(p_approval_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a approvals; r approval_revisions; v_id uuid; v_rec uuid;
begin
  select * into a from approvals where id = p_approval_id and deleted_at is null for update;
  if a.id is null or not can_manage_project(a.project_id) then
    raise exception 'Only the project''s manager can reply' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write your reply first'; end if;
  if a.current_revision_no = 0 then raise exception 'This approval has not been sent to the client yet'; end if;
  select * into r from approval_revisions where approval_id = a.id and revision_no = a.current_revision_no;
  insert into approval_messages (approval_id, revision_id, project_id, body, author_id)
  values (a.id, r.id, a.project_id, trim(p_body), auth.uid()) returning id into v_id;
  if a.status = 'query_raised' and r.status = 'query_raised' then
    update approval_revisions set status = 'published' where id = r.id;
    update approvals set status = 'pending' where id = a.id;
  end if;
  for v_rec in select project_client_ids(a.project_id) loop
    perform notify(v_rec, a.project_id, 'approval.reply', 'Reply on ' || a.title, left(trim(p_body), 200),
      '/c/approvals/' || a.id, 'approval', a.id, false, null);
  end loop;
  return v_id;
end $$;

-- Tell the managers when the client responds
create or replace function notify_approval_response() returns trigger
language plpgsql security definer set search_path = public as $$
declare a approvals; v_rec uuid; v_who text;
begin
  select * into a from approvals where id = new.approval_id;
  select full_name into v_who from profiles where id = new.responded_by;
  for v_rec in select project_manager_ids(a.project_id) loop
    perform notify(v_rec, a.project_id,
      case new.action when 'approve' then 'approval.approved' when 'request_changes' then 'approval.changes_requested' else 'approval.query' end,
      case new.action when 'approve' then 'Approved: ' when 'request_changes' then 'Changes requested: ' else 'Client query: ' end || a.title,
      coalesce(v_who, 'Client') || case new.action when 'approve' then ' approved revision ' || a.current_revision_no || '.'
                                    else ': ' || left(coalesce(new.comment, ''), 180) end,
      '/m/approvals/' || a.id, 'approval', a.id, new.action <> 'approve', null);
  end loop;
  return new;
end $$;
drop trigger if exists trg_approval_responses_notify on approval_responses;
create trigger trg_approval_responses_notify after insert on approval_responses
  for each row execute function notify_approval_response();

-- ---------------------------------------------------------------------
-- 5. PAYMENT RULES
-- ---------------------------------------------------------------------
create or replace function guard_payment_milestone() returns trigger
language plpgsql as $$
declare v_received bigint;
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.status not in ('upcoming', 'on_hold') then
    raise exception 'Payment status is worked out from recorded payments. Only "On hold" can be set by hand' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then return new; end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'A milestone cannot move to another project' using errcode = '42501';
  end if;
  if new.due_date is distinct from old.due_date then
    raise exception 'Use "Change due date" so the reason is recorded' using errcode = '42501';
  end if;
  select coalesce(sum(amount_paise), 0) into v_received
    from payment_transactions where milestone_id = old.id and voided_at is null;
  if new.amount_paise is distinct from old.amount_paise and new.amount_paise < v_received then
    raise exception 'The amount cannot be less than the % already received', fmt_inr(v_received);
  end if;
  if new.deleted_at is not null and old.deleted_at is null and v_received > 0 then
    raise exception 'This milestone has recorded payments, so it cannot be removed. Void the payments first';
  end if;
  return new;
end $$;
drop trigger if exists trg_payment_milestones_guard on payment_milestones;
create trigger trg_payment_milestones_guard before insert or update on payment_milestones
  for each row execute function guard_payment_milestone();

-- Recording a payment: always against the milestone's own project, never in
-- the future, never more than what is outstanding.
create or replace function check_payment_transaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare m payment_milestones; v_received bigint;
begin
  select * into m from payment_milestones where id = new.milestone_id for update;
  if m.id is null or m.deleted_at is not null then raise exception 'Payment milestone not found'; end if;
  new.project_id := m.project_id;
  new.voided_at := null; new.voided_by := null; new.void_reason := null;
  if new.received_on > today_ist() then raise exception 'The received date cannot be in the future'; end if;
  select coalesce(sum(amount_paise), 0) into v_received
    from payment_transactions where milestone_id = m.id and voided_at is null;
  if new.amount_paise > m.amount_paise - v_received then
    raise exception 'This is more than the % still due on "%". Record the extra against the next milestone',
      fmt_inr(m.amount_paise - v_received), m.name;
  end if;
  return new;
end $$;
drop trigger if exists trg_payment_transactions_check on payment_transactions;
create trigger trg_payment_transactions_check before insert on payment_transactions
  for each row execute function check_payment_transaction();

-- After recording: only voiding (with a reason) and the receipt can change.
create or replace function guard_payment_transaction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted. Void the entry with a reason instead.' using errcode = '42501';
  end if;
  if (new.milestone_id, new.project_id, new.amount_paise, new.received_on, new.recorded_by, new.created_at, new.method, new.reference)
     is distinct from (old.milestone_id, old.project_id, old.amount_paise, old.received_on, old.recorded_by, old.created_at, old.method, old.reference) then
    raise exception 'A recorded payment cannot be edited. Void it and record a new one.' using errcode = '42501';
  end if;
  if old.voided_at is not null and (new.voided_at, new.voided_by, new.void_reason, new.receipt_path, new.receipt_published)
     is distinct from (old.voided_at, old.voided_by, old.void_reason, old.receipt_path, old.receipt_published) then
    raise exception 'A voided payment cannot be changed or restored' using errcode = '42501';
  end if;
  if new.voided_at is not null and old.voided_at is null then
    if length(trim(coalesce(new.void_reason, ''))) = 0 then
      raise exception 'Give a reason for voiding this payment';
    end if;
    if auth.uid() is not null then new.voided_by := auth.uid(); end if;
    new.voided_at := now();
    new.receipt_published := false;
  end if;
  if new.receipt_published and new.receipt_path is null then
    raise exception 'Upload the receipt before sharing it with the client';
  end if;
  return new;
end $$;

-- Tell the client a payment was received
create or replace function notify_payment_recorded() returns trigger
language plpgsql security definer set search_path = public as $$
declare m payment_milestones; v_rec uuid;
begin
  select * into m from payment_milestones where id = new.milestone_id;
  for v_rec in select project_client_ids(new.project_id) loop
    perform notify(v_rec, new.project_id, 'payment.recorded', 'Payment received: ' || fmt_inr(new.amount_paise),
      'Thank you. We have recorded ' || fmt_inr(new.amount_paise) || ' towards "' || m.name || '", received on ' || fmt_day(new.received_on) || '.',
      '/c/payments', 'payment_transaction', new.id, true, 'pay-rec:' || new.id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_payment_transactions_notify on payment_transactions;
create trigger trg_payment_transactions_notify after insert on payment_transactions
  for each row execute function notify_payment_recorded();

-- Change a due date. The old date, new date, reason and person are kept forever.
create or replace function payment_change_due_date(p_milestone_id uuid, p_new_date date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m payment_milestones; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_rec uuid;
begin
  select * into m from payment_milestones where id = p_milestone_id and deleted_at is null for update;
  if m.id is null or not can_manage_project(m.project_id) then
    raise exception 'Only the project''s manager can change due dates' using errcode = '42501';
  end if;
  if p_new_date is not distinct from m.due_date then raise exception 'That is already the due date'; end if;
  if m.due_date is not null and v_reason is null then raise exception 'Give a reason for changing the due date'; end if;
  insert into payment_due_date_changes (milestone_id, old_due_date, new_due_date, reason, changed_by)
  values (m.id, m.due_date, p_new_date, coalesce(v_reason, 'Due date set'), auth.uid());
  update payment_milestones set due_date = p_new_date where id = m.id;
  if m.due_date is not null then
    for v_rec in select project_client_ids(m.project_id) loop
      perform notify(v_rec, m.project_id, 'payment.due_date_changed', 'Payment date updated: ' || m.name,
        'The due date for "' || m.name || '" is now ' || coalesce(fmt_day(p_new_date), 'to be decided') || '.',
        '/c/payments', 'payment_milestone', m.id, false, null);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. DAILY REMINDERS
-- Payments: 7 and 3 days before, on the due date, 1 day after, then every
-- 3 days (up to the limit set on the Payments page; default 5 repeats).
-- Approvals: 2 days before the deadline, on the day, then the same
-- overdue pattern. Each reminder is sent once only (dedupe key).
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

  insert into reminder_runs (run_for, notifications_created, triggered_by) values (v_today, v_total, auth.uid());
  return v_total;
end $$;

-- Setup self-check: is the daily reminder job switched on? (used by /status)
create or replace function app_reminder_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_installed boolean; v_job boolean := false; v_schedule text; v_last timestamptz; v_count integer;
begin
  v_installed := exists (select 1 from pg_extension where extname = 'pg_cron');
  if v_installed then
    execute $q$select exists (select 1 from cron.job where jobname = 'meraghar-daily-reminders' and active),
                      (select schedule from cron.job where jobname = 'meraghar-daily-reminders' limit 1)$q$
      into v_job, v_schedule;
  end if;
  select created_at, notifications_created into v_last, v_count from reminder_runs order by created_at desc limit 1;
  return jsonb_build_object('cron_installed', v_installed, 'job_scheduled', coalesce(v_job, false),
                            'schedule', v_schedule, 'last_run', v_last, 'last_count', v_count);
end $$;

-- ---------------------------------------------------------------------
-- 7. WHO MAY CALL WHAT
-- ---------------------------------------------------------------------
revoke all on function notify(uuid, uuid, text, text, text, text, text, uuid, boolean, text) from public, anon, authenticated;
revoke all on function project_client_ids(uuid) from public, anon, authenticated;
revoke all on function project_manager_ids(uuid) from public, anon, authenticated;
revoke all on function approval_create(jsonb) from public, anon;
revoke all on function approval_publish(uuid) from public, anon;
revoke all on function approval_new_revision(uuid) from public, anon;
revoke all on function approval_reply(uuid, text) from public, anon;
revoke all on function payment_change_due_date(uuid, date, text) from public, anon;
revoke all on function run_reminders(date) from public, anon;
revoke all on function app_reminder_status() from public, anon;
grant execute on function approval_create(jsonb), approval_publish(uuid), approval_new_revision(uuid),
  approval_reply(uuid, text), payment_change_due_date(uuid, date, text), run_reminders(date) to authenticated;
grant execute on function app_reminder_status(), run_reminders(date) to service_role;

-- ---------------------------------------------------------------------
-- 8. SWITCH ON THE DAILY REMINDER JOB (8:00 AM India = 02:30 UTC)
-- Uses Supabase Cron (pg_cron). If it can't be switched on here, the rest
-- of this file still works and /status will say what to do.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'Supabase Cron could not be enabled automatically: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute $q$select cron.schedule('meraghar-daily-reminders', '30 2 * * *', 'select public.run_reminders()')$q$;
    exception when others then
      raise notice 'Could not schedule the daily reminder job: %', sqlerrm;
    end;
  end if;
end $$;
