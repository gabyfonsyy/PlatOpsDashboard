-- Lead / Cycle Time scorecard aggregation, pushed into Postgres.
--
-- Run this once in the Supabase SQL editor. Safe to re-run: it is create-or-replace throughout.
--
-- WHY THIS EXISTS
-- The Team Stats and Overview scorecards must report the SAME Lead/Cycle Time as the drill-down
-- pages they link to, so both read one definition (see basisFor() in src/lib/lead-cycle-time.ts).
-- Computing that in Node meant fetching every matching ticket row through PostgREST's 1000-row
-- cap — roughly 50 round trips for the Overview's year range, measured at 6-10s. This function
-- returns four numbers instead, so the same average costs one request.
--
-- KEEP IN STEP WITH basisFor() IN src/lib/lead-cycle-time.ts. That function remains the
-- definition of record and still backs the drill-down; this is the aggregate-only fast path for
-- the scorecard, and the two are asserted equal (see the reconciliation note at the bottom).
--
--   lead                     created -> resolved_datetime, counted in the period its RESOLUTION
--                            falls in.
--   cycle, peer-review team  cycle_time_start -> cycle_time_end, counted in the period
--                            cycle_time_end falls in. NOT gated on resolution: for SE/ST this
--                            span ends when the ticket reaches For Peer Review (For Checking /
--                            For Product Team for Investigations), Archived or Rejected, which
--                            happens whether or not the ticket is ever resolved.
--   cycle, other teams       first_out_of_backlog_todo -> resolved_datetime, counted in the
--                            period its RESOLUTION falls in.
--
-- p_excluded_issue_types is likewise passed in, for the same reason: which issue types a team
-- ignores is product policy held in TS, not something Postgres should decide independently.
--
-- p_has_peer_review is passed in rather than looked up because team configuration lives in the
-- GAS TEAMS_CONFIG sheet, not in Postgres — this function must not become a second, silently
-- diverging source of truth for which teams have a peer-review step.
--
-- Manila day membership uses `at time zone 'Asia/Manila'`, which is exact rather than an
-- approximation: the Philippines observes no DST, so it is a fixed +8, matching the manual +8h
-- shift in src/lib/manila-date.ts's toManilaDateString.

create or replace function lead_cycle_time_spans(
  p_team_key text,
  p_start date,
  p_end date,
  p_has_peer_review boolean,
  p_issue_type text default null,
  p_excluded_issue_types text[] default null
)
returns table (
  lead_sum double precision,
  lead_count bigint,
  cycle_sum double precision,
  cycle_count bigint
)
language sql
stable
as $$
  with base as (
    select created, resolved_datetime, first_out_of_backlog_todo, cycle_time_start, cycle_time_end
    from tickets
    where team_key = p_team_key
      and (p_issue_type is null or issue_type = p_issue_type)
      -- Issue types the team does not count at all (SE excludes Technical Story: internal
      -- engineering work, not requester-facing delivery). Compared case-insensitively so a Jira
      -- rename does not silently re-include them. Mirrors isExcludedIssueType in src/lib/teams.ts.
      and (
        p_excluded_issue_types is null
        or lower(btrim(issue_type)) <> all (select lower(btrim(x)) from unnest(p_excluded_issue_types) as x)
      )
  ),
  lead_spans as (
    select extract(epoch from (resolved_datetime - created)) / 60.0 as minutes
    from base
    where created is not null
      and resolved_datetime is not null
      and (resolved_datetime at time zone 'Asia/Manila')::date between p_start and p_end
  ),
  cycle_spans as (
    select
      case
        when p_has_peer_review then extract(epoch from (cycle_time_end - cycle_time_start)) / 60.0
        else extract(epoch from (resolved_datetime - first_out_of_backlog_todo)) / 60.0
      end as minutes
    from base
    where
      case
        when p_has_peer_review then
          cycle_time_start is not null
          and cycle_time_end is not null
          and (cycle_time_end at time zone 'Asia/Manila')::date between p_start and p_end
        else
          first_out_of_backlog_todo is not null
          and resolved_datetime is not null
          and (resolved_datetime at time zone 'Asia/Manila')::date between p_start and p_end
      end
  )
  select
    coalesce((select sum(minutes) from lead_spans), 0)::double precision,
    (select count(*) from lead_spans),
    coalesce((select sum(minutes) from cycle_spans), 0)::double precision,
    (select count(*) from cycle_spans);
$$;

-- The period predicate filters on cycle_time_end for peer-review teams, which none of the
-- existing indexes cover (schema.sql indexes team_key+created and team_key+resolved_datetime).
-- Without this the SE cycle-time branch degrades to a full scan of that team's tickets.
create index if not exists tickets_team_cycle_time_end_idx on tickets (team_key, cycle_time_end);

-- RECONCILIATION
-- src/lib/lead-cycle-time.ts asserts this function against the row-by-row drill-down path; the
-- averages must match to the cent for every team. If a definition changes, change basisFor()
-- and this function together, then re-run that check.
