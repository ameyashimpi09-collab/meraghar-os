-- =====================================================================
-- MERAGHAR OS — QUOTATIONS (read from the quotation PDF)
-- Management uploads the quotation PDF on a project. The app reads the
-- line items and grand total, management checks them, and the confirmed
-- quotation becomes the project's quotation value. Quotations are
-- MANAGEMENT-ONLY: clients and employees never see them here.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
-- draft     = just read from the PDF, waiting for management to check it
-- confirmed = the project's current quotation (one per project)
-- replaced  = an older quotation, kept for history
create table if not exists project_quotations (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  status             text not null default 'draft' check (status in ('draft', 'confirmed', 'replaced')),
  title              text,
  quote_number       text,
  quote_date         date,
  client_name        text,
  subtotal_paise     bigint check (subtotal_paise is null or subtotal_paise >= 0),
  discount_paise     bigint check (discount_paise is null or discount_paise >= 0),
  tax_paise          bigint check (tax_paise is null or tax_paise >= 0),
  tax_label          text,
  grand_total_paise  bigint not null default 0 check (grand_total_paise >= 0),
  file_id            uuid,
  file_name          text,
  read_notes         text,             -- what the reader was unsure about
  read_by            text,             -- 'ai' or 'manual'
  created_by         uuid references profiles(id),
  confirmed_by       uuid references profiles(id),
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status = 'draft' or (confirmed_by is not null and confirmed_at is not null))
);
create index if not exists project_quotations_project_idx on project_quotations (project_id, created_at desc);
create unique index if not exists project_quotations_one_current
  on project_quotations (project_id) where status = 'confirmed';

