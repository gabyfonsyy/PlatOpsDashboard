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
-- Reschedule log: every time a task slips to a later day, and why.
--
-- An EVENT LOG, not a `reschedule_reason` column on work_tasks, and that is the whole design.
-- A column keeps only the most recent answer, and the most recent answer is the least
-- interesting thing here: the signal Work Mirror is after is that "Q2: Self Evals" moved five
-- times across three weeks, each time for a different reason. Overwrite that and the pattern —
-- which is the actual finding — is gone by the time anyone looks for it.
--
-- Only LATER moves are logged. Pulling a task forward (the "bring everything to today" button)
-- is not a slip and recording it as one would dilute the reason counts with the opposite act.
--
-- `reason` is nullable because the move is logged the instant it happens and the reason is asked
-- for afterwards — a modal between "push" and the task moving would mean the button stops being
-- one click, and an optional field nobody fills in is worth more than a mandatory one that makes
-- people stop pressing the button.
--
-- task_id is `on delete set null` and the title is denormalised alongside it, for the same
-- reason work_tasks.recurrence_id is: deleting a task must not rewrite the history of the days it
-- was pushed through. The title is stamped at push time so a deleted task still reads as
-- something rather than as a bare uuid.
-- ----------------------------------------------------------------------------
create table if not exists work_task_reschedules (
  reschedule_id uuid primary key default gen_random_uuid(),
  user_email text not null,
  task_id uuid references work_tasks (task_id) on delete set null,
  task_title text not null,
  from_date date not null,
  to_date date not null,
  -- A stable code from RESCHEDULE_REASONS in lib/work.ts, never the label — same discipline as
  -- work_checkins.mood, so the wording can be retuned without orphaning historical rows.
  reason text,
  note text,
  created_at timestamptz not null default now()
);

-- from_date desc: every read is "what slipped recently", bounded by the history window.
create index if not exists work_task_reschedules_user_idx
  on work_task_reschedules (user_email, from_date desc);
