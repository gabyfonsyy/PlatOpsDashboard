-- One-time migration: adds `committed_date` and `batch_actuals_from_tickets` to the live
-- `projects` table. `schema.sql`'s `create table projects` has been updated to match for a fresh
-- install -- an existing database needs the ALTER statements below. Run once in the Supabase SQL
-- editor.
--
-- Backs Records -> Project Tracking's charter-import + ticket-driven-batch-actuals work -- see
-- .claude/plans/velvet-popping-newell.md. `committed_date` is "the date you'd defend in a
-- review," distinct from the working `target_date`. `batch_actuals_from_tickets` opt-in switches
-- a batch-tracked project's processed count to `linked tickets x batch_size` instead of manually
-- logged progress rows.
--
-- Safe to re-run: a no-op if already applied.

alter table projects add column if not exists committed_date date;
alter table projects add column if not exists batch_actuals_from_tickets boolean not null default false;
