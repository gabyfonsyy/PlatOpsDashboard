-- ============================================================================
-- References — Category + Type taxonomy, additive on top of references.sql.
--
-- Every reference already has a title/url/description (references.sql) plus a hard-coded 4-value
-- reference_type. This adds two independently-managed, per-user lookup tables — Category (how she
-- organizes) and Type (what kind of resource it is) — and links work_references to both via
-- nullable FKs. Nothing here drops or rewrites existing data: reference_type and its CHECK
-- constraint stay exactly as they are, deprecated but untouched, so a half-applied migration can
-- never lose a reference or its URL.
--
-- Run this in the Supabase SQL editor, after references.sql. Fully idempotent (`if not exists`
-- throughout), safe to re-run.
--
-- Same posture as work_references: keyed by user_email, personal not team data (confirmed with
-- her 2026-09-11 — the taxonomy stays private per user, same as the references themselves).
--
-- Seeding (the actual default "Uncategorized" category and the four existing type names) happens
-- lazily in application code (src/lib/references-taxonomy-store.ts), not here — so it naturally
-- covers every existing user without needing a per-user INSERT loop in SQL, and covers brand-new
-- users the same way on their first visit.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists reference_categories (
  category_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  name text not null,
  sort_order integer not null default 0,
  -- The one protected row per user ("Uncategorized") — reassignment target when a category is
  -- deleted, and never itself deletable. A boolean, not name-matching, so renaming it doesn't
  -- break the protection (see deleteCategory in references-taxonomy-store.ts).
  is_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_email, name)
);

create index if not exists reference_categories_user_idx on reference_categories (user_email, sort_order);
alter table reference_categories enable row level security;

create table if not exists reference_types (
  type_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  name text not null,
  sort_order integer not null default 0,
  -- The one protected row per user ("Other") — same role as reference_categories.is_fallback.
  is_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_email, name)
);

create index if not exists reference_types_user_idx on reference_types (user_email, sort_order);
alter table reference_types enable row level security;

-- on delete set null is a backstop only (in case a category/type row is ever removed outside the
-- app's own reassign-then-delete logic) — the application always reassigns affected references
-- to the fallback row before deleting a category/type, and getReferences() re-backfills any
-- lingering null to the fallback id on next read either way.
alter table work_references
  add column if not exists category_id uuid references reference_categories (category_id) on delete set null,
  add column if not exists type_id uuid references reference_types (type_id) on delete set null;

create index if not exists work_references_category_idx on work_references (category_id);
create index if not exists work_references_type_idx on work_references (type_id);
