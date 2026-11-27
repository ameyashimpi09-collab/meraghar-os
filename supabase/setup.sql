-- MERAGHAR OS — DATABASE SETUP (run once in Supabase → SQL Editor). Generated from supabase/migrations.

-- >>> supabase/migrations/0001_schema.sql
-- =====================================================================
-- MERAGHAR OS — CORE SCHEMA (all releases)
-- The full data model is created up front so that Releases 2–6 only add
-- screens and logic, not database redesigns.
--
-- Conventions
--   * UUID primary keys, created_at / updated_at on every table
--   * deleted_at = soft delete (rows are hidden, never destroyed)
--   * Money is stored as whole paise in bigint (₹1 = 100 paise)
--   * Timestamps are timestamptz (UTC); calendar dates are `date`
--   * Every business row belongs to an organisation (directly or via project)
-- =====================================================================

-- ---------- Enumerations ----------------------------------------------
create type app_role as enum (
  'owner', 'admin', 'project_manager', 'designer', 'site_supervisor', 'execution', 'client'
);
create type project_member_role as enum (
  'project_manager', 'designer', 'site_supervisor', 'execution', 'client'
);
create type project_status as enum ('draft', 'active', 'on_hold', 'completed', 'cancelled');
create type possession_status as enum (
  'awaiting_possession', 'possession_received', 'occupied', 'under_renovation'
);
create type contact_method as enum ('phone', 'whatsapp', 'email', 'in_app');
create type scope_status as enum ('not_started', 'in_progress', 'completed', 'on_hold');
create type document_type as enum (
  'floor_plan', 'site_measurement', 'design_presentation', 'render_3d', 'quotation',
  'work_order', 'electrical_layout', 'plumbing_layout', 'material_spec', 'other'
);
create type stage_status as enum ('not_started', 'in_progress', 'completed', 'on_hold', 'delayed', 'skipped');
create type delay_type as enum ('company', 'client_approval', 'client_purchase', 'vendor', 'site_builder');
create type priority_level as enum ('critical', 'high', 'medium', 'low');
create type task_status as enum (
  'not_started', 'in_progress', 'waiting_client', 'waiting_vendor', 'blocked', 'completed', 'cancelled'
);
create type approval_status as enum (
  'draft', 'pending', 'approved', 'changes_requested', 'query_raised', 'withdrawn'
);
create type revision_status as enum (
  'draft', 'published', 'approved', 'changes_requested', 'query_raised', 'superseded'
);
create type approval_action as enum ('approve', 'request_changes', 'raise_query');
create type payment_status as enum ('upcoming', 'due', 'partially_paid', 'paid', 'overdue', 'on_hold');
create type site_update_status as enum ('draft', 'pending_review', 'published', 'archived');
create type media_type as enum ('image', 'video', 'document');
create type purchase_status as enum (
  'not_yet_required', 'purchase_required', 'client_informed', 'purchased',
  'delivery_scheduled', 'delivered', 'installed', 'delayed', 'cancelled'
);
create type purchase_responsibility as enum ('client', 'company', 'shared');
create type measurement_unit as enum ('mm', 'cm', 'm', 'in');
create type snag_category as enum (
  'design', 'workmanship', 'electrical', 'plumbing', 'carpentry', 'material', 'damage', 'cleaning', 'other'
);
create type snag_status as enum (
  'open', 'under_review', 'assigned', 'in_progress', 'awaiting_client_confirmation', 'resolved', 'reopened'
);
create type note_visibility as enum ('staff', 'management');

-- ---------- Shared trigger: keep updated_at current -------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- 1. ORGANISATIONS
-- =====================================================================
create table organisations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  legal_name            text,
  slug                  text not null unique,
  timezone              text not null default 'Asia/Kolkata',
  currency              char(3) not null default 'INR',
  measurement_system    text not null default 'metric' check (measurement_system in ('metric', 'imperial')),
  project_code_prefix   text not null default 'MG',
  next_project_seq      integer not null default 1,
  settings              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

-- =====================================================================
-- 2. PROFILES  (one per login; id = auth.users.id)
-- =====================================================================
create table profiles (
  id                        uuid primary key references auth.users(id) on delete cascade,
  organisation_id           uuid not null references organisations(id),
  role                      app_role not null,
  full_name                 text not null check (length(trim(full_name)) > 0),
  email                     text not null,
  phone                     text,
  designation               text,
  secondary_contact_name    text,
  secondary_contact_phone   text,
  preferred_contact_method  contact_method not null default 'phone',
  avatar_path               text,
  is_active                 boolean not null default true,
  created_by                uuid references profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);
create unique index profiles_org_email_uq on profiles (organisation_id, lower(email)) where deleted_at is null;
create index profiles_org_role_idx on profiles (organisation_id, role) where deleted_at is null;

-- =====================================================================
-- 3. PROJECTS
-- =====================================================================
create table projects (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references organisations(id),
  project_code                text not null,
  name                        text not null check (length(trim(name)) > 0),
  status                      project_status not null default 'active',
  client_id                   uuid references profiles(id),
  address_line                text,
  building_society            text,
  flat_number                 text,
  city                        text not null default 'Pune',
  state                       text default 'Maharashtra',
  pincode                     text,
  property_config             text,
  carpet_area_sqft            numeric(10,2) check (carpet_area_sqft is null or carpet_area_sqft > 0),
  possession_status           possession_status,
  expected_start_date         date,
  target_handover_date        date,
  actual_handover_date        date,
  description                 text,
  site_update_frequency_days  smallint not null default 7 check (site_update_frequency_days between 1 and 90),
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  unique (organisation_id, project_code),
  check (target_handover_date is null or expected_start_date is null or target_handover_date >= expected_start_date)
);
create index projects_org_status_idx on projects (organisation_id, status) where deleted_at is null;
create index projects_client_idx on projects (client_id) where deleted_at is null;
create index projects_handover_idx on projects (target_handover_date) where deleted_at is null;

-- =====================================================================
-- 4. PROJECT MEMBERS  (who is assigned to which project, and as what)
-- =====================================================================
create table project_members (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  profile_id    uuid not null references profiles(id),
  member_role   project_member_role not null,
  is_primary    boolean not null default false,
  added_by      uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  removed_at    timestamptz
);
create unique index project_members_active_uq
  on project_members (project_id, profile_id, member_role) where removed_at is null;
create index project_members_profile_idx on project_members (profile_id) where removed_at is null;
create index project_members_project_idx on project_members (project_id) where removed_at is null;

-- =====================================================================
-- Configurable lists (scope categories, stage + task templates)
-- =====================================================================
create table scope_categories (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  name             text not null,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, name)
);

create table stage_templates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  name             text not null,
  description      text,
  sort_order       integer not null default 0,
  default_duration_days smallint,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, name)
);

create table task_templates (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id),
  stage_template_id uuid references stage_templates(id),
  title             text not null,
  description       text,
  default_priority  priority_level not null default 'medium',
  default_assignee_role project_member_role,
  offset_days       smallint not null default 0,
  duration_days     smallint not null default 1,
  requires_review   boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- =====================================================================
-- 5. PROJECT SCOPE ITEMS
-- =====================================================================
create table project_scope_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  category      text not null,
  is_included   boolean not null default true,
  description   text,
  status        scope_status not null default 'not_started',
  sort_order    integer not null default 0,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index project_scope_items_project_idx on project_scope_items (project_id) where deleted_at is null;

