-- One-time migration: creates `project_phase_tickets`, for Records -> Project Tracking Phase 6
-- (phase-level Jira linking). See .claude/plans/fluffy-stargazing-dewdrop.md, section "Phase 6".
-- `schema.sql` has been updated to create it on a fresh install too -- run this file once against
-- an EXISTING database.
--
-- Project-level ticket linking is UNTOUCHED -- it stays on `ticket_project_map` /
-- `InitiativeTicketsTable.tsx` exactly as Phase 0 left it. This is an ADDITIONAL, phase-scoped
-- link a ticket can also have, not a replacement.
--
-- Safe to re-run: `create table if not exists` is a no-op if already applied.

create table if not exists project_phase_tickets (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references project_phases(id) on delete cascade,
  project_id uuid not null references projects(project_id) on delete cascade,
  issue_key text not null,
  assigned_by text,
  assigned_at timestamptz not null default now(),
  unique (phase_id, issue_key)
);

create index if not exists project_phase_tickets_project_idx on project_phase_tickets (project_id);

alter table project_phase_tickets enable row level security;
