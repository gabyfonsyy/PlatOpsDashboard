-- ============================================================================
-- References — a personal dumping ground for links worth keeping (Sheets, Docs, random websites)
-- with a title and a quick description, so they're a search away instead of buried in Slack.
--
-- Run this in the Supabase SQL editor. Fully idempotent (`if not exists` throughout), so it is
-- safe to re-run and safe to run against a project that already has schema.sql / my-work.sql
-- applied.
--
-- Same posture as work_projects/work_tasks: keyed by user_email (the NextAuth session identity),
-- because this is personal, not team, data. Deliberately in Supabase rather than the Apps
-- Script/Sheets backend — see my-work.sql's note on latency; a bookmark list nobody can add to
-- in under a second is a bookmark list nobody uses.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists work_references (
  reference_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  title text not null,
  url text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_references_user_idx on work_references (user_email, created_at desc);

-- ----------------------------------------------------------------------------
-- Type + persistent display order, added 2026-09-04 so operational runbooks can be pinned above
-- everything else instead of sorting by whenever they happened to be added.
-- ----------------------------------------------------------------------------
alter table work_references
  add column if not exists reference_type text not null default 'Other'
    check (reference_type in ('Google Sheet', 'Google Doc', 'Website', 'Other')),
  add column if not exists display_order integer not null default 0;

create index if not exists work_references_user_order_idx on work_references (user_email, display_order);

-- Same lock-down as every other table: RLS on, no policies, service_role only.
alter table work_references enable row level security;
