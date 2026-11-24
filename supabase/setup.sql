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