create table if not exists project_quotation_items (
  id             uuid primary key default gen_random_uuid(),
  quotation_id   uuid not null references project_quotations(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  sort_order     integer not null default 0,
  section        text,                 -- room / area heading on the quotation
  description    text not null check (length(trim(description)) > 0),
  unit           text,
  quantity       numeric(14,3),
  rate_paise     bigint,
  amount_paise   bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists project_quotation_items_q_idx on project_quotation_items (quotation_id, sort_order);

do $$
declare t text;
begin
  foreach t in array array['project_quotations', 'project_quotation_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop trigger if exists trg_%s_updated_at on %I', t, t);
    execute format('create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
drop trigger if exists trg_project_quotations_audit on project_quotations;
create trigger trg_project_quotations_audit after insert or update or delete on project_quotations
  for each row execute function write_audit_log();

grant select, insert, update, delete on project_quotations, project_quotation_items to authenticated;
grant all on project_quotations, project_quotation_items to service_role;
revoke all on project_quotations, project_quotation_items from anon;

-- ---------------------------------------------------------------------
-- 2. ROW SECURITY: project manager of the project, owner and admin only
-- ---------------------------------------------------------------------
drop policy if exists quot_select on project_quotations;
create policy quot_select on project_quotations for select using (can_manage_project(project_id));
drop policy if exists quot_insert on project_quotations;
create policy quot_insert on project_quotations for insert
  with check (can_manage_project(project_id) and created_by = auth.uid() and status = 'draft');
drop policy if exists quot_update on project_quotations;
create policy quot_update on project_quotations for update
  using (can_manage_project(project_id)) with check (can_manage_project(project_id));
drop policy if exists quot_delete on project_quotations;
create policy quot_delete on project_quotations for delete using (can_manage_project(project_id) and status = 'draft');

drop policy if exists quotitem_select on project_quotation_items;
create policy quotitem_select on project_quotation_items for select using (can_manage_project(project_id));
drop policy if exists quotitem_write on project_quotation_items;
create policy quotitem_write on project_quotation_items for all
  using (can_manage_project(project_id))
  with check (can_manage_project(project_id)
              and exists (select 1 from project_quotations q where q.id = quotation_id and q.project_id = project_quotation_items.project_id));

-- ---------------------------------------------------------------------
-- 3. RULES: a confirmed quotation is a record and cannot be edited.
--    Only a draft can be changed; confirmed -> replaced happens when a
--    newer quotation is confirmed.
-- ---------------------------------------------------------------------
create or replace function quotation_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id then
      raise exception 'A quotation cannot be moved to another project.';
    end if;
    if old.status = 'replaced' then
      raise exception 'This quotation has been replaced and is kept as history. It cannot be changed.';
    end if;
    if old.status = 'confirmed' then
      if new.status <> 'replaced' or (to_jsonb(new) - array['status', 'updated_at']) <> (to_jsonb(old) - array['status', 'updated_at']) then
        raise exception 'A confirmed quotation cannot be edited. Upload the revised quotation instead.';
      end if;
    end if;
    if old.status = 'draft' and new.status = 'replaced' then
      raise exception 'Only a confirmed quotation can be replaced.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_project_quotations_guard on project_quotations;
create trigger trg_project_quotations_guard before update on project_quotations
  for each row execute function quotation_guard();

create or replace function quotation_item_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from project_quotations where id = coalesce(new.quotation_id, old.quotation_id);
  -- Deleting the whole (draft) quotation removes its lines too.
  if v_status is null then return coalesce(new, old); end if;
  if v_status <> 'draft' then
    raise exception 'The lines of a confirmed quotation cannot be changed. Upload the revised quotation instead.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_project_quotation_items_guard on project_quotation_items;
create trigger trg_project_quotation_items_guard before insert or update or delete on project_quotation_items
  for each row execute function quotation_item_guard();

-- Confirm a checked draft: it becomes the project's quotation, and the
-- previous one is kept as history. One step: all or nothing.
create or replace function quotation_confirm(qid uuid) returns void
language plpgsql set search_path = public as $$
declare q project_quotations;
begin
  select * into q from project_quotations where id = qid for update;
  if q.id is null or not can_manage_project(q.project_id) then
    raise exception 'Only this project''s manager or an owner/admin can confirm its quotation.' using errcode = '42501';
  end if;
  if q.status <> 'draft' then
    raise exception 'This quotation is already confirmed.';
  end if;
  if q.grand_total_paise <= 0 then
    raise exception 'Enter the grand total before confirming.';
  end if;
  update project_quotations set status = 'replaced' where project_id = q.project_id and status = 'confirmed';
  update project_quotations set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = qid;
end $$;
revoke all on function quotation_confirm(uuid) from public, anon;
grant execute on function quotation_confirm(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. THE QUOTATION PDF itself (stored privately, like other files)
-- ---------------------------------------------------------------------
alter table stored_files drop constraint if exists stored_files_entity_type_check;
alter table stored_files add constraint stored_files_entity_type_check
  check (entity_type in ('approval_revision', 'payment_transaction', 'task', 'quotation'));

drop policy if exists files_select on stored_files;
create policy files_select on stored_files for select using (
  (entity_type = 'approval_revision'
     and exists (select 1 from approval_revisions r where r.id = entity_id and r.project_id = stored_files.project_id))
  or (entity_type = 'payment_transaction'
     and exists (select 1 from payment_transactions t where t.id = entity_id and t.project_id = stored_files.project_id
                   and (can_manage_project(t.project_id) or (t.receipt_published and t.voided_at is null))))
  or (entity_type = 'task'
     and exists (select 1 from tasks t where t.id = entity_id and t.project_id = stored_files.project_id and t.deleted_at is null))
  or (entity_type = 'quotation' and can_manage_project(project_id))
);
drop policy if exists files_insert on stored_files;
create policy files_insert on stored_files for insert with check (
  uploaded_by = auth.uid() and (
    (can_manage_project(project_id) and (
      (entity_type = 'approval_revision'
         and exists (select 1 from approval_revisions r where r.id = entity_id and r.project_id = stored_files.project_id and r.status = 'draft'))
      or (entity_type = 'payment_transaction'
         and exists (select 1 from payment_transactions t where t.id = entity_id and t.project_id = stored_files.project_id and t.voided_at is null))
      or entity_type = 'quotation'))
    or (entity_type = 'task' and is_project_staff(project_id)
        and exists (select 1 from tasks t where t.id = entity_id and t.project_id = stored_files.project_id and t.deleted_at is null))
  )
);
-- Files of a draft revision, or of a quotation that was discarded, can be removed.
drop policy if exists files_delete on stored_files;
create policy files_delete on stored_files for delete using (
  can_manage_project(project_id) and (
    (entity_type = 'approval_revision'
      and exists (select 1 from approval_revisions r where r.id = entity_id and r.status = 'draft'))
    or (entity_type = 'quotation'
      and not exists (select 1 from project_quotations q where q.id = entity_id and q.status <> 'draft'))
  )
);
