-- Platform Operations Dashboard — Supabase schema (Phase 1 of Sheets -> Supabase migration)
-- Run this once in the Supabase SQL editor against a fresh project.
-- Mirrors the three Google Sheets workbooks (Jira Data, Manager Data, Initiatives) documented
-- in the migration sketch, with two deliberate departures from the Sheets shape:
--   1. RAW_<team>_<year> year-sharded tabs collapse into one `tickets` table (team_key + created,
--      indexed) — the sharding was a Sheets performance workaround, not a real data boundary.
--   2. INITIATIVE_TICKETS_<team> per-team tabs collapse into one `initiative_tickets` table
--      with a team_key column, for the same reason.
--
-- All tables have RLS enabled with no policies: only the service_role key (used server-side by
-- Apps Script and the Next.js API routes) can read/write. The anon/authenticated roles get zero
-- access by default, which is the correct posture for a tool with no client-side Supabase calls.

create extension if not exists pgcrypto;

-- ============================================================================
-- Workbook 1: Jira Data
-- ============================================================================

create table teams_config (
  team_key text primary key,
  team_name text not null,
  jira_project_key text not null,
  resolved_date_field_type text not null check (resolved_date_field_type in ('native', 'text')),
  resolved_date_field_id text,
  assignee_field_id text,
  has_fcr_escalation boolean not null default false,
  has_holding_reason boolean not null default false,
  has_rejection_category boolean not null default false,
  has_cancellation_reason boolean not null default false,
  backlog_status_names_csv text,
  issue_types_csv text,
  color_accent text,
  active boolean not null default true,
  sort_order integer not null default 0,
  has_in_progress_tracking boolean not null default false,
  has_peer_review_tracking boolean not null default false
);

create table tickets (
  issue_key text primary key,
  team_key text not null references teams_config(team_key),
  project_key text not null,
  issue_type text not null,
  status text not null,
  created timestamptz not null,
  updated timestamptz not null,
  resolved_datetime timestamptz,
  resolved_raw_text text,
  first_out_of_backlog_todo timestamptz,
  fcr_value text,
  escalation_value text,
  assigned_se text,
  assigned_cod text,
  due_date date,
  product text,
  holding_reasons_json jsonb,
  rejection_category text,
  cancellation_reason text,
  total_on_hold_minutes numeric,
  total_in_progress_minutes numeric,
  assignee_display_name text,
  reporter_display_name text,
  last_synced_at timestamptz not null default now(),
  peer_review_cycles_json jsonb,
  cycle_time_start timestamptz,
  cycle_time_end timestamptz,
  labels text
);

create index tickets_team_created_idx on tickets (team_key, created);
create index tickets_team_resolved_idx on tickets (team_key, resolved_datetime);
create index tickets_team_issue_type_idx on tickets (team_key, issue_type);
create index tickets_due_date_idx on tickets (due_date);
create index tickets_assignee_idx on tickets (team_key, assignee_display_name);

create table metrics_daily (
  team_key text not null references teams_config(team_key),
  issue_type text not null,
  date date not null,
  tickets_created_count integer not null default 0,
  tickets_resolved_count integer not null default 0,
  tickets_resolved_on_date integer not null default 0,
  overdue_resolved_on_date integer not null default 0,
  fcr_yes_resolved_on_date integer not null default 0,
  escalation_qualifying_resolved_on_date integer not null default 0,
  lead_time_sum_minutes numeric not null default 0,
  lead_time_count integer not null default 0,
  cycle_time_sum_minutes numeric not null default 0,
  cycle_time_count integer not null default 0,
  fcr_eligible_count integer not null default 0,
  fcr_not_escalated_count integer not null default 0,
  escalated_count integer not null default 0,
  resolved_after_due_count integer not null default 0,
  total_for_aging_denominator integer not null default 0,
  assigned_count integer not null default 0,
  holding_reason_json jsonb,
  rejection_category_json jsonb,
  cancellation_reason_json jsonb,
  on_hold_pickup_sum_minutes numeric not null default 0,
  on_hold_pickup_count integer not null default 0,
  peer_review_wait_sum_minutes numeric not null default 0,
  peer_review_wait_count integer not null default 0,
  primary key (team_key, issue_type, date)
);

