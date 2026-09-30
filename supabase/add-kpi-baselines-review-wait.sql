-- One-time migration: allows a `review_wait` row in `kpi_baselines`.
--
-- The Review Wait Time deep-dive ([team]/review-wait) uses the Q1+Q2 2026 average review wait
-- (per completed review cycle, in minutes) as its default target for "% within target" and the
-- over-target counts. Until this runs, the database rejects that row (the `metric` check
-- constraint only lists the original six), so the page computes the same value live instead and
-- the "Recompute Baseline" button stores every other metric as before (lib/kpi-baselines.ts's
-- storeTeamBaselines upserts review_wait separately so it can't fail the batch).
--
-- After running this, click "Recompute Baseline" on any team page (or POST
-- /api/admin/kpi-baselines/recompute) to lock the value in.
--
-- `kpi_baselines_metric_check` is the name Postgres gives the inline column check in
-- add-kpi-baselines-table.sql / schema.sql. Safe to re-run.

alter table kpi_baselines drop constraint if exists kpi_baselines_metric_check;
alter table kpi_baselines add constraint kpi_baselines_metric_check check (metric in (
  'lead_time', 'cycle_time_total', 'cycle_time_doer', 'cycle_time_validator',
  'fcr_rate', 'ageing_rate', 'review_wait'
));
