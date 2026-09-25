-- One-time migration: creates `kpi_baselines`, a new table (not a column addition).
--
-- Stores a single locked-in reference value per (team, metric) — Q1+Q2 2026 actuals,
-- count-weighted across the two quarters — that the live dashboards compare current performance
-- against going forward. Distinct from the period-over-period `comparison` every deep-dive already
-- computes: that one is a rolling "vs previous period of the same length", this one is a fixed
-- point in time that only changes when explicitly recomputed (see
-- src/app/api/admin/kpi-baselines/recompute/route.ts). `schema.sql` has been updated to create this
-- table on a fresh install too -- run this file once against an EXISTING database.
--
-- `value` is stored in the SAME units the live reports already use (minutes for lead_time/
-- cycle_time_*, a 0-1 fraction for fcr_rate/ageing_rate), so the existing formatters
-- (formatDaysValue/formatPercent) apply unchanged.
--
-- Safe to re-run: `create table if not exists` is a no-op if already applied.

create table if not exists kpi_baselines (
  team_key text not null references teams_config(team_key),
  metric text not null check (metric in (
    'lead_time', 'cycle_time_total', 'cycle_time_doer', 'cycle_time_validator',
    'fcr_rate', 'ageing_rate'
  )),
  value numeric,
  sample_count integer not null default 0,
  period_label text not null default '2026-Q1+Q2',
  computed_at timestamptz not null default now(),
  primary key (team_key, metric)
);

alter table kpi_baselines enable row level security;