-- Backs "attach a reason to the move I just made", which finds the newest row for one task.
create index if not exists work_task_reschedules_task_idx
  on work_task_reschedules (task_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Eisenhower triage: two axes, never one column.
--
-- `urgent` and `important` are stored SEPARATELY and the quadrant is derived (quadrantOf in
-- lib/work.ts). A single `quadrant` enum would have been fewer characters and would have thrown
-- away the thing that makes the matrix worth using: the two questions are independent, and the
-- whole insight of the model is watching what happens when you answer them one at a time.
--
-- Both are NULLABLE, and that is the important part. NULL means "not sorted yet" — not "neither".
-- A default of false/false would silently file every task that was typed in a hurry into
-- "Kill or park", which is the most destructive resting place in the model: work would arrive
-- pre-condemned, the quadrant that is supposed to be a decision would fill up with things nobody
-- decided anything about, and the one honest reading ("I haven't triaged this") would be
-- unrecoverable. So an untriaged task shows as Unsorted and asks to be sorted.
--
-- No CHECK constraint is possible or wanted here: every combination of (null, true, false) is a
-- legitimate state, including "I know this is important and I haven't decided if it's urgent".
-- ----------------------------------------------------------------------------
alter table work_tasks
  add column if not exists urgent boolean,
  add column if not exists important boolean;

-- The rule carries the triage so its instances are born already sorted. A recurring task whose
-- quadrant has to be re-picked every morning is a recurring task that never gets picked at all.
alter table work_recurrences
  add column if not exists urgent boolean,
  add column if not exists important boolean;

-- Projects get the same two axes, because "what am I steering vs what should I have killed" is
-- the question the matrix is actually for at the project level — a personal project sitting in
-- Kill-or-park for three months is a more expensive finding than a task in the same square.
alter table work_projects
  add column if not exists urgent boolean,
  add column if not exists important boolean;

-- ----------------------------------------------------------------------------
-- Parking, with the two things a park is required to state.
--
-- "A parked project needs a stated reason and a named decision, not a slipped date." Both are
-- columns rather than free text in `notes` precisely so the requirement can be ENFORCED (see
-- assertParkable in lib/work-store.ts) instead of merely suggested. A park with no decision
-- attached is not a park, it is a task quietly rotting, and the difference between those two is
-- the entire point of the fourth quadrant.
--
--   park_reason   — why this is not being worked on. A fact about now.
--   park_decision — the decision that ends the park, named. "Decide with Ken whether we still
--                   need a second reviewer" is a decision; "revisit in Q4" is a slipped date
--                   wearing a decision's coat, which is exactly what this column exists to stop.
--   parked_at     — when it was parked, so a park that has quietly outlived its reason can be
--                   found. Set by the server, never by the client.
--
-- Nullable throughout: a live project has none of them, and un-parking clears them rather than
-- leaving a stale reason attached to active work.
-- ----------------------------------------------------------------------------
alter table work_projects
  add column if not exists park_reason text,
  add column if not exists park_decision text,
  add column if not exists parked_at timestamptz;

-- Tasks can be parked too — same discipline, same two answers. Deferring a task is the task-level
-- version of pausing a project, and it was previously the one exit from the board that required
-- no explanation at all.
alter table work_tasks
  add column if not exists park_reason text,
  add column if not exists park_decision text,
  add column if not exists parked_at timestamptz;

-- Backs the matrix cells, which read "today's tasks in one quadrant" on every page load.
create index if not exists work_tasks_user_quadrant_idx
  on work_tasks (user_email, work_date, urgent, important);

-- ----------------------------------------------------------------------------
-- The project brief: the one page a project has to be able to fill in before it is a project.
--
-- Eight columns rather than one `brief` blob, and that is the whole point. A single free-text
-- field would be filled in the way free text always is — a paragraph that reads well, commits to
-- nothing, and cannot be checked against reality later. Separate columns mean each question has to
-- be answered on its own, and mean the app can say WHICH answer is missing (briefGaps in
-- lib/work.ts) instead of shrugging at a half-written page.
--
--   problem         — what is broken today, with evidence. A number, or something someone else
--                     can confirm. Stored as prose because the evidence varies; the discipline is
--                     enforced by the prompt beside it, not by a type.
--   outcome         — what is true when this is done, from the point of view of whoever benefits.
--   metric_baseline — where it is now. NULLABLE ON PURPOSE, and the one field that is allowed to
--                     be empty: if there is no baseline then measuring it is Phase 1, which is a
--                     real finding about the project rather than a gap in the form. The UI offers
--                     to add exactly that phase.
--   metric_target   — where it needs to get to.
--   metric_by_when  — by when. Kept apart from the target so "20% fewer" cannot quietly stand in
--                     for a commitment with no date attached.
--   explicitly_out  — two or three things people will assume are included and are not. A JSON
--                     array of strings; the count is what makes it useful, so it is a list rather
--                     than a paragraph that can contain one item and look complete.
--   phases          — [{ name, exit }]. Named by the STATE each one ends in, with one exit
--                     criterion apiece. An array because a project has as many as it has, and
--                     ordered because the order is the plan.
--   owner           — one name. Not a team. A single text column rather than a list, so the
--                     schema itself refuses the committee.
--
-- Every column is nullable: a project can be captured before it can be articulated, and the card
-- says so out loud rather than the gap being invisible. What is NOT allowed is a project that
-- looks finished because nobody asked.
-- ----------------------------------------------------------------------------
alter table work_projects
  add column if not exists problem text,
  add column if not exists outcome text,
  add column if not exists metric_baseline text,
  add column if not exists metric_target text,
  add column if not exists metric_by_when text,
  add column if not exists explicitly_out jsonb not null default '[]'::jsonb,
  add column if not exists phases jsonb not null default '[]'::jsonb,
  add column if not exists owner text;

-- ----------------------------------------------------------------------------
-- Which phase of its project a task belongs to.
--
-- Text, not an integer index, and not a foreign key. The phases live inside work_projects.phases
-- as a jsonb array, so there is no row to point at — and an INDEX would be the obvious choice and
-- the wrong one: reordering the plan (which the brief panel lets you do, because the order IS the
-- plan) would silently re-file every task under a different phase. The id is minted when the phase
-- is created and travels with it.
--
-- Nullable throughout. Most tasks belong to no project at all, and a task on a project with a
-- brief that has not been phased yet is a perfectly ordinary thing.
--
-- No FK and no cascade, deliberately: deleting a phase from the brief must not delete the days of
-- work done against it. The task keeps a phase_id that no longer resolves, which reads as
-- "unphased" and loses nothing that happened.
-- ----------------------------------------------------------------------------
alter table work_tasks
  add column if not exists phase_id text;

create index if not exists work_tasks_phase_idx on work_tasks (user_email, phase_id);

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
                        'work_day_marks', 'work_task_reschedules', 'ai_insight_cache')
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
