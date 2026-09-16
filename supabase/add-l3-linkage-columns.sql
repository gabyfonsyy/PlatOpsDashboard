-- One-time migration: adds `l3_issue_key`, `l3_endorsed_at`, `l3_completed_at` to the live
-- `tickets` table. schema.sql only reflects this for a FRESH install (`create table`) — an
-- existing database needs the ALTER statements below. Run this once in the Supabase SQL editor.
--
-- Backs Account Creation's Phase 2 L3-linkage tracking (src/lib/account-creation-sla.ts):
-- l3_issue_key is the linked L3-#### ticket found on the ST ticket's issuelinks; l3_endorsed_at is
-- that L3 ticket's own `created` timestamp (the endorsement instant); l3_completed_at is the first
-- time the L3 ticket reached "For Checking" (drives both Day 2 and Day 3 completion). Populated by
-- the regular GAS sync going forward; run runL3LinkageRebackfill (gas/Backfill.gs) afterward to
-- fill it in for tickets already synced before this column existed.
--
-- After the Sheets-side backfill completes, run resetSupabaseMigration() then
-- runSupabaseMigration() to push the backfilled values into Supabase — runSupabaseMigration() is a
-- cursor-based one-time migration, so calling it again WITHOUT resetSupabaseMigration() first is a
-- silent no-op (see the memory note on this exact gotcha).
--
-- Safe to re-run: each statement is a no-op if already applied.

alter table tickets add column if not exists l3_issue_key text;
alter table tickets add column if not exists l3_endorsed_at timestamptz;
alter table tickets add column if not exists l3_completed_at timestamptz;
