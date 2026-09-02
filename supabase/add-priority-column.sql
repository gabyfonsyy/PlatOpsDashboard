-- One-time migration: adds `priority` to the live `tickets` table and `has_p1_sla_tracking` to
-- `teams_config`. schema.sql only reflects these for a FRESH install (`create table`) — an
-- existing database needs the ALTER statements below. Run this once in the Supabase SQL editor.
--
-- Backs the P1 SLA Compliance report (src/lib/p1-sla.ts). `priority` is populated by the regular
-- GAS sync going forward; run runPriorityRebackfill (gas/Backfill.gs) afterward to fill it in for
-- tickets already synced before this column existed. `has_p1_sla_tracking` gates the scorecard
-- card and defaults to false for every team — set it to TRUE for the ST row in TEAMS_CONFIG (the
-- Google Sheet, not this table — teams_config here is a dual-write mirror) after running
-- migrateAddP1SlaTrackingColumn (gas/Setup.gs), same as has_peer_review_tracking was turned on.
--
-- Safe to re-run: both statements are no-ops if already applied.

alter table tickets add column if not exists priority text;
create index if not exists tickets_team_priority_idx on tickets (team_key, priority);

alter table teams_config add column if not exists has_p1_sla_tracking boolean not null default false;