-- Estimated cost is MANAGEMENT-ONLY, so it lives in its own table with
-- stricter row security instead of a column clients/employees could read.
create table project_scope_costs (
  scope_item_id         uuid primary key references project_scope_items(id) on delete cascade,
  project_id            uuid not null references projects(id) on delete cascade,
  estimated_cost_paise  bigint not null default 0 check (estimated_cost_paise >= 0),
  updated_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index project_scope_costs_project_idx on project_scope_costs (project_id);

-- =====================================================================
-- 6. PROJECT DOCUMENTS
-- =====================================================================
create table project_documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  scope_item_id   uuid references project_scope_items(id),
  doc_type        document_type not null default 'other',
  title           text not null,
  description     text,
  storage_path    text not null,           -- path inside the private bucket
  file_name       text not null,
  mime_type       text,
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  version         integer not null default 1,
  client_visible  boolean not null default false,
  uploaded_by     uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index project_documents_project_idx on project_documents (project_id, doc_type) where deleted_at is null;

-- =====================================================================
-- 7–8. PROJECT STAGES + DEPENDENCIES  (Release 3)
-- =====================================================================
create table project_stages (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  template_id         uuid references stage_templates(id),
  name                text not null,
  description         text,
  sort_order          integer not null default 0,
  start_date          date,
  planned_end_date    date,
  actual_end_date     date,
  status              stage_status not null default 'not_started',
  completion_pct      smallint not null default 0 check (completion_pct between 0 and 100),
  assigned_team       text,
  delay_type          delay_type,
  delay_reason        text,
  client_description  text,                 -- client-facing progress text
  client_visible      boolean not null default true,
  is_milestone        boolean not null default false,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (planned_end_date is null or start_date is null or planned_end_date >= start_date)
);
create index project_stages_project_idx on project_stages (project_id, sort_order) where deleted_at is null;
create index project_stages_due_idx on project_stages (planned_end_date) where deleted_at is null and status not in ('completed', 'skipped');

create table stage_dependencies (
  id                   uuid primary key default gen_random_uuid(),
  stage_id             uuid not null references project_stages(id) on delete cascade,
  depends_on_stage_id  uuid not null references project_stages(id) on delete cascade,
  lag_days             smallint not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (stage_id, depends_on_stage_id),
  check (stage_id <> depends_on_stage_id)
);

-- =====================================================================
-- 12–14. APPROVALS (versioned; Release 2)
-- Declared before tasks so tasks can depend on approvals.
-- =====================================================================
create table approvals (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references projects(id) on delete cascade,
  title                 text not null,
  area                  text not null,           -- room / area, e.g. "Kitchen"
  category              text not null,           -- e.g. "Laminate"
  item_name             text not null,           -- e.g. "Shutter laminate"
  status                approval_status not null default 'draft',
  current_revision_no   integer not null default 0,
  deadline              date,
  last_reminder_at      timestamptz,
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index approvals_project_status_idx on approvals (project_id, status) where deleted_at is null;
create index approvals_deadline_idx on approvals (deadline) where deleted_at is null and status = 'pending';

create table approval_revisions (
  id                      uuid primary key default gen_random_uuid(),
  approval_id             uuid not null references approvals(id) on delete cascade,
  project_id              uuid not null references projects(id) on delete cascade,
  revision_no             integer not null check (revision_no >= 1),
  status                  revision_status not null default 'draft',
  client_description      text,
  material_brand          text,
  material_type           text,
  specifications          text,
  colour                  text,
  finish                  text,
  dimensions              text,
  quantity                numeric(12,2),
  quantity_unit           text,
  commercial_impact_paise bigint,
  files                   jsonb not null default '[]'::jsonb,  -- [{path,name,mime}]
  published_at            timestamptz,
  published_by            uuid references profiles(id),
  decided_at              timestamptz,
  created_by              uuid references profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (approval_id, revision_no)
);
create index approval_revisions_approval_idx on approval_revisions (approval_id, revision_no desc);

create table approval_responses (
  id            uuid primary key default gen_random_uuid(),
  approval_id   uuid not null references approvals(id) on delete cascade,
  revision_id   uuid not null references approval_revisions(id),
  project_id    uuid not null references projects(id) on delete cascade,
  action        approval_action not null,
  comment       text,
  responded_by  uuid not null references profiles(id),
  user_agent    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (action = 'approve' or length(trim(coalesce(comment, ''))) > 0)
);
create index approval_responses_approval_idx on approval_responses (approval_id, created_at);

-- =====================================================================
-- 19. PURCHASE REQUIREMENTS (client purchases; Release 4)
-- Declared before tasks so tasks can depend on purchases.
-- =====================================================================
create table purchase_requirements (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references projects(id) on delete cascade,
  item_name               text not null,
  category                text,
  area                    text,
  description             text,
  brand                   text,
  model                   text,
  reference_image_path    text,
  width                   numeric(10,2) check (width is null or width > 0),
  height                  numeric(10,2) check (height is null or height > 0),
  depth                   numeric(10,2) check (depth is null or depth > 0),
  unit                    measurement_unit not null default 'mm',
  -- Normalised millimetre values for consistent comparison/display
  width_mm  numeric(12,2) generated always as (width  * case unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 else 25.4 end) stored,
  height_mm numeric(12,2) generated always as (height * case unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 else 25.4 end) stored,
  depth_mm  numeric(12,2) generated always as (depth  * case unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 else 25.4 end) stored,
  technical_specs         text,
  quantity                integer not null default 1 check (quantity > 0),
  suggested_options       text,
  responsibility          purchase_responsibility not null default 'client',
  required_purchase_date  date,
  required_delivery_date  date,
  installation_date       date,
  depends_on_stage_id     uuid references project_stages(id),
  status                  purchase_status not null default 'not_yet_required',
  client_remarks          text,
  manager_remarks         text,
  created_by              uuid references profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
create index purchase_requirements_project_idx on purchase_requirements (project_id, status) where deleted_at is null;
create index purchase_requirements_due_idx on purchase_requirements (required_delivery_date) where deleted_at is null;

-- =====================================================================
-- 9–11. TASKS (Release 3)
-- =====================================================================
create table tasks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  stage_id         uuid references project_stages(id),
  template_id      uuid references task_templates(id),
  title            text not null check (length(trim(title)) > 0),
  description      text,
  assigned_to      uuid references profiles(id),
  created_by       uuid references profiles(id),
  reviewer_id      uuid references profiles(id),
  start_date       date,
  due_date         date,
  priority         priority_level not null default 'medium',
  status           task_status not null default 'not_started',
  blocked_reason   text,
  delay_type       delay_type,
  requires_review  boolean not null default false,
  reviewed_at      timestamptz,
  completed_at     timestamptz,
  completion_notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index tasks_project_status_idx on tasks (project_id, status) where deleted_at is null;
create index tasks_assignee_due_idx on tasks (assigned_to, due_date) where deleted_at is null;
create index tasks_due_open_idx on tasks (due_date) where deleted_at is null and status not in ('completed', 'cancelled');

-- A task can wait on another task, a client approval or a client purchase.
create table task_dependencies (
  id                        uuid primary key default gen_random_uuid(),
  task_id                   uuid not null references tasks(id) on delete cascade,
  depends_on_task_id        uuid references tasks(id) on delete cascade,
  depends_on_approval_id    uuid references approvals(id) on delete cascade,
  depends_on_purchase_id    uuid references purchase_requirements(id) on delete cascade,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (num_nonnulls(depends_on_task_id, depends_on_approval_id, depends_on_purchase_id) = 1),
  check (depends_on_task_id is null or depends_on_task_id <> task_id)
);
create index task_dependencies_task_idx on task_dependencies (task_id);
create index task_dependencies_approval_idx on task_dependencies (depends_on_approval_id);

create table task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index task_comments_task_idx on task_comments (task_id, created_at);

create table task_attachments (
  id                      uuid primary key default gen_random_uuid(),
  task_id                 uuid not null references tasks(id) on delete cascade,
  storage_path            text not null,
  file_name               text not null,
  mime_type               text,
  size_bytes              bigint,
  is_completion_evidence  boolean not null default false,
  uploaded_by             uuid references profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
create index task_attachments_task_idx on task_attachments (task_id);

-- =====================================================================
-- 15–16. PAYMENTS (tracking only, no gateway; Release 2)
-- =====================================================================
create table payment_milestones (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references projects(id) on delete cascade,
  name                   text not null,
  description            text,
  amount_paise           bigint not null check (amount_paise > 0),
  due_date               date,
  status                 payment_status not null default 'upcoming',
  sort_order             integer not null default 0,
  reminders_paused       boolean not null default false,
  reminder_pause_reason  text,
  last_reminder_at       timestamptz,
  created_by             uuid references profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  check (not reminders_paused or reminder_pause_reason is not null)
);
create index payment_milestones_project_idx on payment_milestones (project_id, sort_order) where deleted_at is null;
create index payment_milestones_due_idx on payment_milestones (due_date) where deleted_at is null and status <> 'paid';

-- Payments are never deleted: a wrong entry is voided with a reason.
create table payment_transactions (
  id                uuid primary key default gen_random_uuid(),
  milestone_id      uuid not null references payment_milestones(id),
  project_id        uuid not null references projects(id),
  amount_paise      bigint not null check (amount_paise > 0),
  received_on       date not null,
  method            text,
  reference         text,
  receipt_path      text,
  receipt_published boolean not null default false,
  recorded_by       uuid not null references profiles(id),
  voided_at         timestamptz,
  voided_by         uuid references profiles(id),
  void_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (voided_at is null or void_reason is not null)
);
create index payment_transactions_milestone_idx on payment_transactions (milestone_id) where voided_at is null;

create table payment_due_date_changes (
  id             uuid primary key default gen_random_uuid(),
  milestone_id   uuid not null references payment_milestones(id) on delete cascade,
  old_due_date   date,
  new_due_date   date,
  reason         text not null check (length(trim(reason)) > 0),
  changed_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- =====================================================================
-- 17–18. SITE UPDATES (Release 4)
-- =====================================================================
create table site_updates (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  stage_id          uuid references project_stages(id),
  site_datetime     timestamptz not null default now(),
  area              text,
  work_category     text,
  work_completed    text,
  current_activity  text,
  next_activity     text,
  blockers          text,
  client_visible    boolean not null default false,
  status            site_update_status not null default 'draft',
  published_at      timestamptz,
  published_by      uuid references profiles(id),
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index site_updates_project_idx on site_updates (project_id, site_datetime desc) where deleted_at is null;

create table site_update_media (
  id              uuid primary key default gen_random_uuid(),
  site_update_id  uuid not null references site_updates(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  storage_path    text not null,
  media_type      media_type not null default 'image',
  caption         text,
  area            text,
  client_visible  boolean not null default true,
  sort_order      integer not null default 0,
  uploaded_by     uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index site_update_media_update_idx on site_update_media (site_update_id);

-- =====================================================================
-- 20–22. SNAGS (Release 4)
-- =====================================================================
create table snags (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references projects(id) on delete cascade,
  area                  text,
  category              snag_category not null default 'other',
  description           text not null check (length(trim(description)) > 0),
  urgency               priority_level,
  status                snag_status not null default 'open',
  raised_by             uuid not null references profiles(id),
  assigned_to           uuid references profiles(id),
  assigned_by           uuid references profiles(id),
  resolved_at           timestamptz,
  resolved_by           uuid references profiles(id),
  client_confirmed_at   timestamptz,
  reopen_count          smallint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index snags_project_status_idx on snags (project_id, status) where deleted_at is null;
create index snags_assignee_idx on snags (assigned_to) where deleted_at is null;

create table snag_comments (
  id           uuid primary key default gen_random_uuid(),
  snag_id      uuid not null references snags(id) on delete cascade,
  author_id    uuid not null references profiles(id),
  body         text not null check (length(trim(body)) > 0),
  is_internal  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index snag_comments_snag_idx on snag_comments (snag_id, created_at);

create table snag_attachments (
  id            uuid primary key default gen_random_uuid(),
  snag_id       uuid not null references snags(id) on delete cascade,
  storage_path  text not null,
  media_type    media_type not null default 'image',
  kind          text not null default 'report' check (kind in ('report', 'resolution')),
  uploaded_by   uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index snag_attachments_snag_idx on snag_attachments (snag_id);

-- =====================================================================
-- Internal notes (staff-only or management-only remarks on any record).
-- Keeps internal remarks physically separate from client-visible rows.
-- =====================================================================
create table internal_notes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  entity_type  text not null,    -- 'project','stage','approval','payment_milestone',...
  entity_id    uuid not null,
  visibility   note_visibility not null default 'staff',
  body         text not null check (length(trim(body)) > 0),
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index internal_notes_entity_idx on internal_notes (entity_type, entity_id) where deleted_at is null;

-- =====================================================================
-- 23–25. NOTIFICATIONS (Release 5)
-- =====================================================================
create table notifications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  recipient_id     uuid not null references profiles(id),
  project_id       uuid references projects(id) on delete cascade,
  event_type       text not null,      -- e.g. 'approval.requested'
  title            text not null,
  body             text,
  link_path        text,               -- in-app route that opens the record
  entity_type      text,
  entity_id        uuid,
  is_critical      boolean not null default false,
  dedupe_key       text,               -- prevents duplicate reminders
  read_at          timestamptz,
  push_sent_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index notifications_dedupe_uq on notifications (recipient_id, dedupe_key) where dedupe_key is not null;
create index notifications_recipient_idx on notifications (recipient_id, created_at desc);
create index notifications_unread_idx on notifications (recipient_id) where read_at is null;

create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth_key      text not null,
  user_agent    text,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index push_subscriptions_profile_idx on push_subscriptions (profile_id) where revoked_at is null;

create table notification_preferences (
  profile_id   uuid not null references profiles(id) on delete cascade,
  event_type   text not null,
  in_app       boolean not null default true,
  push         boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (profile_id, event_type)
);

-- =====================================================================
-- 26. AUDIT LOG (append-only; written by triggers, never by the app)
-- =====================================================================
create table audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid,
  project_id       uuid,
  actor_id         uuid,
  action           text not null,        -- 'insert' | 'update' | 'delete' | custom
  entity_type      text not null,        -- table name
  entity_id        uuid,
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index audit_logs_project_idx on audit_logs (project_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_org_idx on audit_logs (organisation_id, created_at desc);

-- ---------- updated_at triggers on every table that has the column ----
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- >>> supabase/migrations/0002_security.sql
-- =====================================================================
-- MERAGHAR OS — PERMISSIONS (Row Level Security), BUSINESS RULES, AUDIT
--
-- Every sensitive table has RLS switched on. The database itself decides
-- who may read or change a row, so hiding a button in the app is never
-- the only protection.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions ("who am I and what am I allowed to see?")
-- SECURITY DEFINER so they can look up membership without recursion.
-- ---------------------------------------------------------------------
create or replace function my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organisation_id from profiles
  where id = auth.uid() and is_active and deleted_at is null
$$;

create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles
  where id = auth.uid() and is_active and deleted_at is null
$$;

create or replace function is_org_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('owner', 'admin'), false)
$$;

create or replace function is_management() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('owner', 'admin', 'project_manager'), false)
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() <> 'client', false)
$$;

create or replace function is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members m
    join projects p on p.id = m.project_id and p.deleted_at is null
    where m.project_id = pid and m.profile_id = auth.uid() and m.removed_at is null
  )
$$;

-- Can see the project at all (owner/admin of the org, or assigned to it)
create or replace function can_view_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid and p.deleted_at is null
      and p.organisation_id = my_org_id()
      and (is_org_admin() or is_project_member(pid))
  )
$$;

-- Can run the project (owner/admin, or the assigned project manager)
create or replace function can_manage_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid and p.deleted_at is null
      and p.organisation_id = my_org_id()
      and (
        is_org_admin()
        or (my_role() = 'project_manager' and exists (
              select 1 from project_members m
              where m.project_id = pid and m.profile_id = auth.uid()
                and m.member_role = 'project_manager' and m.removed_at is null))
      )
  )
$$;

create or replace function is_project_client(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'client' and exists (
    select 1 from project_members m
    join projects p on p.id = m.project_id and p.deleted_at is null
    where m.project_id = pid and m.profile_id = auth.uid()
      and m.member_role = 'client' and m.removed_at is null
  )
$$;

-- Internal team member on this project (never a client)
create or replace function is_project_staff(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff() and can_view_project(pid)
$$;

-- Money: management of the project, or the project's own client. Never
-- designers / supervisors / execution staff by default.
create or replace function can_view_project_finance(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_project(pid) or is_project_client(pid)
$$;

-- Two people share at least one active project
create or replace function shares_project_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members a
    join project_members b on b.project_id = a.project_id and b.removed_at is null
    join projects p on p.id = a.project_id and p.deleted_at is null
    where a.profile_id = auth.uid() and a.removed_at is null and b.profile_id = other
  )
$$;

-- India time "today" for due-date logic
create or replace function today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------------------------------------------------------------------
-- Switch RLS on for every table in public
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
-- Nobody signed-out (anon) gets table access at all.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- POLICIES
-- ---------------------------------------------------------------------

-- organisations
create policy org_select on organisations for select using (id = my_org_id());
create policy org_update on organisations for update using (id = my_org_id() and is_org_admin());

-- profiles: yourself; management sees the whole organisation; others see
-- only people they share a project with (teammates / their client).
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or (organisation_id = my_org_id() and is_management())
  or (organisation_id = my_org_id() and shares_project_with(id))
);
create policy profiles_update on profiles for update using (
  id = auth.uid()
  or (organisation_id = my_org_id() and is_org_admin())
  or (organisation_id = my_org_id() and role = 'client' and is_management() and shares_project_with(id))
);
-- (no insert/delete policy: accounts are created by the server's
--  user-creation routine after a permission check)

-- projects (insert happens through create_project(); see below)
create policy projects_select on projects for select using (can_view_project(id));
create policy projects_update on projects for update using (can_manage_project(id));

-- project_members
create policy pm_select on project_members for select using (can_view_project(project_id));
create policy pm_insert on project_members for insert with check (can_manage_project(project_id));
create policy pm_update on project_members for update using (can_manage_project(project_id));

-- configurable lists
create policy sc_select on scope_categories for select using (organisation_id = my_org_id() and is_staff());
create policy sc_write  on scope_categories for all using (organisation_id = my_org_id() and is_org_admin())
  with check (organisation_id = my_org_id() and is_org_admin());
create policy st_select on stage_templates for select using (organisation_id = my_org_id() and is_staff());
create policy st_write  on stage_templates for all using (organisation_id = my_org_id() and is_org_admin())
  with check (organisation_id = my_org_id() and is_org_admin());
create policy tt_select on task_templates for select using (organisation_id = my_org_id() and is_staff());
create policy tt_write  on task_templates for all using (organisation_id = my_org_id() and is_org_admin())
  with check (organisation_id = my_org_id() and is_org_admin());

-- scope
create policy scope_select on project_scope_items for select using (can_view_project(project_id));
create policy scope_insert on project_scope_items for insert with check (can_manage_project(project_id));
create policy scope_update on project_scope_items for update using (can_manage_project(project_id));
create policy scope_cost_all on project_scope_costs for all
  using (can_manage_project(project_id)) with check (can_manage_project(project_id));

-- documents: staff of the project (quotations only for management);
-- clients only what has been marked client-visible.
create policy docs_select on project_documents for select using (
  (is_project_staff(project_id) and (doc_type <> 'quotation' or can_manage_project(project_id)))
  or (is_project_client(project_id) and client_visible)
);
create policy docs_insert on project_documents for insert with check (
  is_project_staff(project_id) and uploaded_by = auth.uid()
  and (not client_visible or can_manage_project(project_id))
);
create policy docs_update on project_documents for update using (
  can_manage_project(project_id) or (uploaded_by = auth.uid() and not client_visible)
);

-- stages
create policy stages_select on project_stages for select using (
  is_project_staff(project_id) or (is_project_client(project_id) and client_visible)
);
create policy stages_write on project_stages for all
  using (can_manage_project(project_id)) with check (can_manage_project(project_id));
create policy stage_dep_select on stage_dependencies for select using (
  exists (select 1 from project_stages s where s.id = stage_id and is_project_staff(s.project_id))
);
create policy stage_dep_write on stage_dependencies for all
  using (exists (select 1 from project_stages s where s.id = stage_id and can_manage_project(s.project_id)))
  with check (exists (select 1 from project_stages s where s.id = stage_id and can_manage_project(s.project_id)));

-- approvals: clients never see drafts
create policy appr_select on approvals for select using (
  is_project_staff(project_id) or (is_project_client(project_id) and status <> 'draft')
);
create policy appr_insert on approvals for insert with check (can_manage_project(project_id));
create policy appr_update on approvals for update using (can_manage_project(project_id));

create policy apprrev_select on approval_revisions for select using (
  is_project_staff(project_id) or (is_project_client(project_id) and status <> 'draft')
);
create policy apprrev_insert on approval_revisions for insert with check (can_manage_project(project_id));
create policy apprrev_update on approval_revisions for update using (can_manage_project(project_id));

create policy apprresp_select on approval_responses for select using (
  is_project_staff(project_id) or is_project_client(project_id)
);
create policy apprresp_insert on approval_responses for insert with check (
  is_project_client(project_id) and responded_by = auth.uid()
);

-- tasks: internal only
create policy tasks_select on tasks for select using (is_project_staff(project_id));
create policy tasks_insert on tasks for insert with check (can_manage_project(project_id));
create policy tasks_update on tasks for update using (
  can_manage_project(project_id) or (assigned_to = auth.uid() and is_project_staff(project_id))
);
create policy taskdep_select on task_dependencies for select using (
  exists (select 1 from tasks t where t.id = task_id and is_project_staff(t.project_id))
);
create policy taskdep_write on task_dependencies for all
  using (exists (select 1 from tasks t where t.id = task_id and can_manage_project(t.project_id)))
  with check (exists (select 1 from tasks t where t.id = task_id and can_manage_project(t.project_id)));
create policy taskcom_select on task_comments for select using (
  exists (select 1 from tasks t where t.id = task_id and is_project_staff(t.project_id))
);
create policy taskcom_insert on task_comments for insert with check (
  author_id = auth.uid() and exists (select 1 from tasks t where t.id = task_id and is_project_staff(t.project_id))
);
create policy taskatt_select on task_attachments for select using (
  exists (select 1 from tasks t where t.id = task_id and is_project_staff(t.project_id))
);
create policy taskatt_insert on task_attachments for insert with check (
  uploaded_by = auth.uid() and exists (select 1 from tasks t where t.id = task_id and is_project_staff(t.project_id))
);

-- payments: management + the project's client only
create policy paym_select on payment_milestones for select using (can_view_project_finance(project_id));
create policy paym_insert on payment_milestones for insert with check (can_manage_project(project_id));
create policy paym_update on payment_milestones for update using (can_manage_project(project_id));
create policy payt_select on payment_transactions for select using (
  can_manage_project(project_id) or (is_project_client(project_id) and voided_at is null)
);
create policy payt_insert on payment_transactions for insert with check (
  can_manage_project(project_id) and recorded_by = auth.uid()
);
create policy payt_update on payment_transactions for update using (can_manage_project(project_id));
create policy payddc_select on payment_due_date_changes for select using (
  exists (select 1 from payment_milestones m where m.id = milestone_id and can_manage_project(m.project_id))
);
create policy payddc_insert on payment_due_date_changes for insert with check (
  changed_by = auth.uid()
  and exists (select 1 from payment_milestones m where m.id = milestone_id and can_manage_project(m.project_id))
);

-- site updates: clients see only published + client-visible
create policy su_select on site_updates for select using (
  is_project_staff(project_id)
  or (is_project_client(project_id) and status = 'published' and client_visible)
);
create policy su_insert on site_updates for insert with check (
  is_project_staff(project_id) and created_by = auth.uid()
);
create policy su_update on site_updates for update using (
  can_manage_project(project_id)
  or (created_by = auth.uid() and status in ('draft', 'pending_review'))
);
create policy sum_select on site_update_media for select using (
  is_project_staff(project_id)
  or (is_project_client(project_id) and client_visible and exists (
        select 1 from site_updates u where u.id = site_update_id
          and u.status = 'published' and u.client_visible and u.deleted_at is null))
);
create policy sum_insert on site_update_media for insert with check (
  is_project_staff(project_id) and uploaded_by = auth.uid()
);
create policy sum_update on site_update_media for update using (
  can_manage_project(project_id) or uploaded_by = auth.uid()
);

-- client purchases
create policy pr_select on purchase_requirements for select using (can_view_project(project_id));
create policy pr_insert on purchase_requirements for insert with check (can_manage_project(project_id));
create policy pr_update on purchase_requirements for update using (
  is_project_staff(project_id) or is_project_client(project_id)
);

-- snags
create policy snag_select on snags for select using (can_view_project(project_id));
create policy snag_insert on snags for insert with check (
  can_view_project(project_id) and raised_by = auth.uid()
);
create policy snag_update on snags for update using (
  can_manage_project(project_id)
  or (assigned_to = auth.uid() and is_project_staff(project_id))
  or is_project_client(project_id)
);
create policy snagc_select on snag_comments for select using (
  exists (select 1 from snags s where s.id = snag_id
          and (is_project_staff(s.project_id) or (is_project_client(s.project_id) and not is_internal)))
);
create policy snagc_insert on snag_comments for insert with check (
  author_id = auth.uid() and exists (select 1 from snags s where s.id = snag_id
    and (is_project_staff(s.project_id) or (is_project_client(s.project_id) and not is_internal)))
);
create policy snaga_select on snag_attachments for select using (
  exists (select 1 from snags s where s.id = snag_id and can_view_project(s.project_id))
);
create policy snaga_insert on snag_attachments for insert with check (
  uploaded_by = auth.uid() and exists (select 1 from snags s where s.id = snag_id and can_view_project(s.project_id))
);

-- internal notes
create policy notes_select on internal_notes for select using (
  (visibility = 'staff' and is_project_staff(project_id))
  or (visibility = 'management' and can_manage_project(project_id))
);
create policy notes_insert on internal_notes for insert with check (
  created_by = auth.uid() and (
    (visibility = 'staff' and is_project_staff(project_id))
    or (visibility = 'management' and can_manage_project(project_id)))
);
create policy notes_update on internal_notes for update using (created_by = auth.uid());

-- notifications: only your own
create policy notif_select on notifications for select using (recipient_id = auth.uid());
create policy notif_update on notifications for update using (recipient_id = auth.uid());
create policy push_all on push_subscriptions for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy npref_all on notification_preferences for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- audit log: read-only for owner/admin (whole org) and project managers
-- (their projects). Rows are written only by the audit trigger.
create policy audit_select on audit_logs for select using (
  (organisation_id = my_org_id() and is_org_admin())
  or (project_id is not null and can_manage_project(project_id))
);

-- =====================================================================
-- BUSINESS RULES ENFORCED IN THE DATABASE
-- =====================================================================

-- Profiles: only owner/admin may change someone's role, organisation or
-- active status; only an owner may create/modify another owner.
create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- server/system context
  if (new.role, new.organisation_id, new.is_active, new.deleted_at)
     is distinct from (old.role, old.organisation_id, old.is_active, old.deleted_at) then
    if not is_org_admin() then
      raise exception 'Only an owner or admin can change roles or deactivate accounts' using errcode = '42501';
    end if;
    if (old.role = 'owner' or new.role = 'owner') and my_role() <> 'owner' then
      raise exception 'Only an owner can change an owner account' using errcode = '42501';
    end if;
    if old.id = auth.uid() and new.is_active = false then
      raise exception 'You cannot deactivate your own account' using errcode = '42501';
    end if;
  end if;
  if new.email is distinct from old.email and auth.uid() is not null and not is_org_admin() then
    raise exception 'Login email can only be changed by an admin' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on profiles
  for each row execute function guard_profile_update();

-- Projects: only owner/admin may delete (soft) a project; code is fixed.
create or replace function guard_project_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_code is distinct from old.project_code or new.organisation_id is distinct from old.organisation_id then
    raise exception 'Project code and organisation cannot be changed' using errcode = '42501';
  end if;
  if auth.uid() is not null and new.deleted_at is distinct from old.deleted_at and not is_org_admin() then
    raise exception 'Only an owner or admin can delete a project' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_projects_guard before update on projects
  for each row execute function guard_project_update();

-- Project members: a client account can only be added as "client", staff
-- only in staff roles, and only from the same organisation.
create or replace function validate_project_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role app_role; v_org uuid; p_org uuid;
begin
  select role, organisation_id into v_role, v_org from profiles where id = new.profile_id and deleted_at is null;
  select organisation_id into p_org from projects where id = new.project_id;
  if v_role is null then raise exception 'Person not found'; end if;
  if v_org <> p_org then raise exception 'Person belongs to a different organisation' using errcode = '42501'; end if;
  if (v_role = 'client') <> (new.member_role = 'client') then
    raise exception 'A client account can only be assigned as a client, and staff only to staff roles';
  end if;
  if new.member_role = 'project_manager' and v_role not in ('owner', 'admin', 'project_manager') then
    raise exception 'Only management users can be assigned as project manager';
  end if;
  return new;
end $$;
create trigger trg_project_members_validate before insert or update on project_members
  for each row execute function validate_project_member();

-- Approval revisions: content freezes once published; an approved
-- revision is completely immutable. Changes require a new revision.
create or replace function guard_approval_revision() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft revisions can be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'approved' then
    raise exception 'An approved revision can never be changed. Create a new revision instead.' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (
       new.client_description, new.material_brand, new.material_type, new.specifications, new.colour,
       new.finish, new.dimensions, new.quantity, new.quantity_unit, new.commercial_impact_paise, new.files,
       new.revision_no, new.approval_id
     ) is distinct from (
       old.client_description, old.material_brand, old.material_type, old.specifications, old.colour,
       old.finish, old.dimensions, old.quantity, old.quantity_unit, old.commercial_impact_paise, old.files,
       old.revision_no, old.approval_id) then
    raise exception 'A published revision cannot be edited. Create a new revision instead.' using errcode = '42501';
  end if;
  -- Status decisions by the client are only set by record_approval_response()
  if new.status = 'approved' and old.status <> 'approved' and current_setting('meraghar.approval_response', true) is distinct from 'on' then
    raise exception 'Only the client can approve a revision' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_approval_revisions_guard before update or delete on approval_revisions
  for each row execute function guard_approval_revision();

-- Approval responses are permanent (no edits, no deletes) and must target
-- the latest published revision. The response moves the statuses along.
create or replace function record_approval_response() returns trigger
language plpgsql security definer set search_path = public as $$
declare rev approval_revisions; appr approvals; new_status revision_status;
begin
  select * into rev from approval_revisions where id = new.revision_id for update;
  select * into appr from approvals where id = new.approval_id for update;
  if rev.approval_id <> new.approval_id or appr.project_id <> new.project_id then
    raise exception 'Response does not match the approval';
  end if;
  if rev.status <> 'published' or rev.revision_no <> appr.current_revision_no then
    raise exception 'Only the latest published revision can be responded to';
  end if;
  new_status := case new.action when 'approve' then 'approved'
                                when 'request_changes' then 'changes_requested'
                                else 'query_raised' end;
  perform set_config('meraghar.approval_response', 'on', true);
  update approval_revisions set status = new_status, decided_at = now() where id = rev.id;
  update approvals set status = new_status::text::approval_status where id = appr.id;
  perform set_config('meraghar.approval_response', 'off', true);
  return new;
end $$;
create trigger trg_approval_responses_record after insert on approval_responses
  for each row execute function record_approval_response();

create or replace function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% records are permanent and cannot be changed or deleted', tg_table_name using errcode = '42501';
end $$;
create trigger trg_approval_responses_immutable before update or delete on approval_responses
  for each row execute function forbid_change();
create trigger trg_audit_logs_immutable before update or delete on audit_logs
  for each row execute function forbid_change();
create trigger trg_payment_ddc_immutable before update or delete on payment_due_date_changes
  for each row execute function forbid_change();

-- Payment transactions: never deleted; after recording, only voiding or
-- receipt publishing may change.
create or replace function guard_payment_transaction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted. Void the entry with a reason instead.' using errcode = '42501';
  end if;
  if (new.milestone_id, new.project_id, new.amount_paise, new.received_on, new.recorded_by, new.created_at)
     is distinct from (old.milestone_id, old.project_id, old.amount_paise, old.received_on, old.recorded_by, old.created_at) then
    raise exception 'A recorded payment cannot be edited. Void it and record a new one.' using errcode = '42501';
  end if;
  if old.voided_at is not null and new.voided_at is distinct from old.voided_at then
    raise exception 'A voided payment cannot be restored' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_payment_transactions_guard before update or delete on payment_transactions
  for each row execute function guard_payment_transaction();

-- Clients may only update their purchase status (to their own steps) and remarks.
create or replace function guard_purchase_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and my_role() = 'client' then
    if (to_jsonb(new) - array['status','client_remarks','updated_at'])
       is distinct from (to_jsonb(old) - array['status','client_remarks','updated_at']) then
      raise exception 'Clients can only update purchase status and their remarks' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('purchased', 'delivery_scheduled', 'delivered') then
      raise exception 'Clients can mark items as purchased, delivery scheduled or delivered' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_purchase_guard before update on purchase_requirements
  for each row execute function guard_purchase_update();

-- Tasks: an assignee who is not managing the project may update progress
-- but not reassign, re-prioritise or move deadlines.
create or replace function guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not can_manage_project(old.project_id) then
    if (new.assigned_to, new.due_date, new.start_date, new.priority, new.project_id, new.reviewer_id, new.requires_review, new.title)
       is distinct from (old.assigned_to, old.due_date, old.start_date, old.priority, old.project_id, old.reviewer_id, old.requires_review, old.title) then
      raise exception 'Only the project manager can reassign, re-prioritise or change deadlines' using errcode = '42501';
    end if;
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger trg_tasks_guard before update on tasks
  for each row execute function guard_task_update();

-- Site updates: only management can publish.
create or replace function guard_site_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    if auth.uid() is not null and not can_manage_project(new.project_id) then
      raise exception 'Only the project manager can publish a site update' using errcode = '42501';
    end if;
    new.published_at := now();
    new.published_by := auth.uid();
  end if;
  return new;
end $$;
create trigger trg_site_updates_guard before insert or update on site_updates
  for each row execute function guard_site_update();

-- Snags: clients can only confirm or reopen (with a reason via comment);
-- assignees can only move work forward to "awaiting confirmation".
create or replace function guard_snag_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or can_manage_project(old.project_id) then return new; end if;
  if (new.project_id, new.category, new.description, new.raised_by, new.assigned_to, new.assigned_by)
     is distinct from (old.project_id, old.category, old.description, old.raised_by, old.assigned_to, old.assigned_by) then
    raise exception 'You can only update the status of this concern' using errcode = '42501';
  end if;
  if my_role() = 'client' then
    if new.status = old.status then return new; end if;
    if old.status not in ('awaiting_client_confirmation', 'resolved') or new.status not in ('resolved', 'reopened') then
      raise exception 'Clients can confirm a resolution or reopen a concern' using errcode = '42501';
    end if;
    if new.status = 'resolved' then new.client_confirmed_at := now(); end if;
    if new.status = 'reopened' then new.reopen_count := old.reopen_count + 1; new.client_confirmed_at := null; end if;
  else
    if new.status not in ('in_progress', 'awaiting_client_confirmation') and new.status <> old.status then
      raise exception 'Only the project manager can close or reassign a concern' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_snags_guard before update on snags
  for each row execute function guard_snag_update();

-- Notifications: the recipient may only mark as read.
create or replace function guard_notification_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and (to_jsonb(new) - array['read_at','updated_at']) is distinct from (to_jsonb(old) - array['read_at','updated_at']) then
    raise exception 'Notifications can only be marked read/unread' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_notifications_guard before update on notifications
  for each row execute function guard_notification_update();

-- Critical financial and approval notifications cannot be switched off in-app.
create or replace function guard_notification_pref() returns trigger
language plpgsql as $$
begin
  if (new.event_type like 'payment.%' or new.event_type like 'approval.%') and not new.in_app then
    raise exception 'Payment and approval notifications cannot be turned off' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_notification_pref_guard before insert or update on notification_preferences
  for each row execute function guard_notification_pref();

-- =====================================================================
-- AUDIT TRAIL — every important insert/update/delete is recorded with
-- who did it and the before/after values.
-- =====================================================================
create or replace function write_audit_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_project uuid;
  v_org uuid;
begin
  if tg_op = 'UPDATE' and (v_new - 'updated_at') = (v_old - 'updated_at') then
    return new;
  end if;
  -- Never copy password hashes or secrets into the audit log
  v_new := v_new - 'encrypted_password';
  v_old := v_old - 'encrypted_password';
  v_project := case when tg_table_name = 'projects' then (v_row ->> 'id')::uuid
                    else (v_row ->> 'project_id')::uuid end;
  if v_project is not null then
    select organisation_id into v_org from projects where id = v_project;
  else
    v_org := coalesce((v_row ->> 'organisation_id')::uuid, my_org_id());
  end if;
  insert into audit_logs (organisation_id, project_id, actor_id, action, entity_type, entity_id, old_data, new_data)
  values (v_org, v_project, auth.uid(), lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid, v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'organisations', 'profiles', 'projects', 'project_members', 'project_scope_items', 'project_scope_costs',
    'project_documents', 'project_stages', 'stage_dependencies', 'tasks', 'task_dependencies',
    'approvals', 'approval_revisions', 'approval_responses',
    'payment_milestones', 'payment_transactions', 'payment_due_date_changes',
    'site_updates', 'purchase_requirements', 'snags', 'internal_notes'
  ] loop
    execute format('create trigger trg_%s_audit after insert or update or delete on %I for each row execute function write_audit_log()', t, t);
  end loop;
end $$;

-- =====================================================================
-- CREATE PROJECT — one atomic step: project + code + team + scope.
-- If anything fails, nothing is saved.
-- =====================================================================
create or replace function create_project(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := my_org_id();
  v_role app_role := my_role();
  v_prefix text; v_seq int; v_code text; v_pid uuid;
  v_pm uuid := nullif(payload ->> 'project_manager_id', '')::uuid;
  v_designer uuid := nullif(payload ->> 'designer_id', '')::uuid;
  v_client uuid := nullif(payload ->> 'client_id', '')::uuid;
  v_member uuid; v_item jsonb; v_scope uuid; i int := 0;
begin
  if v_uid is null or v_role not in ('owner', 'admin', 'project_manager') then
    raise exception 'Only management can create projects' using errcode = '42501';
  end if;
  if length(trim(coalesce(payload ->> 'name', ''))) = 0 then
    raise exception 'Project name is required';
  end if;
  -- A project manager creating a project manages it themselves
  if v_role = 'project_manager' then v_pm := coalesce(v_pm, v_uid); end if;

  update organisations set next_project_seq = next_project_seq + 1
   where id = v_org returning project_code_prefix, next_project_seq - 1 into v_prefix, v_seq;
  v_code := v_prefix || '-' || to_char(today_ist(), 'YY') || lpad(v_seq::text, 4, '0');

  insert into projects (
    organisation_id, project_code, name, status, client_id, address_line, building_society, flat_number,
    city, state, pincode, property_config, carpet_area_sqft, possession_status,
    expected_start_date, target_handover_date, description, site_update_frequency_days, created_by)
  values (
    v_org, v_code, trim(payload ->> 'name'), coalesce(nullif(payload ->> 'status', '')::project_status, 'active'),
    v_client, payload ->> 'address_line', payload ->> 'building_society', payload ->> 'flat_number',
    coalesce(nullif(payload ->> 'city', ''), 'Pune'), coalesce(nullif(payload ->> 'state', ''), 'Maharashtra'),
    payload ->> 'pincode', payload ->> 'property_config', nullif(payload ->> 'carpet_area_sqft', '')::numeric,
    nullif(payload ->> 'possession_status', '')::possession_status,
    nullif(payload ->> 'expected_start_date', '')::date, nullif(payload ->> 'target_handover_date', '')::date,
    payload ->> 'description', coalesce(nullif(payload ->> 'site_update_frequency_days', '')::smallint, 7), v_uid)
  returning id into v_pid;

  if v_pm is not null then
    insert into project_members (project_id, profile_id, member_role, is_primary, added_by)
    values (v_pid, v_pm, 'project_manager', true, v_uid);
  end if;
  if v_designer is not null then
    insert into project_members (project_id, profile_id, member_role, is_primary, added_by)
    values (v_pid, v_designer, 'designer', true, v_uid);
  end if;
  if v_client is not null then
    insert into project_members (project_id, profile_id, member_role, is_primary, added_by)
    values (v_pid, v_client, 'client', true, v_uid);
  end if;
  for v_member in select (jsonb_array_elements_text(coalesce(payload -> 'execution_ids', '[]'::jsonb)))::uuid loop
    insert into project_members (project_id, profile_id, member_role, added_by)
    select v_pid, v_member,
           case when role = 'site_supervisor' then 'site_supervisor'::project_member_role else 'execution' end, v_uid
    from profiles where id = v_member
    on conflict do nothing;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(payload -> 'scope', '[]'::jsonb)) loop
    i := i + 1;
    insert into project_scope_items (project_id, category, is_included, description, sort_order, created_by)
    values (v_pid, v_item ->> 'category', coalesce((v_item ->> 'is_included')::boolean, true),
            nullif(v_item ->> 'description', ''), i, v_uid)
    returning id into v_scope;
    if coalesce((v_item ->> 'estimated_cost_paise')::bigint, 0) > 0 then
      insert into project_scope_costs (scope_item_id, project_id, estimated_cost_paise, updated_by)
      values (v_scope, v_pid, (v_item ->> 'estimated_cost_paise')::bigint, v_uid);
    end if;
  end loop;

  return v_pid;
end $$;
revoke all on function create_project(jsonb) from public, anon;
grant execute on function create_project(jsonb) to authenticated;

-- =====================================================================
-- VIEWS (respect the caller's permissions: security_invoker)
-- =====================================================================

-- Payment balances: received / outstanding are always calculated from
-- the actual recorded payments, never typed in.
create view payment_milestone_balances with (security_invoker = true) as
select m.*,
  coalesce(t.received, 0)::bigint                      as received_paise,
  greatest(m.amount_paise - coalesce(t.received, 0), 0)::bigint as outstanding_paise,
  case
    when m.status = 'on_hold' then 'on_hold'
    when coalesce(t.received, 0) >= m.amount_paise then 'paid'
    when m.due_date is not null and m.due_date < today_ist() then 'overdue'
    when coalesce(t.received, 0) > 0 then 'partially_paid'
    when m.due_date is not null and m.due_date <= today_ist() + 7 then 'due'
    else 'upcoming'
  end::payment_status                                  as effective_status
from payment_milestones m
left join (
  select milestone_id, sum(amount_paise) as received
  from payment_transactions where voided_at is null group by milestone_id
) t on t.milestone_id = m.id
where m.deleted_at is null;

-- Project health: based on real schedule data (overdue stages and tasks,
-- overdue approvals, blockers, handover date), NOT a typed-in percentage.
create view project_health with (security_invoker = true) as
with s as (
  select p.id as project_id,
    (select count(*) from project_stages st where st.project_id = p.id and st.deleted_at is null
       and st.status not in ('completed', 'skipped') and st.planned_end_date < today_ist())       as overdue_stages,
    (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null
       and t.status not in ('completed', 'cancelled') and t.due_date < today_ist())               as overdue_tasks,
    (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null
       and t.status = 'blocked')                                                                  as blocked_tasks,
    (select count(*) from approvals a where a.project_id = p.id and a.deleted_at is null
       and a.status = 'pending' and a.deadline < today_ist())                                     as overdue_approvals,
    (select count(*) from approvals a where a.project_id = p.id and a.deleted_at is null
       and a.status in ('pending', 'query_raised', 'changes_requested'))                          as open_approvals,
    (p.target_handover_date is not null and p.actual_handover_date is null
       and p.target_handover_date < today_ist())                                                  as handover_missed,
    (p.target_handover_date is not null and p.actual_handover_date is null
       and p.target_handover_date between today_ist() and today_ist() + 14)                       as handover_near
  from projects p
  where p.deleted_at is null and p.status in ('active', 'on_hold')
)
select s.*,
  case
    when handover_missed or overdue_stages > 0 or overdue_approvals > 1 or blocked_tasks > 2 then 'red'
    when overdue_tasks > 0 or blocked_tasks > 0 or overdue_approvals > 0 or handover_near then 'amber'
    else 'green'
  end as health,
  array_remove(array[
    case when handover_missed then 'Handover date has passed' end,
    case when overdue_stages > 0 then overdue_stages || ' stage(s) behind schedule' end,
    case when overdue_approvals > 0 then overdue_approvals || ' client approval(s) overdue' end,
    case when blocked_tasks > 0 then blocked_tasks || ' blocked task(s)' end,
    case when overdue_tasks > 0 then overdue_tasks || ' overdue task(s)' end,
    case when handover_near then 'Handover within 14 days' end
  ], null) as reasons
from s;

grant select on payment_milestone_balances, project_health to authenticated;

-- >>> supabase/migrations/0003_auth_functions.sql
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

-- >>> supabase/migrations/0004_release2.sql
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

-- >>> supabase/migrations/0005_release3.sql
-- =====================================================================
-- MERAGHAR OS — RELEASE 3: execution control
--
-- Applied automatically when the app starts. Safe to run more than once.
--
-- What it adds
--   * Project stages with dates, dependencies, delay causes and a
--     recorded reason whenever a planned date moves
--   * Default stages (and standard tasks) from configurable templates
--   * Tasks: assignment to the project team only, reviews, completion
--     evidence, comments, files, dependencies on tasks / client approvals
--     / client purchases, with "ready to start" automation
--   * Blockers: anyone on the team can flag one with its cause; the
--     manager sees it at once; resolving it puts the task back to work
--   * Task and stage notifications and daily deadline reminders
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FILES ON TASKS (site photos, documents, completion evidence)
-- ---------------------------------------------------------------------
alter table stored_files drop constraint if exists stored_files_entity_type_check;
alter table stored_files add constraint stored_files_entity_type_check
  check (entity_type in ('approval_revision', 'payment_transaction', 'task'));

drop policy if exists files_select on stored_files;
create policy files_select on stored_files for select using (
  (entity_type = 'approval_revision'
     and exists (select 1 from approval_revisions r where r.id = entity_id and r.project_id = stored_files.project_id))
  or (entity_type = 'payment_transaction'
     and exists (select 1 from payment_transactions t where t.id = entity_id and t.project_id = stored_files.project_id
                   and (can_manage_project(t.project_id) or (t.receipt_published and t.voided_at is null))))
  or (entity_type = 'task'
     and exists (select 1 from tasks t where t.id = entity_id and t.project_id = stored_files.project_id and t.deleted_at is null))
);
drop policy if exists files_insert on stored_files;
create policy files_insert on stored_files for insert with check (
  uploaded_by = auth.uid() and (
    (can_manage_project(project_id) and (
      (entity_type = 'approval_revision'
         and exists (select 1 from approval_revisions r where r.id = entity_id and r.project_id = stored_files.project_id and r.status = 'draft'))
      or (entity_type = 'payment_transaction'
         and exists (select 1 from payment_transactions t where t.id = entity_id and t.project_id = stored_files.project_id and t.voided_at is null))))
    or (entity_type = 'task' and is_project_staff(project_id)
        and exists (select 1 from tasks t where t.id = entity_id and t.project_id = stored_files.project_id and t.deleted_at is null))
  )
);

-- ---------------------------------------------------------------------
-- 2. NEW TABLES
-- ---------------------------------------------------------------------
-- A blocker is anything stopping work: on a task, or on the site in general.
create table if not exists blockers (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  task_id          uuid references tasks(id) on delete cascade,
  stage_id         uuid references project_stages(id) on delete set null,
  description      text not null check (length(trim(description)) > 0),
  delay_type       delay_type not null,
  raised_by        uuid not null references profiles(id),
  resolved_at      timestamptz,
  resolved_by      uuid references profiles(id),
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists blockers_open_idx on blockers (project_id) where resolved_at is null;
create index if not exists blockers_task_idx on blockers (task_id);

-- Every time a planned date or an assignment moves, with the reason.
create table if not exists schedule_changes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  entity_type  text not null check (entity_type in ('stage', 'task')),
  entity_id    uuid not null,
  change       text not null,          -- 'dates' | 'due_date' | 'assignee'
  old_value    text,
  new_value    text,
  reason       text,
  changed_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists schedule_changes_entity_idx on schedule_changes (entity_type, entity_id, created_at);
create index if not exists schedule_changes_project_idx on schedule_changes (project_id, created_at desc);

alter table stage_templates add column if not exists is_milestone boolean not null default false;

-- One dependency per pair
create unique index if not exists task_dep_task_uq on task_dependencies (task_id, depends_on_task_id) where depends_on_task_id is not null;
create unique index if not exists task_dep_appr_uq on task_dependencies (task_id, depends_on_approval_id) where depends_on_approval_id is not null;
create unique index if not exists task_dep_purch_uq on task_dependencies (task_id, depends_on_purchase_id) where depends_on_purchase_id is not null;
create index if not exists task_dep_on_task_idx on task_dependencies (depends_on_task_id);
create index if not exists task_dep_on_purchase_idx on task_dependencies (depends_on_purchase_id);
create index if not exists stage_dep_on_idx on stage_dependencies (depends_on_stage_id);
create index if not exists tasks_stage_idx on tasks (stage_id) where deleted_at is null;

do $$
declare t text;
begin
  foreach t in array array['blockers', 'schedule_changes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop trigger if exists trg_%s_updated_at on %I', t, t);
    execute format('create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
    execute format('drop trigger if exists trg_%s_audit on %I', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on %I for each row execute function write_audit_log()', t, t);
  end loop;
end $$;

-- Changes go through the functions below only; the team can read them.
grant select on blockers, schedule_changes to authenticated;
grant all on blockers, schedule_changes to service_role;
revoke all on blockers, schedule_changes from anon;
revoke insert, update, delete on blockers, schedule_changes from authenticated;

drop policy if exists blockers_select on blockers;
create policy blockers_select on blockers for select using (is_project_staff(project_id));
drop policy if exists schedchg_select on schedule_changes;
create policy schedchg_select on schedule_changes for select using (is_project_staff(project_id));

drop trigger if exists trg_schedule_changes_immutable on schedule_changes;
create trigger trg_schedule_changes_immutable before update or delete on schedule_changes
  for each row execute function forbid_change();

-- Task comments are a permanent record too.
drop trigger if exists trg_task_comments_immutable on task_comments;
create trigger trg_task_comments_immutable before update or delete on task_comments
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------
-- 3. SMALL HELPERS
-- ---------------------------------------------------------------------
create or replace function delay_label(t delay_type) returns text
language sql immutable as $$
  select case t when 'company' then 'Company-controlled' when 'client_approval' then 'Client approval'
                when 'client_purchase' then 'Client purchase' when 'vendor' then 'Vendor' when 'site_builder' then 'Site / builder' end
$$;

-- The right screen for a task, depending on who opens it
create or replace function task_link(p_recipient uuid, p_task uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when (select role from profiles where id = p_recipient) in ('owner', 'admin', 'project_manager')
              then '/m/tasks/' else '/e/tasks/' end || p_task
$$;

-- Is a dependency done?
create or replace function task_dependency_met(d task_dependencies) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when d.depends_on_task_id is not null then
      coalesce((select status in ('completed', 'cancelled') from tasks where id = d.depends_on_task_id), true)
    when d.depends_on_approval_id is not null then
      coalesce((select status = 'approved' or deleted_at is not null from approvals where id = d.depends_on_approval_id), true)
    else
      coalesce((select status in ('delivered', 'installed', 'cancelled') or deleted_at is not null
                  from purchase_requirements where id = d.depends_on_purchase_id), true)
  end
$$;

-- What each task is waiting for (used on every task list). Respects the
-- reader's permissions.
create or replace view task_waiting_on with (security_invoker = true) as
select d.task_id, d.id as dependency_id,
  case when d.depends_on_task_id is not null then 'task'
       when d.depends_on_approval_id is not null then 'approval' else 'purchase' end as kind,
  coalesce(d.depends_on_task_id, d.depends_on_approval_id, d.depends_on_purchase_id) as ref_id,
  coalesce(t.title, a.title, pu.item_name) as label,
  coalesce(t.status::text, a.status::text, pu.status::text) as ref_status,
  coalesce(t.due_date, a.deadline, pu.required_delivery_date) as ref_due,
  case when d.depends_on_task_id is not null then coalesce(t.status in ('completed', 'cancelled'), true)
       when d.depends_on_approval_id is not null then coalesce(a.status = 'approved' or a.deleted_at is not null, true)
       else coalesce(pu.status in ('delivered', 'installed', 'cancelled') or pu.deleted_at is not null, true) end as met
from task_dependencies d
left join tasks t on t.id = d.depends_on_task_id
left join approvals a on a.id = d.depends_on_approval_id
left join purchase_requirements pu on pu.id = d.depends_on_purchase_id;
grant select on task_waiting_on to authenticated;

-- Tell assignees when everything their task waits for is done.
-- Tasks parked as "waiting for client / vendor" go back to "not started".
create or replace function release_ready_tasks(p_kind text, p_ref uuid, p_label text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select distinct t.id, t.project_id, t.title, t.assigned_to, t.status
      from task_dependencies d join tasks t on t.id = d.task_id and t.deleted_at is null
     where t.status not in ('completed', 'cancelled')
       and case p_kind when 'task' then d.depends_on_task_id when 'approval' then d.depends_on_approval_id
                       else d.depends_on_purchase_id end = p_ref
       and not exists (select 1 from task_dependencies d2 where d2.task_id = t.id and not task_dependency_met(d2))
  loop
    if r.status in ('waiting_client', 'waiting_vendor') then
      update tasks set status = 'not_started' where id = r.id;
    end if;
    if r.assigned_to is not null then
      n := n + notify(r.assigned_to, r.project_id, 'task.ready', 'Ready to start: ' || r.title,
        p_label || ' is done, so nothing is holding this task now.', task_link(r.assigned_to, r.id), 'task', r.id, false,
        'ready:' || r.id || ':' || p_kind || ':' || p_ref);
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 4. STAGE RULES
-- ---------------------------------------------------------------------
create or replace function guard_stage() returns trigger
language plpgsql as $$
begin
  if length(trim(coalesce(new.name, ''))) = 0 then raise exception 'Give the stage a name'; end if;
  if new.status = 'completed' then
    new.completion_pct := 100;
    if tg_op = 'INSERT' or old.status <> 'completed' then
      new.actual_end_date := coalesce(new.actual_end_date, today_ist());
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'completed' then
    new.actual_end_date := null;
  end if;
  if new.status = 'delayed' and new.delay_type is null then
    raise exception 'Choose the cause of the delay: company, client approval, client purchase, vendor or site / builder';
  end if;
  return new;
end $$;
drop trigger if exists trg_project_stages_guard on project_stages;
create trigger trg_project_stages_guard before insert or update on project_stages
  for each row execute function guard_stage();

-- Record date moves (with a reason), tell the client about timeline changes
-- and completed milestones.
create or replace function track_stage_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text := nullif(trim(current_setting('app.change_reason', true)), ''); v_rec uuid;
begin
  if tg_op = 'UPDATE' and old.planned_end_date is not null and new.deleted_at is null
     and (new.start_date, new.planned_end_date) is distinct from (old.start_date, old.planned_end_date) then
    if v_reason is null and auth.uid() is not null then
      raise exception 'Give a reason for changing the dates of "%"', new.name;
    end if;
    insert into schedule_changes (project_id, entity_type, entity_id, change, old_value, new_value, reason, changed_by)
    values (new.project_id, 'stage', new.id, 'dates',
            coalesce(fmt_day(old.start_date), '?') || ' → ' || fmt_day(old.planned_end_date),
            coalesce(fmt_day(new.start_date), '?') || ' → ' || coalesce(fmt_day(new.planned_end_date), 'not set'),
            v_reason, auth.uid());
    if new.client_visible and new.planned_end_date is distinct from old.planned_end_date then
      for v_rec in select project_client_ids(new.project_id) loop
        perform notify(v_rec, new.project_id, 'schedule.changed', 'Your project timeline has been updated',
          'Open your timeline to see the latest dates. Your project manager can explain any change.',
          '/c/project', 'project', new.project_id, false, 'sched:' || new.project_id || ':' || txid_current());
      end loop;
    end if;
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') and new.is_milestone and new.client_visible
     and new.deleted_at is null then
    for v_rec in select project_client_ids(new.project_id) loop
      perform notify(v_rec, new.project_id, 'stage.milestone', 'Milestone completed: ' || new.name,
        coalesce(nullif(trim(new.client_description), ''), 'Another step towards your new home is done.'),
        '/c/project', 'stage', new.id, false, 'milestone:' || new.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_project_stages_track on project_stages;
create trigger trg_project_stages_track after insert or update on project_stages
  for each row execute function track_stage_change();

-- Same project, no loops (A waits for B waits for A).
create or replace function validate_stage_dependency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select project_id from project_stages where id = new.stage_id)
     is distinct from (select project_id from project_stages where id = new.depends_on_stage_id) then
    raise exception 'A stage can only depend on a stage of the same project';
  end if;
  if exists (
    with recursive up(id) as (
      select new.depends_on_stage_id
      union
      select d.depends_on_stage_id from stage_dependencies d join up on d.stage_id = up.id
    ) select 1 from up where id = new.stage_id) then
    raise exception 'That would make the stages wait for each other in a loop';
  end if;
  return new;
end $$;
drop trigger if exists trg_stage_dependencies_validate on stage_dependencies;
create trigger trg_stage_dependencies_validate before insert or update on stage_dependencies
  for each row execute function validate_stage_dependency();

-- ---------------------------------------------------------------------
-- 5. TASK RULES
-- ---------------------------------------------------------------------
-- Someone who isn't managing the project (the assignee) may update
-- progress, but not reassign, re-plan, review or cancel.
create or replace function guard_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not can_manage_project(old.project_id) then
    if (new.assigned_to, new.due_date, new.start_date, new.priority, new.project_id, new.reviewer_id, new.requires_review,
        new.title, new.description, new.stage_id, new.reviewed_at, new.deleted_at)
       is distinct from (old.assigned_to, old.due_date, old.start_date, old.priority, old.project_id, old.reviewer_id,
        old.requires_review, old.title, old.description, old.stage_id, old.reviewed_at, old.deleted_at) then
      raise exception 'Only the project manager can reassign, re-plan or review tasks' using errcode = '42501';
    end if;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      raise exception 'Only the project manager can cancel a task' using errcode = '42501';
    end if;
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create or replace function validate_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from project_members m join profiles pr on pr.id = m.profile_id
                    where m.project_id = new.project_id and m.profile_id = new.assigned_to and m.removed_at is null
                      and m.member_role <> 'client' and pr.is_active and pr.deleted_at is null)
       and not exists (select 1 from profiles pr join projects p on p.id = new.project_id
                        where pr.id = new.assigned_to and pr.organisation_id = p.organisation_id
                          and pr.role in ('owner', 'admin') and pr.is_active and pr.deleted_at is null) then
      raise exception 'Tasks can only be assigned to people on this project''s team. Add them to the team first';
    end if;
  end if;
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id) then
    if not exists (select 1 from profiles pr join projects p on p.id = new.project_id
                    where pr.id = new.reviewer_id and pr.organisation_id = p.organisation_id and pr.is_active and pr.deleted_at is null
                      and (pr.role in ('owner', 'admin')
                           or exists (select 1 from project_members m where m.project_id = new.project_id and m.profile_id = pr.id
                                        and m.member_role = 'project_manager' and m.removed_at is null))) then
      raise exception 'The reviewer must be this project''s manager or an owner/admin';
    end if;
  end if;
  if new.stage_id is not null and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id)
     and not exists (select 1 from project_stages s where s.id = new.stage_id and s.project_id = new.project_id and s.deleted_at is null) then
    raise exception 'That stage belongs to another project';
  end if;
  if new.status = 'blocked' then
    if length(trim(coalesce(new.blocked_reason, ''))) = 0 then raise exception 'Say what is blocking this task'; end if;
    if new.delay_type is null then raise exception 'Choose the cause of the blocker'; end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'blocked' and new.status <> 'blocked' then
    if new.status <> 'cancelled' and exists (select 1 from blockers b where b.task_id = new.id and b.resolved_at is null) then
      raise exception 'This task has an open blocker. Mark the blocker as resolved first';
    end if;
    new.blocked_reason := null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    new.reviewed_at := null;
  end if;
  if not new.requires_review then new.reviewed_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_tasks_validate on tasks;
create trigger trg_tasks_validate before insert or update on tasks
  for each row execute function validate_task();

-- After a task changes: record re-plans (with reason), keep blockers in
-- step, and tell the right people.
create or replace function track_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(current_setting('app.change_reason', true)), '');
  v_bulk boolean := coalesce(current_setting('app.bulk_tasks', true), '') = 'on';
  v_actor uuid := auth.uid();
  v_project text; v_rec uuid; v_old text; v_new text;
begin
  select name into v_project from projects where id = new.project_id;

  if tg_op = 'UPDATE' and new.deleted_at is null then
    if old.due_date is not null and new.due_date is distinct from old.due_date then
      if v_reason is null and v_actor is not null then raise exception 'Give a reason for changing the deadline'; end if;
      insert into schedule_changes (project_id, entity_type, entity_id, change, old_value, new_value, reason, changed_by)
      values (new.project_id, 'task', new.id, 'due_date', fmt_day(old.due_date), coalesce(fmt_day(new.due_date), 'no deadline'), v_reason, v_actor);
    end if;
    if old.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
      if v_reason is null and v_actor is not null then raise exception 'Give a reason for reassigning this task'; end if;
      select full_name into v_old from profiles where id = old.assigned_to;
      select full_name into v_new from profiles where id = new.assigned_to;
      insert into schedule_changes (project_id, entity_type, entity_id, change, old_value, new_value, reason, changed_by)
      values (new.project_id, 'task', new.id, 'assignee', v_old, coalesce(v_new, 'Unassigned'), v_reason, v_actor);
    end if;
  end if;

  -- Blocked without a blocker record (e.g. set by a manager): create one
  if new.status = 'blocked' and (tg_op = 'INSERT' or old.status <> 'blocked')
     and not exists (select 1 from blockers b where b.task_id = new.id and b.resolved_at is null) then
    insert into blockers (project_id, task_id, stage_id, description, delay_type, raised_by)
    values (new.project_id, new.id, new.stage_id, new.blocked_reason, new.delay_type, coalesce(v_actor, new.created_by, new.assigned_to));
  end if;
  -- A cancelled task closes its blockers
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    update blockers set resolved_at = now(), resolved_by = v_actor, resolution_note = 'Task cancelled'
     where task_id = new.id and resolved_at is null;
  end if;

  -- New assignee
  if not v_bulk and new.deleted_at is null and new.assigned_to is not null and new.assigned_to is distinct from v_actor
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) and new.status not in ('completed', 'cancelled') then
    perform notify(new.assigned_to, new.project_id, 'task.assigned', 'New task: ' || new.title,
      v_project || case when new.due_date is not null then ' · due ' || fmt_day(new.due_date) else '' end,
      task_link(new.assigned_to, new.id), 'task', new.id, new.priority = 'critical', null);
  end if;
  -- Deadline moved for the same person
  if tg_op = 'UPDATE' and new.deleted_at is null and new.assigned_to is not null and new.assigned_to = old.assigned_to
     and new.assigned_to is distinct from v_actor and old.due_date is not null and new.due_date is distinct from old.due_date then
    perform notify(new.assigned_to, new.project_id, 'task.rescheduled', 'Deadline changed: ' || new.title,
      'Now due ' || coalesce(fmt_day(new.due_date), 'with no fixed date') || ' (was ' || fmt_day(old.due_date) || ').',
      task_link(new.assigned_to, new.id), 'task', new.id, false, null);
  end if;
  -- Completed: tell the reviewer (or the project's managers), then release waiting tasks
  if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
    for v_rec in
      select new.reviewer_id where new.reviewer_id is not null
      union select project_manager_ids(new.project_id) where new.reviewer_id is null
    loop
      continue when v_rec = v_actor;
      perform notify(v_rec, new.project_id, 'task.completed',
        case when new.requires_review then 'Ready for your review: ' else 'Task completed: ' end || new.title,
        v_project || ' · ' || coalesce((select full_name from profiles where id = coalesce(v_actor, new.assigned_to)), 'Team') || ' marked it complete.',
        task_link(v_rec, new.id), 'task', new.id, false, null);
    end loop;
    perform release_ready_tasks('task', new.id, '"' || new.title || '"');
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    perform release_ready_tasks('task', new.id, '"' || new.title || '" was cancelled and');
  end if;
  return new;
end $$;
drop trigger if exists trg_tasks_track on tasks;
create trigger trg_tasks_track after insert or update on tasks
  for each row execute function track_task_change();

-- Dependencies: same project, no loops
create or replace function validate_task_dependency() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  select project_id into v_pid from tasks where id = new.task_id;
  if new.depends_on_task_id is not null then
    if (select project_id from tasks where id = new.depends_on_task_id) is distinct from v_pid then
      raise exception 'A task can only wait for tasks of the same project';
    end if;
    if exists (
      with recursive up(id) as (
        select new.depends_on_task_id
        union
        select d.depends_on_task_id from task_dependencies d join up on d.task_id = up.id where d.depends_on_task_id is not null
      ) select 1 from up where id = new.task_id) then
      raise exception 'That would make the tasks wait for each other in a loop';
    end if;
  elsif new.depends_on_approval_id is not null then
    if (select project_id from approvals where id = new.depends_on_approval_id) is distinct from v_pid then
      raise exception 'That approval belongs to another project';
    end if;
  elsif (select project_id from purchase_requirements where id = new.depends_on_purchase_id) is distinct from v_pid then
    raise exception 'That purchase item belongs to another project';
  end if;
  return new;
end $$;
drop trigger if exists trg_task_dependencies_validate on task_dependencies;
create trigger trg_task_dependencies_validate before insert or update on task_dependencies
  for each row execute function validate_task_dependency();

-- Approved designs and delivered client purchases free up waiting tasks
create or replace function approvals_release_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    perform release_ready_tasks('approval', new.id, 'The client approved "' || new.title || '"');
  end if;
  return new;
end $$;
drop trigger if exists trg_approvals_release_tasks on approvals;
create trigger trg_approvals_release_tasks after update on approvals
  for each row execute function approvals_release_tasks();

create or replace function purchases_release_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('delivered', 'installed', 'cancelled') and old.status not in ('delivered', 'installed', 'cancelled') then
    perform release_ready_tasks('purchase', new.id, '"' || new.item_name || '" (client purchase)');
  end if;
  return new;
end $$;
drop trigger if exists trg_purchases_release_tasks on purchase_requirements;
create trigger trg_purchases_release_tasks after update on purchase_requirements
  for each row execute function purchases_release_tasks();

-- Tell the managers about a new blocker
create or replace function notify_blocker() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rec uuid; v_title text; v_who text; v_project text;
begin
  select title into v_title from tasks where id = new.task_id;
  select full_name into v_who from profiles where id = new.raised_by;
  select name into v_project from projects where id = new.project_id;
  for v_rec in select project_manager_ids(new.project_id) loop
    continue when v_rec = new.raised_by;
    perform notify(v_rec, new.project_id, 'task.blocked',
      'Blocker · ' || v_project || ': ' || coalesce(v_title, left(new.description, 60)),
      coalesce(v_who, 'Team') || ' (' || delay_label(new.delay_type) || '): ' || left(new.description, 180),
      case when new.task_id is not null then '/m/tasks/' || new.task_id else '/m/projects/' || new.project_id || '/schedule' end,
      'blocker', new.id, true, 'blocker:' || new.id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_blockers_notify on blockers;
create trigger trg_blockers_notify after insert on blockers
  for each row execute function notify_blocker();

-- ---------------------------------------------------------------------
-- 6. WORKFLOW FUNCTIONS (each checks permissions itself)
-- ---------------------------------------------------------------------
-- Flag a blocker on a task or on the project
create or replace function blocker_raise(payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid := nullif(payload ->> 'project_id', '')::uuid;
  v_task uuid := nullif(payload ->> 'task_id', '')::uuid;
  v_stage uuid := nullif(payload ->> 'stage_id', '')::uuid;
  v_desc text := trim(coalesce(payload ->> 'description', ''));
  v_type delay_type; t tasks; v_id uuid;
begin
  if v_task is not null then
    select * into t from tasks where id = v_task and deleted_at is null;
    if t.id is null then raise exception 'Task not found' using errcode = '42501'; end if;
    v_pid := t.project_id;
    v_stage := coalesce(v_stage, t.stage_id);
    if t.status in ('completed', 'cancelled') then raise exception 'This task is already closed'; end if;
  end if;
  if v_pid is null or not is_project_staff(v_pid) then
    raise exception 'Only the project team can flag blockers' using errcode = '42501';
  end if;
  if length(v_desc) = 0 then raise exception 'Describe what is blocking the work'; end if;
  begin
    v_type := (payload ->> 'delay_type')::delay_type;
  exception when others then v_type := null;
  end;
  if v_type is null then raise exception 'Choose the cause of the blocker'; end if;
  if v_stage is not null and not exists (select 1 from project_stages where id = v_stage and project_id = v_pid) then
    raise exception 'That stage belongs to another project';
  end if;

  insert into blockers (project_id, task_id, stage_id, description, delay_type, raised_by)
  values (v_pid, v_task, v_stage, v_desc, v_type, auth.uid()) returning id into v_id;
  if t.id is not null then
    update tasks set status = 'blocked', blocked_reason = left(v_desc, 500), delay_type = v_type where id = t.id;
  end if;
  return v_id;
end $$;

-- Resolve a blocker; the task goes back to "in progress" when nothing else blocks it
create or replace function blocker_resolve(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b blockers; v_rec uuid; v_title text;
begin
  select * into b from blockers where id = p_id for update;
  if b.id is null or not is_project_staff(b.project_id) then raise exception 'Blocker not found' using errcode = '42501'; end if;
  if b.resolved_at is not null then raise exception 'This blocker is already resolved'; end if;
  if not (can_manage_project(b.project_id) or b.raised_by = auth.uid()
          or exists (select 1 from tasks t where t.id = b.task_id and t.assigned_to = auth.uid())) then
    raise exception 'Only the project manager, the task''s assignee or the person who raised it can resolve this' using errcode = '42501';
  end if;
  update blockers set resolved_at = now(), resolved_by = auth.uid(), resolution_note = nullif(trim(coalesce(p_note, '')), '')
   where id = b.id;
  if b.task_id is not null and not exists (select 1 from blockers where task_id = b.task_id and resolved_at is null) then
    update tasks set status = 'in_progress' where id = b.task_id and status = 'blocked';
  end if;
  select title into v_title from tasks where id = b.task_id;
  for v_rec in
    select b.raised_by union select assigned_to from tasks where id = b.task_id and assigned_to is not null
  loop
    continue when v_rec = auth.uid();
    perform notify(v_rec, b.project_id, 'task.unblocked', 'Blocker resolved' || coalesce(': ' || v_title, ''),
      coalesce(nullif(trim(coalesce(p_note, '')), ''), left(b.description, 180)),
      case when b.task_id is not null then task_link(v_rec, b.task_id)
           when (select role from profiles where id = v_rec) in ('owner', 'admin', 'project_manager') then '/m/projects/' || b.project_id || '/schedule'
           else '/e/blockers' end,
      'blocker', b.id, false, 'unblock:' || b.id);
  end loop;
end $$;

-- Accept a completed task, or send it back with a note
create or replace function task_review(p_task uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task and deleted_at is null for update;
  if t.id is null or not (can_manage_project(t.project_id) or t.reviewer_id = auth.uid()) then
    raise exception 'Only the project manager or the task''s reviewer can review it' using errcode = '42501';
  end if;
  if t.status <> 'completed' or not t.requires_review or t.reviewed_at is not null then
    raise exception 'This task is not waiting for a review';
  end if;
  if p_accept then
    update tasks set reviewed_at = now() where id = t.id;
    if length(trim(coalesce(p_note, ''))) > 0 then
      insert into task_comments (task_id, author_id, body) values (t.id, auth.uid(), 'Review accepted: ' || trim(p_note));
    end if;
    if t.assigned_to is not null and t.assigned_to <> auth.uid() then
      perform notify(t.assigned_to, t.project_id, 'task.accepted', 'Work accepted: ' || t.title,
        coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Your manager reviewed and accepted this task.'),
        task_link(t.assigned_to, t.id), 'task', t.id, false, null);
    end if;
  else
    if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say what needs to be redone'; end if;
    update tasks set status = 'in_progress' where id = t.id;
    insert into task_comments (task_id, author_id, body) values (t.id, auth.uid(), 'Sent back for rework: ' || trim(p_note));
    if t.assigned_to is not null and t.assigned_to <> auth.uid() then
      perform notify(t.assigned_to, t.project_id, 'task.returned', 'Rework needed: ' || t.title, left(trim(p_note), 200),
        task_link(t.assigned_to, t.id), 'task', t.id, true, null);
    end if;
  end if;
end $$;

-- Add a stage's standard tasks from the templates (skips ones already added)
create or replace function stage_add_template_tasks(p_stage uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare s project_stages; tt record; v_assignee uuid; v_start date; v_due date; n integer := 0; v_tpl uuid;
begin
  select * into s from project_stages where id = p_stage and deleted_at is null;
  if s.id is null or not can_manage_project(s.project_id) then
    raise exception 'Only the project''s manager can add tasks' using errcode = '42501';
  end if;
  v_tpl := coalesce(s.template_id, (select st.id from stage_templates st join projects p on p.organisation_id = st.organisation_id
                                     where p.id = s.project_id and lower(st.name) = lower(s.name) limit 1));
  if v_tpl is null then return 0; end if;
  for tt in select * from task_templates where stage_template_id = v_tpl and is_active order by offset_days, title loop
    continue when exists (select 1 from tasks where stage_id = s.id and template_id = tt.id and deleted_at is null);
    v_assignee := null;
    if tt.default_assignee_role is not null then
      select m.profile_id into v_assignee from project_members m join profiles pr on pr.id = m.profile_id and pr.is_active and pr.deleted_at is null
       where m.project_id = s.project_id and m.member_role = tt.default_assignee_role and m.removed_at is null
       order by m.is_primary desc, m.created_at limit 1;
    end if;
    v_start := null; v_due := null;
    if s.start_date is not null then
      v_start := s.start_date + tt.offset_days;
      v_due := v_start + greatest(tt.duration_days, 1) - 1;
      if s.planned_end_date is not null then
        v_start := least(v_start, s.planned_end_date);
        v_due := least(v_due, s.planned_end_date);
      end if;
    end if;
    insert into tasks (project_id, stage_id, template_id, title, description, assigned_to, created_by, start_date, due_date,
                       priority, requires_review)
    values (s.project_id, s.id, tt.id, tt.title, tt.description, v_assignee, auth.uid(), v_start, v_due,
            tt.default_priority, tt.requires_review);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Set up a project's schedule from the default stages, one after another,
-- each waiting for the previous one; optionally with the standard tasks.
create or replace function project_apply_stage_template(p_project uuid, p_start date, p_with_tasks boolean default true)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_cursor date := p_start; v_prev uuid; v_stage uuid; st record; v_order integer := 0; v_end date;
        r record; v_pname text;
begin
  if not can_manage_project(p_project) then
    raise exception 'Only the project''s manager can set up its schedule' using errcode = '42501';
  end if;
  if p_start is null then raise exception 'Choose the date work starts'; end if;
  if exists (select 1 from project_stages where project_id = p_project and deleted_at is null) then
    raise exception 'This project already has stages. Add or remove stages one by one instead';
  end if;
  select organisation_id, name into v_org, v_pname from projects where id = p_project;
  perform set_config('app.bulk_tasks', 'on', true);
  for st in select * from stage_templates where organisation_id = v_org and is_active order by sort_order, name loop
    v_order := v_order + 1;
    v_end := v_cursor + greatest(coalesce(st.default_duration_days, 1), 1) - 1;
    insert into project_stages (project_id, template_id, name, description, sort_order, start_date, planned_end_date, is_milestone, created_by)
    values (p_project, st.id, st.name, st.description, v_order, v_cursor, v_end, st.is_milestone, auth.uid())
    returning id into v_stage;
    if v_prev is not null then
      insert into stage_dependencies (stage_id, depends_on_stage_id) values (v_stage, v_prev);
    end if;
    if p_with_tasks then perform stage_add_template_tasks(v_stage); end if;
    v_prev := v_stage;
    v_cursor := v_end + 1;
  end loop;
  perform set_config('app.bulk_tasks', 'off', true);
  if v_order = 0 then raise exception 'No default stages are set up yet. Add them under Settings first'; end if;
  -- One summary message per person instead of one per task
  for r in select assigned_to, count(*) as n, min(due_date) as first_due from tasks
            where project_id = p_project and deleted_at is null and assigned_to is not null and assigned_to <> auth.uid()
              and created_at >= now() - interval '1 minute' group by assigned_to loop
    perform notify(r.assigned_to, p_project, 'task.assigned', r.n || ' new task' || case when r.n = 1 then '' else 's' end || ' on ' || v_pname,
      'The project schedule is set up.' || coalesce(' Your first task is due ' || fmt_day(r.first_due) || '.', ''),
      case when (select role from profiles where id = r.assigned_to) in ('owner', 'admin', 'project_manager') then '/m/tasks' else '/e/tasks' end,
      'project', p_project, false, 'setup:' || p_project || ':' || r.assigned_to);
  end loop;
  return v_order;
end $$;

-- Default standard tasks for each default stage (an organisation can edit
-- them under Settings). Only adds them where an organisation has none.
create or replace function seed_default_task_templates(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if exists (select 1 from task_templates where organisation_id = p_org) then return 0; end if;
  insert into task_templates (organisation_id, stage_template_id, title, default_priority, default_assignee_role, offset_days, duration_days, requires_review)
  select p_org, st.id, v.title, v.prio::priority_level, v.role::project_member_role, v.off, v.dur, v.review
    from (values
      ('Project onboarding', 'Kick-off meeting with the client', 'high', 'project_manager', 0, 1, false),
      ('Project onboarding', 'Share the project schedule with the client', 'medium', 'project_manager', 1, 2, false),
      ('Site measurement', 'Measure the site and record all dimensions', 'high', 'site_supervisor', 0, 2, true),
      ('Site measurement', 'Upload site measurement photos', 'medium', 'site_supervisor', 1, 2, false),
      ('Design development', 'Prepare layout options and mood board', 'high', 'designer', 0, 5, false),
      ('Design development', 'Prepare 3D views', 'medium', 'designer', 5, 7, true),
      ('Design finalisation', 'Send final designs for client approval', 'high', 'designer', 0, 2, false),
      ('Design finalisation', 'Prepare working drawings for site and factory', 'high', 'designer', 2, 5, true),
      ('Material finalisation', 'Finalise laminates, hardware and finishes with the client', 'high', 'designer', 0, 4, false),
      ('Material finalisation', 'Place material orders with vendors', 'high', 'project_manager', 4, 3, false),
      ('Civil work', 'Mark civil changes on site', 'medium', 'site_supervisor', 0, 1, false),
      ('Civil work', 'Civil work completion check', 'medium', 'site_supervisor', 8, 2, true),
      ('Electrical and plumbing', 'Mark electrical and plumbing points with the client', 'high', 'site_supervisor', 0, 2, false),
      ('Electrical and plumbing', 'Pressure-test plumbing lines', 'high', 'site_supervisor', 6, 2, true),
      ('False ceiling', 'Check ceiling framing before boarding', 'medium', 'site_supervisor', 2, 1, true),
      ('Painting and wall finishes', 'Inspect putty and primer before final coats', 'medium', 'site_supervisor', 3, 1, false),
      ('Carpentry', 'Send cutting list to the factory', 'high', 'execution', 0, 2, false),
      ('Carpentry', 'Follow up factory production', 'medium', 'project_manager', 3, 10, false),
      ('Carpentry', 'Carpentry quality check', 'high', 'site_supervisor', 17, 3, true),
      ('Kitchen installation', 'Install kitchen units and countertop', 'high', 'execution', 0, 4, true),
      ('Kitchen installation', 'Coordinate hob, sink and chimney fitting', 'medium', 'site_supervisor', 3, 2, false),
      ('Wardrobe installation', 'Install wardrobes and fit hardware', 'high', 'execution', 0, 4, true),
      ('Furniture and lighting', 'Install lights and fixtures', 'medium', 'execution', 0, 3, false),
      ('Client-supplied item installation', 'Confirm delivery of client-supplied items', 'high', 'project_manager', 0, 1, false),
      ('Client-supplied item installation', 'Install client-supplied items', 'medium', 'execution', 1, 2, false),
      ('Final finishing', 'Deep cleaning of the home', 'medium', 'site_supervisor', 3, 2, false),
      ('Snag rectification', 'Walkthrough with the client and list snags', 'high', 'project_manager', 0, 1, false),
      ('Snag rectification', 'Close all snags', 'high', 'site_supervisor', 1, 4, true),
      ('Handover', 'Handover walkthrough and key handover', 'critical', 'project_manager', 0, 1, false)
    ) as v(stage, title, prio, role, off, dur, review)
    join stage_templates st on st.organisation_id = p_org and lower(st.name) = lower(v.stage);
  get diagnostics n = row_count;
  update stage_templates set is_milestone = true
   where organisation_id = p_org and lower(name) in ('design finalisation', 'material finalisation', 'handover');
  return n;
end $$;

do $$
declare o uuid;
begin
  for o in select id from organisations loop
    perform seed_default_task_templates(o);
  end loop;
end $$;

-- Tasks that were already marked blocked get a blocker record
insert into blockers (project_id, task_id, stage_id, description, delay_type, raised_by, created_at)
select t.project_id, t.id, t.stage_id, coalesce(nullif(trim(t.blocked_reason), ''), 'Blocked'), coalesce(t.delay_type, 'company'),
       coalesce(t.assigned_to, t.created_by), t.updated_at
  from tasks t
 where t.status = 'blocked' and t.deleted_at is null and coalesce(t.assigned_to, t.created_by) is not null
   and not exists (select 1 from blockers b where b.task_id = t.id and b.resolved_at is null);

-- ---------------------------------------------------------------------
-- 7. PROJECT HEALTH now also counts open blockers and delayed stages
-- ---------------------------------------------------------------------
drop view if exists project_health;
create view project_health with (security_invoker = true) as
with s as (
  select p.id as project_id,
    (select count(*) from project_stages st where st.project_id = p.id and st.deleted_at is null
       and st.status not in ('completed', 'skipped') and st.planned_end_date < today_ist())       as overdue_stages,
    (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null
       and t.status not in ('completed', 'cancelled') and t.due_date < today_ist())               as overdue_tasks,
    (select count(*) from blockers b where b.project_id = p.id and b.resolved_at is null)          as blocked_tasks,
    (select count(*) from approvals a where a.project_id = p.id and a.deleted_at is null
       and a.status = 'pending' and a.deadline < today_ist())                                     as overdue_approvals,
    (select count(*) from approvals a where a.project_id = p.id and a.deleted_at is null
       and a.status in ('pending', 'query_raised', 'changes_requested'))                          as open_approvals,
    (p.target_handover_date is not null and p.actual_handover_date is null
       and p.target_handover_date < today_ist())                                                  as handover_missed,
    (p.target_handover_date is not null and p.actual_handover_date is null
       and p.target_handover_date between today_ist() and today_ist() + 14)                       as handover_near,
    (select count(*) from project_stages st where st.project_id = p.id and st.deleted_at is null
       and st.status = 'delayed' and coalesce(st.planned_end_date >= today_ist(), true))          as delayed_stages
  from projects p
  where p.deleted_at is null and p.status in ('active', 'on_hold')
)
select s.*,
  case
    when handover_missed or overdue_stages > 0 or overdue_approvals > 1 or blocked_tasks > 2 then 'red'
    when overdue_tasks > 0 or blocked_tasks > 0 or overdue_approvals > 0 or handover_near or delayed_stages > 0 then 'amber'
    else 'green'
  end as health,
  array_remove(array[
    case when handover_missed then 'Handover date has passed' end,
    case when overdue_stages > 0 then overdue_stages || ' stage(s) behind schedule' end,
    case when delayed_stages > 0 then delayed_stages || ' stage(s) marked delayed' end,
    case when overdue_approvals > 0 then overdue_approvals || ' client approval(s) overdue' end,
    case when blocked_tasks > 0 then blocked_tasks || ' open blocker(s)' end,
    case when overdue_tasks > 0 then overdue_tasks || ' overdue task(s)' end,
    case when handover_near then 'Handover within 14 days' end
  ], null) as reasons
from s;
grant select on project_health to authenticated;

-- ---------------------------------------------------------------------
-- 8. DAILY REMINDERS now include tasks and stages
-- Tasks: the day before, on the day, 1 day after (assignee + managers),
-- then every 3 days to the assignee (same limit as payments).
-- Stages: managers are told the day after a stage misses its end date.
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

  insert into reminder_runs (run_for, notifications_created, triggered_by) values (v_today, v_total, auth.uid());
  return v_total;
end $$;

-- ---------------------------------------------------------------------
-- 9. WHO MAY CALL WHAT
-- ---------------------------------------------------------------------
revoke all on function task_link(uuid, uuid) from public, anon, authenticated;
revoke all on function task_dependency_met(task_dependencies) from public, anon, authenticated;
revoke all on function release_ready_tasks(text, uuid, text) from public, anon, authenticated;
revoke all on function seed_default_task_templates(uuid) from public, anon, authenticated;
revoke all on function blocker_raise(jsonb) from public, anon;
revoke all on function blocker_resolve(uuid, text) from public, anon;
revoke all on function task_review(uuid, boolean, text) from public, anon;
revoke all on function stage_add_template_tasks(uuid) from public, anon;
revoke all on function project_apply_stage_template(uuid, date, boolean) from public, anon;
revoke all on function run_reminders(date) from public, anon;
grant execute on function blocker_raise(jsonb), blocker_resolve(uuid, text), task_review(uuid, boolean, text),
  stage_add_template_tasks(uuid), project_apply_stage_template(uuid, date, boolean), run_reminders(date) to authenticated;
grant execute on function run_reminders(date), seed_default_task_templates(uuid) to service_role;

-- >>> supabase/migrations/0006_quotations.sql
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

-- >>> supabase/migrations/0007_release4.sql
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
