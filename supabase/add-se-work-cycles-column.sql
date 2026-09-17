-- One-time migration: adds `se_work_cycles_json` to the live `tickets` table. schema.sql only
-- reflects this for a FRESH install (`create table`) — an existing database needs the ALTER
-- statement below. Run this once in the Supabase SQL editor.
--
-- Backs Account Creation's SE-execution-vs-peer-review cycle-time breakdown
-- (src/lib/account-creation-cycle.ts): per-"In Progress"-cycle { enteredAt, exitedAt,
-- assigneeAtEntry, assigneeAtExit }, the SE-side counterpart to the existing
-- peer_review_cycles_json column. Populated by the regular GAS sync going forward (any team with
-- has_in_progress_tracking already on); run runAccountCreationSeWorkCyclesRebackfill
-- (gas/Backfill.gs) afterward to fill it in for tickets already synced before this column existed.
--
-- After the Sheets-side backfill completes, run resetSupabaseMigration() then
-- runSupabaseMigration() to push the backfilled values into Supabase — runSupabaseMigration() is a
-- cursor-based one-time migration, so calling it again WITHOUT resetSupabaseMigration() first is a
-- silent no-op (see the memory note on this exact gotcha).
--
-- Safe to re-run: the statement is a no-op if already applied.

alter table tickets add column if not exists se_work_cycles_json jsonb;
