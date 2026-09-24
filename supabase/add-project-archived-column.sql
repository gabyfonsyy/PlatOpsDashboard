-- One-time migration: adds `archived` to the live `projects` table. `schema.sql`'s `create table
-- projects` has been updated to match for a fresh install -- an existing database needs the ALTER
-- statement below. Run once in the Supabase SQL editor.
--
-- Backs Records -> Project Tracking Phase 2 (project drill-down panel's Archive action) -- see
-- .claude/plans/fluffy-stargazing-dewdrop.md. A separate boolean rather than a new `status` value,
-- per the plan's own decision -- archiving is a lifecycle/visibility flag, not a workflow state.
--
-- Safe to re-run: a no-op if already applied.

alter table projects add column if not exists archived boolean not null default false;
