-- One-time migration for the On-Hold Wait Time deep-dive ([team]/on-hold). Run this BEFORE pasting
-- the updated gas/JiraSync.gs + gas/SupabaseClient.gs: the sync starts sending `on_hold_cycles_json`
-- straight away, and Supabase rejects an upsert that names a column it doesn't have (the dual-write
-- swallows that error, so tickets would quietly stop updating in Supabase until this runs).
--
-- 1. `tickets.on_hold_cycles_json`: one object per On Hold episode,
--    { enteredAt, exitedAt, exitedToStatus, reason, assigneeAtEntry } (extractHoldingCyclesWithReasons_
--    in gas/JiraSync.gs). exitedAt is null while the ticket is still On Hold. The older
--    holding_reasons_json / total_on_hold_minutes columns stay as they are.
-- 2. Allows `on_hold_wait` + `on_hold_wait_p75` rows in `kpi_baselines`: average and P75 completed
--    On-Hold episode (minutes) over Q1+Q2 2026 — the P75 is the default stale-hold threshold. Includes every metric
--    from the earlier kpi_baselines migrations.
--
-- After this: paste the GAS files, run migrateAddOnHoldCyclesColumn, then runStHoldingRebackfill
-- (it re-processes every ST ticket ever On Hold since 2025-01-01 and writes each one through to
-- Supabase as it goes). Then click "Recompute Baseline". Safe to re-run.

alter table tickets add column if not exists on_hold_cycles_json jsonb;

alter table kpi_baselines drop constraint if exists kpi_baselines_metric_check;
alter table kpi_baselines add constraint kpi_baselines_metric_check check (metric in (
  'lead_time', 'cycle_time_total', 'cycle_time_doer', 'cycle_time_validator',
  'fcr_rate', 'ageing_rate', 'review_wait', 'automated_share', 'on_hold_wait', 'on_hold_wait_p75'
));
