-- One-time migration: creates `project_notes` and `project_activity_log`, two new tables, for
-- Records -> Project Tracking Phase 4 (notes + activity log). See
-- .claude/plans/fluffy-stargazing-dewdrop.md, section "Phase 4". `schema.sql` has been updated to
-- create both on a fresh install too -- run this file once against an EXISTING database.
--
-- `resolved` on `project_notes` only means something for `note_type = 'blocker'` today (Phase 5
-- derives "is this project blocked" from an unresolved blocker note) -- it's added now, alongside
-- the rest of the row shape, rather than as a second migration later.
--
-- Safe to re-run: `create table if not exists` is a no-op if already applied.

create table if not exists project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id) on delete cascade,
  phase_id uuid references project_phases(id) on delete cascade,
  note_type text not null default 'update'
    check (note_type in ('update', 'decision', 'risk', 'blocker', 'followup')),
  content text not null,
  author_email text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists project_notes_project_created_idx
  on project_notes (project_id, created_at desc);

create table if not exists project_activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(project_id) on delete cascade,
  event_type text not null,
  summary text not null,
  actor_email text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_activity_log_project_created_idx
  on project_activity_log (project_id, created_at desc);

alter table project_notes enable row level security;
alter table project_activity_log enable row level security;