create table metrics_by_assignee_monthly (
  team_key text not null references teams_config(team_key),
  assignee_display_name text not null,
  month text not null, -- yyyy-MM
  tickets_assigned integer not null default 0,
  tickets_resolved integer not null default 0,
  tickets_resolved_in_month integer not null default 0,
  overdue_resolved_in_month integer not null default 0,
  fcr_yes_resolved_in_month integer not null default 0,
  escalation_qualifying_resolved_in_month integer not null default 0,
  escalated_count integer not null default 0,
  fcr_eligible_count integer not null default 0,
  fcr_not_escalated_count integer not null default 0,
  resolved_after_due_count integer not null default 0,
  avg_lead_time_minutes numeric,
  avg_cycle_time_minutes numeric,
  avg_in_progress_minutes numeric,
  primary key (team_key, assignee_display_name, month)
);

create table sync_checkpoint (
  project_key text primary key,
  last_synced_updated_ts timestamptz,
  last_sync_status text check (last_sync_status in ('SUCCESS', 'FAILED')),
  last_sync_run_at timestamptz,
  last_sync_error_message text,
  last_full_backfill_completed_at timestamptz,
  tickets_synced_last_run integer,
  backfill_cursor text
);

create table agg_checkpoint (
  team_key text primary key references teams_config(team_key),
  last_aggregated_at timestamptz,
  dirty_dates_json jsonb not null default '[]'::jsonb
);

create table error_log (
  id bigint generated always as identity primary key,
  "timestamp" timestamptz not null default now(),
  team_key text,
  issue_key text,
  field text,
  raw_value text,
  error_message text
);

-- ============================================================================
-- Workbook 2: Manager Data
-- ============================================================================

-- roster/leave/rto.team_key are deliberately NOT foreign keys into teams_config: these are
-- manager-typed free text in the source sheets, with no validation there today, and can
-- legitimately hold a team outside the three Jira-tracked ones (e.g. 'EL') — the migration hit
-- exactly that on ROSTER. Enforcing an FK here would reject real, valid data.

create table roster (
  id bigint generated always as identity primary key,
  employee_name text not null unique,
  team_key text,
  role_title text,
  status text,
  start_date date,
  jira_display_name_alias text
);

create table leave (
  leave_id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  team_key text,
  leave_type text,
  start_date date not null,
  end_date date not null,
  num_days numeric,
  half_day_period text check (half_day_period in ('First Half', 'Second Half') or half_day_period is null),
  status text not null default 'Approved',
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rto (
  rto_id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  team_key text,
  date date not null,
  attendance_type text not null check (attendance_type in ('In-Office', 'Remote', 'Absent')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_name, date)
);

create table insights_cache (
  id bigint generated always as identity primary key,
  scope_key text not null,
  period_label text not null,
  narrative_text text,
  flags_json jsonb,
  generated_at timestamptz not null default now(),
  model_used text,
  generation_status text,
  error_message text,
  unique (scope_key, period_label)
);

create table app_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Workbook 3: Initiatives
-- ============================================================================

create table projects (
  project_id uuid primary key default gen_random_uuid(),
  project_name text not null,
  owning_team text,
  teams_involved text default '',
  owner text,
  status text not null default 'Not Started',
  tracking_mode text not null default 'manual' check (tracking_mode in ('manual', 'scheduled', 'tasks')),
  start_date date,
  target_date date,
  percent_complete numeric default 0,
  jira_label text default '',
  total_items integer,
  batch_size integer,
  batches_per_week integer,
  weekly_plan_json jsonb not null default '[]'::jsonb,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table initiative_tickets (
  issue_key text not null,
  team_key text not null references teams_config(team_key),
  project_key text,
  summary text,
  issue_type text,
  status text,
  labels text,
  assignee_display_name text,
  reporter_display_name text,
  created timestamptz,
  updated timestamptz,
  duedate date,
  resolution text,
  resolved_datetime timestamptz,
  last_synced_at timestamptz not null default now(),
  primary key (team_key, issue_key)
);

create table ticket_project_map (
  issue_key text primary key,
  project_id uuid references projects(project_id),
  assigned_by text,
  assigned_at timestamptz not null default now()
);

create table project_progress (
  progress_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id),
  date date not null,
  issue_key text default '',
  items_processed integer not null default 0,
  notes text default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_tasks (
  task_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id),
  task_name text not null,
  issue_key text default '',
  done boolean not null default false,
  start_date date,
  target_date date,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Lock every table down to service_role only (no anon/authenticated policies)
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in (
        'teams_config', 'tickets', 'metrics_daily', 'metrics_by_assignee_monthly',
        'sync_checkpoint', 'agg_checkpoint', 'error_log', 'roster', 'leave', 'rto',
        'insights_cache', 'app_config', 'projects', 'initiative_tickets',
        'ticket_project_map', 'project_progress', 'project_tasks'
      )
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
