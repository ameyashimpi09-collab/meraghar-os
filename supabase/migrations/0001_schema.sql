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
