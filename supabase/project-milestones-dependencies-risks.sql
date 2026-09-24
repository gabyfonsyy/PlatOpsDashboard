-- One-time migration: creates `project_milestones`, `project_dependencies` and `project_risks`,
-- three new tables, for Records -> Project Tracking Phase 5. See
-- .claude/plans/fluffy-stargazing-dewdrop.md, section "Phase 5". `schema.sql` has been updated to
-- create all three on a fresh install too -- run this file once against an EXISTING database.
--
-- Blockers deliberately do NOT get their own table here -- per the plan, they reuse
-- `project_notes` (`note_type = 'blocker'`, the `resolved` column Phase 4 already added but left
-- unwired). `isBlocked()` in lib/project-tracking.ts derives "has an unresolved blocker note."
--
-- Safe to re-run: `create table if not exists` is a no-op if already applied.

create table if not exists project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id) on delete cascade,
  name text not null,
  done boolean not null default false,
  target_date date,
  position integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_milestones_project_position_idx
  on project_milestones (project_id, position);

create table if not exists project_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id) on delete cascade,
  phase_id uuid references project_phases(id) on delete cascade,
  label text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists project_dependencies_project_idx on project_dependencies (project_id);

create table if not exists project_risks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id) on delete cascade,
  risk text not null,
  impact text check (impact in ('low', 'medium', 'high')),
  likelihood text check (likelihood in ('low', 'medium', 'high')),
  mitigation text default '',
  owner text default '',
  status text not null default 'open' check (status in ('open', 'mitigated', 'closed')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_risks_project_idx on project_risks (project_id);

alter table project_milestones enable row level security;
alter table project_dependencies enable row level security;
alter table project_risks enable row level security;
