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
