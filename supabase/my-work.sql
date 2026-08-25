-- ============================================================================
-- My Work — personal work tracking (workday sessions, tasks, projects, check-ins)
--
-- Run this in the Supabase SQL editor. Fully idempotent (`if not exists` throughout), so it is
-- safe to re-run and safe to run against a project that already has schema.sql applied.
--
-- Deliberately in Supabase rather than the Apps Script/Sheets backend that Leave, RTO and
-- Incident Logs use: this is the one surface where latency IS the feature. A to-do list where
-- adding a task takes the 2-40s an Apps Script Web App round-trip can take is a to-do list nobody
-- opens twice. Supabase writes land in ~100-300ms.
--
-- Everything is keyed by `user_email` (the NextAuth session identity) because this is personal
-- data, not team data. Same RLS posture as every other table: enabled with no policies, so the
-- server-side service_role key is the only way in.
--
-- The timestamps are the point. Work Mirror's job is to find patterns across weeks, which means
-- the schema has to preserve WHEN things happened and HOW they related, not just current state:
-- session start/end (duration), task created/started/completed/deferred (throughput, latency,
-- abandonment), task->project links (context switching), and per-day mood + factors + free text.
-- Anything that only stores "current status" makes historical analysis impossible after the fact.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Projects. Deliberately lightweight — this is "what am I involved in right now", NOT the
-- Initiatives project tracker (which lives in its own workbook and has owners, Gantt dates and
-- batch projections). Kept separate on purpose: this one is personal and disposable.
-- ----------------------------------------------------------------------------
create table if not exists work_projects (
  project_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  name text not null,
  status text not null default 'Active'
    check (status in ('Active', 'Paused', 'Waiting', 'Completed')),
  notes text,
  -- Touched whenever a task on this project changes, so a card can show "last activity" without
  -- scanning the task table.
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_projects_user_idx on work_projects (user_email, status);

-- ----------------------------------------------------------------------------
-- Workday sessions. Not payroll time tracking — context for later correlation (did long days
-- coincide with low-mood check-ins? with high incoming volume?).
-- ----------------------------------------------------------------------------
create table if not exists work_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Asia/Manila calendar day, computed server-side. Stored rather than derived so grouping by
  -- "workday" is a plain equality and never depends on the reader's timezone.
  work_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_sessions_user_date_idx on work_sessions (user_email, work_date desc);

-- At most one OPEN session per person. A partial unique index enforces it in the database, so a
-- double-clicked "Start Work" cannot create two overlapping sessions and silently corrupt every
-- duration statistic downstream.
create unique index if not exists work_sessions_one_open_per_user
  on work_sessions (user_email)
  where ended_at is null;

-- ----------------------------------------------------------------------------
-- Tasks.
--
-- `lane` and `status` are two genuinely different axes, which is why both exist:
--   lane   — where I want this in my view today (Focus / Today / Waiting / Incoming). Intent.
--   status — what state the work is actually in. Lifecycle.
-- A task can be lane='Focus', status='In Progress'. Collapsing them would force "I'm blocked on
-- this but it's still my top priority" to pick one, which is exactly the case that matters.
-- ----------------------------------------------------------------------------
create table if not exists work_tasks (
  task_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  title text not null,
  lane text not null default 'Today'
    check (lane in ('Focus', 'Today', 'Waiting', 'Incoming')),
  status text not null default 'To Do'
    check (status in ('To Do', 'In Progress', 'Done', 'Waiting', 'Deferred')),
  priority text not null default 'Normal'
    check (priority in ('High', 'Normal', 'Low')),
  project_id uuid references work_projects (project_id) on delete set null,
  notes text,
  -- The workday this task is slotted for. Lets "today's list" be a cheap indexed query and lets
  -- history show what a given day actually looked like.
  --
  -- This is also the whole of scheduling: a work_date in the future IS a planned task. It stays
  -- out of today's board (which filters on work_date = today) and shows up under "Ahead" until
  -- the day arrives — no separate planned-tasks table, and no status value that means "later",
  -- which would have made "planned" and "blocked" compete for the same field.
  work_date date not null,
  -- Lifecycle stamps, all nullable. Each one is a fact Work Mirror can count: how long tasks sit
  -- before being started, how many get deferred rather than finished, throughput per day.
  started_at timestamptz,
  completed_at timestamptz,
  deferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_tasks_user_date_idx on work_tasks (user_email, work_date desc);
create index if not exists work_tasks_user_status_idx on work_tasks (user_email, status);
create index if not exists work_tasks_project_idx on work_tasks (project_id);
-- Backs the historical aggregates Work Mirror runs over a multi-week window.
create index if not exists work_tasks_user_created_idx on work_tasks (user_email, created_at desc);

-- ----------------------------------------------------------------------------
-- Recurring tasks.
--
-- A recurrence is a RULE, not a task. Instances are materialised into work_tasks as ordinary rows
-- (see materialiseRecurrences in lib/work-store.ts), which is the whole point of the design: the
-- board, the Ahead panel, the lifecycle stamps, the day rollups and Work Mirror all keep working
-- untouched, because a recurring task IS a task by the time anything reads it. The alternative --
-- teaching every one of those surfaces to expand a rule on the fly -- would have put recurrence
-- logic in six places and made "what actually happened on Tuesday" unanswerable.
--
-- Only four frequencies. Daily / weekdays / weekly / monthly covers real personal routines, and
-- each is one line of arithmetic; a full RFC 5545 RRULE engine is a library, not a column.
-- ----------------------------------------------------------------------------
create table if not exists work_recurrences (
  recurrence_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  -- The template each instance is stamped from. Editing it affects FUTURE instances only, because
  -- past instances are already real rows with their own history.
  title text not null,
  lane text not null default 'Today'
    check (lane in ('Focus', 'Today', 'Waiting', 'Incoming')),
  priority text not null default 'Normal'
    check (priority in ('High', 'Normal', 'Low')),
  project_id uuid references work_projects (project_id) on delete set null,
  notes text,
  freq text not null check (freq in ('daily', 'weekdays', 'weekly', 'monthly')),
  -- Which day the rule fires on. Set for exactly one freq each, and ignored otherwise:
  --   weekly  -> byweekday, 0 = Sunday (matches Date#getUTCDay, so no off-by-one translation)
  --   monthly -> bymonthday, 1-31. A month without that day is SKIPPED rather than clamped:
  --              silently moving "the 31st" to the 28th of February invents a date the person
  --              never asked for, and they notice it as a task appearing on the wrong day.
  byweekday smallint check (byweekday between 0 and 6),
  bymonthday smallint check (bymonthday between 1 and 31),
  start_date date not null,
  -- Open-ended by default. Set to stop a routine on a date without deleting its history.
  end_date date,
  -- Paused keeps the rule and stops producing instances. Deleting is for "this is over"; pausing
  -- is for "not this month", and conflating them means losing the rule to get a break from it.
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_recurrences_user_idx on work_recurrences (user_email, paused);

-- Instances point back at the rule that made them, so the UI can mark a task as recurring and
-- deleting a rule can find the future instances it hasn't happened yet.
--
-- `on delete set null`: dropping a rule must NOT delete the days it already produced. Those are
-- history -- work that was done on a date -- and history doesn't belong to the schedule that
-- suggested it. The API removes future untouched instances explicitly, and leaves the rest as
-- ordinary tasks.
alter table work_tasks
  add column if not exists recurrence_id uuid references work_recurrences (recurrence_id) on delete set null;

-- One instance per rule per day, enforced in the database. This is what makes materialisation
-- idempotent and safe under concurrency: two page loads racing on the same morning cannot both
-- create today's instance, so the insert can be a plain "on conflict do nothing" rather than a
-- read-then-write that would have to be transactional to be correct.
--
-- Not partial, deliberately. Postgres treats NULLs as distinct in a unique index, so the millions
-- of ordinary tasks with recurrence_id = null are unaffected -- and a non-partial index is one
-- ON CONFLICT the client library can actually name.
create unique index if not exists work_tasks_recurrence_day_uidx
  on work_tasks (recurrence_id, work_date);

-- ----------------------------------------------------------------------------
-- End-of-day check-ins. One per person per day — re-submitting edits that day's answer rather
-- than appending, so a day has a single mood rather than an average of several moods.
-- ----------------------------------------------------------------------------
create table if not exists work_checkins (
  checkin_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  work_date date not null,
  -- Stored as a stable code ('good','fine','meh','overwhelmed','done_with_today','perished'),
  -- never as the emoji or label: the wording will change, the data shouldn't.
  mood text not null,
  -- Quick-select factors as a JSON array of codes. jsonb so future analysis can filter on
  -- membership in the database rather than pulling every row and scanning in JS.
  factors_json jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_email, work_date)
);

create index if not exists work_checkins_user_date_idx on work_checkins (user_email, work_date desc);

-- ----------------------------------------------------------------------------
-- Generic AI insight cache.
--
-- Exists to make AI spend proportional to CHANGE rather than to clicks. The key is
-- (user_email, context, entity_id, source_version), where source_version is a hash of exactly the
-- data that was sent to the model — so asking the same question about unchanged data is answered
-- from here and costs nothing. Only an explicit "regenerate" bypasses it.
--
-- Deliberately generic (context + entity_id) rather than a work_mirror_cache table: the next AI
-- feature should reuse this instead of adding another cache with its own invalidation bugs.
-- ----------------------------------------------------------------------------
create table if not exists ai_insight_cache (
  insight_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  -- e.g. 'work_mirror'. Namespaces the cache so contexts can't collide.
  context text not null,
  -- The subject within that context; '' when the context is inherently per-user.
  entity_id text not null default '',
  -- Fingerprint of the source data. A different version means a genuinely different question.
  source_version text not null,
  content_json jsonb not null,
  model_used text,
  generated_at timestamptz not null default now(),
  unique (user_email, context, entity_id, source_version)
);

create index if not exists ai_insight_cache_lookup_idx
  on ai_insight_cache (user_email, context, entity_id, generated_at desc);

-- ----------------------------------------------------------------------------
-- Day marks: "this weekday had no session because it was a holiday / I was on leave".
--
-- Exists so an empty weekday can be told apart from a FORGOTTEN one. Without it the only
-- honest reading of a Monday with no session is "unknown", and every average over "days
-- worked" silently includes leave as a zero — which drags the mean down and makes a
-- well-rested fortnight look like a productivity collapse. Marking the day removes it from
-- the denominator instead of scoring it.
--
-- Deliberately NOT a column on work_sessions: the whole point is a day with no session row.
-- One mark per person per date; re-marking updates rather than stacking.
-- ----------------------------------------------------------------------------
create table if not exists work_day_marks (
  mark_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  work_date date not null,
  day_type text not null check (day_type in ('Holiday', 'Leave')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists work_day_marks_user_date_idx
  on work_day_marks (user_email, work_date);

-- ----------------------------------------------------------------------------
-- Same lock-down as every other table: RLS on, no policies, service_role only.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('work_projects', 'work_sessions', 'work_tasks', 'work_checkins',
                        'work_day_marks', 'ai_insight_cache')
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
