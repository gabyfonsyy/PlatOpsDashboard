-- ============================================================================
-- Site Monitoring snapshot — a cached copy of the Site Monitoring Google Sheet's `Final List`
-- tab, so opening the Site Monitoring page never waits on a live Sheet round-trip.
--
-- Run this in the Supabase SQL editor. Fully idempotent (`if not exists` throughout), so it is
-- safe to re-run.
--
-- The source sheet changes only ~quarterly (per Gaby), so treating it as a synchronous dependency
-- of every page visit was pure latency with no freshness benefit. This table holds the ONE most
-- recent successful sync — see src/lib/site-monitoring-store.ts and
-- src/app/api/site-monitoring/sync/route.ts. `synced_at` drives the "Last synced" timestamp on
-- the page; a failed sync simply never gets this far, so the previous row (and its timestamp)
-- stays exactly as it was.
--
-- Single row (id = 'current'), not per-user: this is shared operational data for the whole team,
-- not personal state. Same RLS posture as every other table: enabled with no policies, so the
-- server-side service_role key is the only way in.
-- ============================================================================

create table if not exists site_monitoring_snapshot (
  id text primary key default 'current',
  -- Array of SiteMonitoringClient (see src/lib/site-monitoring.ts) — already has Ecosystem
  -- derived and the raw FF columns stripped out by SiteMonitoringApi.gs before this is written.
  data jsonb not null,
  synced_at timestamptz not null default now()
);

alter table site_monitoring_snapshot enable row level security;
