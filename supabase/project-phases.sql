-- One-time migration: creates `project_phases`, a new table (not a column addition), for Records
-- -> Project Tracking Phase 3 (phases + phase-aware Gantt). See
-- .claude/plans/fluffy-stargazing-dewdrop.md, section "Phase 3". `schema.sql` has been updated to
-- create this table on a fresh install too -- run this file once against an EXISTING database.
--
-- `project_id` is `uuid references projects(project_id)`, matching the live `projects` table's
-- real primary key type -- NOT the `text` type an earlier draft of the Phase 3 plan assumed before
-- Phase 0 discovered the real schema (see the plan's own "Phase 0 correction" note).
--
-- Safe to re-run: `create table if not exists` is a no-op if already applied.

create table if not exists project_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id) on delete cascade,
  name text not null,
  description text default '',
  owner text default '',
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'done')),
  progress integer not null default 0 check (progress between 0 and 100),
  start_date date,
  target_date date,
  actual_completion_date date,
  notes text default '',
  position integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_phases_project_position_idx
  on project_phases (project_id, position);

alter table project_phases enable row level security;
