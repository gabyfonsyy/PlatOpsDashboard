-- One-time migration: allows an `automated_share` row in `kpi_baselines`.
--
-- The Automated Tickets scorecard and deep-dive ([team]/automated) compare the automated share
-- (automated tickets ÷ tickets resolved, a 0-1 fraction) against its Q1+Q2 2026 value. Until this
-- runs, the database rejects that row, so the deep-dive computes the same value live and the team
-- scorecard shows no baseline line. "Recompute Baseline" keeps storing every other metric as before
-- (lib/kpi-baselines.ts upserts automated_share on its own so it can't fail the batch).
--
-- After running this, click "Recompute Baseline" on any team page to lock the value in. Safe to
-- re-run. Includes review_wait from add-kpi-baselines-review-wait.sql.

alter table kpi_baselines drop constraint if exists kpi_baselines_metric_check;
alter table kpi_baselines add constraint kpi_baselines_metric_check check (metric in (
  'lead_time', 'cycle_time_total', 'cycle_time_doer', 'cycle_time_validator',
  'fcr_rate', 'ageing_rate', 'review_wait', 'automated_share'
));
