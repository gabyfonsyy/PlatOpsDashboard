-- ============================================================================
-- Business Review Prep — Review Prep checklist + Talking Points
--
-- Run this in the Supabase SQL editor. Fully idempotent (`if not exists` throughout), safe to
-- re-run and safe to run against a project that already has schema.sql / my-work.sql applied.
--
-- The metrics themselves (Ticket Volume, Lead/Cycle Time, Ageing Rate, P1 SLA, Automated Tickets,
-- FCR) are computed live from the existing `tickets`/`metrics_daily` tables (schema.sql) — nothing
-- here duplicates that data. Only the two things Gaby actually authors during prep are new state:
-- which prep-checklist items she's ticked off, and her edited talking points. Both are personal,
-- so both are keyed by `user_email` (the NextAuth session identity), same posture as my-work.sql.
--
-- The AI-authored narrative sentences (lib/business-review-ai.ts) do NOT get a new table here —
-- they're cached in the existing generic `ai_insight_cache` table (my-work.sql), which was built
-- generic specifically so the next AI feature would reuse it. See lib/business-review-store.ts.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Review Prep checklist. One row per (user, period, item) — `period_key` already encodes team +
-- mode + the period's start date (see lib/review-periods.ts's periodKey), so switching teams or
-- navigating to a different week/month/quarter never mixes up another period's checked state.
-- `item_key` is a stable slug for one of the static checklist items (brief section 10); the item
-- LABELS live in code, not in this table, so wording can change without a migration.
-- ----------------------------------------------------------------------------
create table if not exists business_review_checklist_state (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  period_key text not null,
  item_key text not null,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_email, period_key, item_key)
);

create index if not exists business_review_checklist_state_lookup_idx
  on business_review_checklist_state (user_email, period_key);

-- ----------------------------------------------------------------------------
-- Talking Points. Free-text, editable, ordered list per (user, period) — seeded from the
-- deterministic/AI-authored insight sentences when a period is first opened (see
-- lib/business-review.ts), then hers to edit before the actual review. `position` is a plain
-- integer sort key, not a linked list — good enough for a handful of points per period.
-- ----------------------------------------------------------------------------
create table if not exists business_review_talking_points (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  period_key text not null,
  content text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_review_talking_points_lookup_idx
  on business_review_talking_points (user_email, period_key, position);
