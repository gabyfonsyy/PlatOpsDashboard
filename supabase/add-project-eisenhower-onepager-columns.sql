-- One-time migration: adds Phase 1 fields to the live `projects` table (Eisenhower priority,
-- health, one-pager, contributors, batch-tracking toggle). schema.sql's `create table projects`
-- has been updated to match for a FRESH install — an EXISTING database needs the ALTER
-- statements below. Run once in the Supabase SQL editor.
--
-- Backs Records -> Project Tracking Phase 1 (team pills, portfolio summary, Eisenhower matrix) --
-- see the plan at .claude/plans/fluffy-stargazing-dewdrop.md. `urgent`/`important` reuse the same
-- two-boolean Eisenhower model as My Work's work_tasks/work_projects (src/lib/work.ts's
-- quadrantOf/triageFor) -- NULL means "not sorted yet", not "neither".
--
-- Safe to re-run: every statement is a no-op if already applied.

alter table projects add column if not exists urgent boolean;
alter table projects add column if not exists important boolean;
alter table projects add column if not exists health text not null default ''
  check (health in ('on_track', 'at_risk', 'off_track', 'not_started', 'blocked', ''));
alter table projects add column if not exists batch_tracking_enabled boolean not null default false;
alter table projects add column if not exists contributors text[] not null default '{}';
alter table projects add column if not exists problem_context text;
alter table projects add column if not exists objective text;
alter table projects add column if not exists expected_outcome text;
alter table projects add column if not exists scope text;
alter table projects add column if not exists out_of_scope text;
alter table projects add column if not exists success_metrics text;

-- Backfill: batch_tracking_enabled decouples the batch-input UI from tracking_mode going forward
-- (see project-fields.tsx), but every existing "scheduled" project already relies on that UI being
-- visible with no action from her -- so preserve that without requiring her to re-check a new box
-- on every project she already set up.
update projects set batch_tracking_enabled = true where tracking_mode = 'scheduled';
