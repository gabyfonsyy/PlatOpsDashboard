# Apps Script backend — deployment guide

This folder holds the source for the standalone Apps Script project. Apps Script's
editor doesn't read from a git repo directly — paste these files in manually (or
connect this folder with [`clasp`](https://github.com/google/clasp) later for
push/pull syncing).

## Spreadsheets (already created)

| Spreadsheet | ID | Link |
|---|---|---|
| `PlatOps - Jira Data` | `1raCFx9Bk-VQjIjrggcMGP8KwRvcfM9zELnc9dRm2iYk` | https://docs.google.com/spreadsheets/d/1raCFx9Bk-VQjIjrggcMGP8KwRvcfM9zELnc9dRm2iYk/edit |
| `PlatOps - Manager Data` | `1sC_i2LnTNX1zJLHGShmV1Anw1g80AowMMHjsOFjeTXM` | https://docs.google.com/spreadsheets/d/1sC_i2LnTNX1zJLHGShmV1Anw1g80AowMMHjsOFjeTXM/edit |

Both live in the Drive folder `Platform Operations Dashboard` (under `Platform Operations`).
They start empty — running `setupAll()` (below) builds every tab, header row, and
pre-filled config row.

## File order

Functionally irrelevant — Apps Script merges every `.gs` file into one global scope
before any entry point runs, so cross-file function calls work regardless of order.
For readability, arrange them (drag in the editor's left file list) as:

1. `Config.gs` — Script Properties + `getTeamsConfig_()`, everything else depends on this
2. `Utils.gs` — shared helpers (`sheetToObjects_`, `uuid_`, dates, `withLock_`, alert email)
3. `JiraClient.gs` — Jira REST auth/fetch/retry, no sync logic
4. `JiraSync.gs` — incremental sync (the core mapping/parsing logic, shared with backfill)
5. `Backfill.gs` — one-time historical load, self-continuing
6. `Aggregation.gs` — precomputes METRICS_DAILY / METRICS_BY_ASSIGNEE_MONTHLY from raw rows
7. `MetricsApi.gs` — read-only rollup API the frontend actually queries
8. `AiClient.gs` — the one AI transport (open-weight models on Groq); no prompts live here
9. `Insights.gs` — narrative generation (via `AiClient.gs`) + deterministic outlier detection
10. `Code.gs` — the `doGet`/`doPost` router, ties everything together
11. `LeaveApi.gs`, `RtoApi.gs`, `ProjectsApi.gs`, `ProgressApi.gs`, `TasksApi.gs`
12. `IncidentsApi.gs` — Incident Logs: the Jira pull of Report-Tagged tickets + log CRUD
13. `Setup.gs` — one-time bootstrap, not called by the router
14. `Triggers.gs` — installs every recurring trigger, run last of all

## First-time setup

1. Go to [script.google.com](https://script.google.com) → New project. Rename it `PlatOpsDashboard`.
2. Paste each `.gs` file in this folder into a matching file in the Apps Script editor
   (see file order above — more files land in later milestones).
3. Project Settings → Script Properties → add:
   ```
   SPREADSHEET_ID_JIRA=1raCFx9Bk-VQjIjrggcMGP8KwRvcfM9zELnc9dRm2iYk
   SPREADSHEET_ID_MANAGER=1sC_i2LnTNX1zJLHGShmV1Anw1g80AowMMHjsOFjeTXM
   JIRA_BASE_URL=https://sprouthq.atlassian.net
   JIRA_EMAIL=<your dedicated Jira email>
   JIRA_API_TOKEN=<your dedicated Jira API token — do not reuse Operations Hub's or Jira Tagging's>
   AI_API_KEY=<Groq API key from console.groq.com/keys — open-weight models; replaced GEMINI_API_KEY>
   API_SHARED_SECRET=<generate a random string, e.g. `openssl rand -hex 24`>
   ALERT_EMAIL=<your email — recommended; see Troubleshooting below if omitted>
   ```
4. In the editor, select the `setupAll` function (top dropdown) and click **Run**.
   First run will prompt for authorization — grant access to both spreadsheets.
   This builds every tab in both files (see the schema in the project plan, Section 2).
5. Open `PlatOps - Manager Data` → `TEAMS_CONFIG` tab and confirm the 3 pre-filled rows
   (ST/DE/DEV) look right — especially `issue_types_csv`, which is left blank for you to
   fill in with your real Jira issue types (comma-separated, no spaces after commas).
6. Populate the `ROSTER` tab with real team members (used for per-person filtering, the
   Incident Logs person picker, and outlier flagging later).
7. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access
   **Anyone**. Copy the `/exec` URL.
8. In the Next.js app's `.env.local`, set:
   ```
   GAS_WEB_APP_URL=<the /exec URL from step 7>
   GAS_API_KEY=<the same value as API_SHARED_SECRET from step 3>
   ```

## Troubleshooting

**`Jira request failed (HTTP 410): The requested API has been removed. Please migrate to the /rest/api/3/search/jql API`**
— Atlassian fully removed `/rest/api/3/search` in 2025. `JiraClient.gs`'s
`jiraSearchIssues_` now calls `/rest/api/3/search/jql` instead, which paginates via an
opaque `nextPageToken` string rather than `startAt`/`total` (the new endpoint doesn't
return a total count at all). `SYNC_CHECKPOINT.backfill_cursor` now stores that token
string instead of a numeric offset. If you started a backfill before this fix, no
cleanup is needed — the failed run never wrote a cursor, so it just restarts from page 1.

**`sendAlertEmail_ failed to send email: ... Session.getEffectiveUser ... Required permissions: userinfo.email`**
— `sendAlertEmail_` (Utils.gs) falls back to `Session.getEffectiveUser().getEmail()`
when `ALERT_EMAIL` isn't set, and that call needs the `userinfo.email` OAuth scope.
Since this project hand-writes `oauthScopes` in `appsscript.json`, only scopes listed
there are granted — nothing is auto-added. Two fixes, do both:
1. Set the `ALERT_EMAIL` script property (see step 3) — avoids needing that scope at all.
2. If you want the fallback to work too (e.g. you forget to set `ALERT_EMAIL` on a future
   redeploy): make sure your `appsscript.json` includes
   `https://www.googleapis.com/auth/userinfo.email` in `oauthScopes`, then re-run any
   function once so Apps Script re-prompts for authorization with the new scope — a
   manifest scope change alone doesn't retroactively grant it.

This failure is caught inside `sendAlertEmail_`'s own try/catch, so it only prevented
the alert email itself — it doesn't mean the sync/aggregation/backfill run that
triggered it actually failed. Check `SYNC_CHECKPOINT.last_sync_status` for the real
outcome.

## Why the shared secret is a query param, not a header

Apps Script Web Apps (`doGet`/`doPost`) do not expose incoming HTTP headers — only
query params and the POST body. So `Code.gs` checks an `apiKey` query param instead
of the `X-Api-Key` header the original design assumed. `gas-client.ts` on the Next.js
side appends it to every request URL server-side, so it never reaches the browser.

## Re-deploying after code changes

Apps Script does **not** pick up edits automatically — you must publish a new
deployment version: Deploy → Manage deployments → pick the existing deployment →
Edit (pencil icon) → Version: **New version** → Deploy. The `/exec` URL stays the
same across versions, so no env vars need to change.

## Smoke-testing the CRUD routes (Milestone 1)

Once deployed, verify with curl (replace `<URL>` and `<KEY>`):

```bash
curl "<URL>?route=teams&apiKey=<KEY>"
curl "<URL>?route=leave&apiKey=<KEY>&team=ST"
curl -X POST "<URL>?route=leave&action=create&apiKey=<KEY>" \
  -H "Content-Type: application/json" \
  -d '{"employee_name":"Test User","team_key":"ST","leave_type":"Vacation","start_date":"2026-07-10","end_date":"2026-07-11","num_days":2,"created_by":"gabriellef@sprout.ph"}'
```

## Running the initial Jira backfill (Milestone 2)

Once `JiraClient.gs`, `JiraSync.gs`, and `Backfill.gs` are pasted in and Script
Properties include your dedicated `JIRA_EMAIL`/`JIRA_API_TOKEN`:

1. Select `runInitialBackfill` in the function dropdown and click **Run**.
2. It processes ~100 issues per execution and reschedules itself automatically
   (a one-off trigger firing ~1s later) until every active team's 2-year backfill is
   done — this runs unattended across many short executions, expect several hours of
   wall-clock time for ST given ~15-18k tickets/year.
3. Check progress anytime in `PlatOps - Jira Data` → `SYNC_CHECKPOINT` tab
   (`last_sync_status`, `tickets_synced_last_run`, `backfill_cursor`).
4. You'll get an email (via `sendAlertEmail_`, to your own address by default — set an
   `ALERT_EMAIL` script property to redirect it) when all teams finish, or if a page
   fails outright (it still reschedules itself after logging the failure).
5. **Before running the full 2-year backfill**, validate against a small slice first —
   temporarily edit `buildJqlBackfillFull_` in `Backfill.gs` to `created >= -30d`, run
   it, inspect the resulting `RAW_ST_<year>` rows (especially `resolved_datetime`,
   `first_out_of_backlog_todo`, `on_hold_entered_at/exited_at`) against a few tickets
   you know the real history of in the Jira UI, then revert to `-730d` and re-run.

## Aggregation + metrics (Milestone 3)

After a sync run (or backfill slice) has populated some raw ticket rows, run
`aggregateAllTeams` manually once to precompute `METRICS_DAILY` and
`METRICS_BY_ASSIGNEE_MONTHLY` for the first time (it normally runs on its own 2h
trigger once `Triggers.gs` is installed — see Milestone 6). Then smoke-test:

```bash
curl "<URL>?route=metrics&apiKey=<KEY>&team=ST&range=month&period=2026-07"
curl "<URL>?route=assignee-metrics&apiKey=<KEY>&team=ST&range=month&period=2026-07"
curl "<URL>?route=backlog-aging-report&apiKey=<KEY>&team=DBA&range=month&period=2026-07"
```

Hand-verify the returned `fcrRate`/`escalationRate`/`backlogAgingRate`/lead-cycle-time
averages against a handful of tickets you know the history of before trusting the
numbers for a real MBR/QBR.

`backlog-aging-report` (BacklogAgingApi.gs) is the per-ticket drill-down behind the
Backlog Aging scorecard — it re-derives the overdue set from the RAW tabs using the same
date comparison `buildResolvedIndex_` applies, so its `overdueCount`/`resolvedInPeriod`
should equal the "N of M resolved overdue" the `metrics` route reports for the same
team + period. If the two disagree, `aggregateAllTeams` hasn't caught up with the latest
sync — the report reads raw rows live, the scorecard reads `METRICS_DAILY`.

## Narrative insights (Milestone 5)

`AI_API_KEY` must already be set in Script Properties (see step 3). Smoke-test once
`AiClient.gs` and `Insights.gs` are pasted in:

1. Select `generateInsightsAllTeams` in the function dropdown and click **Run**.
2. Check `PlatOps - Manager Data` → `INSIGHTS_CACHE` — one row per team (`TEAM:ST`, etc.)
   plus `ROLLUP:ALL`, each with `generation_status = SUCCESS` and a `narrative_text`.
3. Read the narratives for hallucination/accuracy before trusting them for a real
   MBR/QBR — the prompt only receives aggregated numbers (never raw tickets), but LLM
   output should still be spot-checked, especially early on.
4. Confirm `openai/gpt-oss-20b` (`AI_DEFAULT_MODEL` in `AiClient.gs`) is still served
   on [Groq's model list](https://console.groq.com/docs/models) — providers retire model ids,
   and a retired id fails with a non-retryable HTTP 404 rather than falling back. Set an
   `AI_MODEL` Script Property to re-point it without editing code.

## Incident Logs (IncidentsApi.gs)

The trigger for an incident log is **you**, in Jira: setting the Report Tagging custom field
(`customfield_10262`) on a ticket is what marks it a valid incident. `IncidentsApi.sync()` finds
those tickets (`cf[10262] IS NOT EMPTY`, per project, bounded to the last 730 days) and upserts
them into `INCIDENT_TICKETS`. **Nothing is ever written back to Jira** — the field's value is
used purely as a flag, so it isn't even stored.

Severity, feedback, and AI-inferred categories live in a separate `INCIDENT_LOGS` tab, so a
re-sync can never clobber typed feedback. Two tabs, two lifecycles:

| Tab | Written by | Overwritten by a sync? |
|---|---|---|
| `INCIDENT_TICKETS` | `IncidentsApi.sync()` | Yes, every run |
| `INCIDENT_LOGS` | the dashboard's forms | Never |

Smoke-test:

1. Tag one ticket's Report Tagging field in Jira.
2. Select `syncIncidentTickets` in the function dropdown and click **Run**.
3. Check `PlatOps - Manager Data` → `INCIDENT_TICKETS` for the row, and that `doer` matches the
   team's configured owner field. On ST, `validator` should be whoever last held the ticket
   leaving *For Peer Review* — it's derived from the changelog, so it's blank if the ticket never
   went through review.
4. If a team errors with a JQL complaint about the field, that project doesn't expose
   `customfield_10262`. The sync returns per-team errors instead of throwing, so the other teams
   still sync — the failure shows up in the response and on the page's Sync button.

Score impact is recomputed backend-side from the severity code on every write (S1 -3, S2 -2,
S3 -1.5, S4 -1), never taken from the request — so a stale frontend or a hand-edited sheet row
can't quietly change what an incident costs someone.

### Sync performance, and why it's built this way

The validator attribution is the expensive part, and it is deliberately NOT derived from Jira
during the sync. Measured on the first real run: 155 tagged ST tickets, one full paginated
changelog fetch each, **182 seconds** — past every serverless timeout on the calling side, so the
Next.js route returned 504 while Apps Script carried on working and the result was never reported.
The symptom is a Sync button that appears to do nothing.

`buildIncidentValidatorIndex_` reads `peer_review_cycles_json` out of the `RAW_ST_<year>` tabs
instead — data the metrics sync already extracted with the same
`extractPeerReviewCyclesWithReviewer_`, so the two cannot disagree (verified: across all 155
tickets the RAW-derived validator matched the changelog-derived one exactly, blanks included).
The index is lazy and memoised per run, so a re-sync where every ticket is unchanged never builds
it at all. Same 155 tickets: **~5 seconds**.

Two backstops remain, both reported in the sync response:
- `INCIDENT_SYNC_TIME_BUDGET_MS` (40s) stops a run early and returns `capped: true`; the UI says
  to run it again. This is normal, not an error.
- `changelogFetches` counts live fallbacks — one per tagged ticket the RAW tabs don't cover yet.
  A spike here means the metrics sync is behind, not that Jira slowed down.

So: **run `syncAllTeams` before a large first incident sync**, and the incident sync stays cheap.

### Validator attribution (read this before changing it)

The validator is the assignee **at the moment the ticket entered "For Peer Review"** — the doer
picks a reviewer and hands off in one action, so the assignee set on that transition IS the reviewer.

`extractPeerReviewCyclesWithReviewer_` therefore records TWO snapshots per cycle:

| Field | Snapshot | Consumed by |
|---|---|---|
| `reviewerAtEntry` | assignee when the cycle **opened** | Incident Logs validator |
| `reviewer` | assignee when the cycle **closed** | Peer Review Wait report |

They genuinely differ. On ST-84873: Jasper Razo was assigned going into For Peer Review, then
Angelo Nico Ravilas was assigned going on to For Checking. `reviewerAtEntry` is Jasper (the
validator); `reviewer` is Angelo Nico, who picked it up at the *next* stage and never reviewed it.
Attributing to the exit assignee is what made the validator wrong on most tickets originally.

`reviewer` was left as-is rather than repointed, because `src/lib/peer-review.ts` already reports on
it — **the same attribution question applies to the Peer Review Wait report**, and it should be
decided deliberately rather than changed as a side effect.

### Designated validators

Only the people in `INCIDENT_VALIDATOR_NAMES_DEFAULT` (Angelo Fajardo, Jasper Razo, Mark Jayson
Manosca) can be recorded as a validator. Anyone else appearing as the assignee on a
*For Peer Review* transition leaves the field **blank** rather than being credited with a review.

The changelog assignee is usually the reviewer but not always — a ticket can be moved into review
still assigned to the doer, or passed through by someone covering a queue. Those cases would credit
a review to somebody who never did one, and that feeds an evaluation. A blank is a much better
answer than a confidently wrong name. On the 2026 set the allowlist changed exactly two rows
(Marlon Montecerin, Rancel Reynoso → blank), which is the right order of magnitude: the
entry-assignee rule already got 26 of 28 right on its own.

Override the list with an `INCIDENT_VALIDATORS` script property (comma-separated), then run a
forced sync. Bump `INCIDENT_VALIDATOR_ATTRIBUTION` too if the change should revisit rows already
carrying the current marker.

### Manual validator override

`INCIDENT_TICKETS` keeps **two** validator columns, and the distinction matters:

| Column | Holds | Written by |
|---|---|---|
| `validator` | the **derived** value | the sync only |
| `validator_override` | the **manual** value | `setValidator` only |

`list()` composes the effective value as `override \|\| derived`. Neither writer touches the other's
column, which is what makes clearing an override reveal the real derivation underneath.

Getting this wrong is easy and was in fact gotten wrong first: the initial version had
`setValidator` write the effective value into `validator`, which destroyed the derived value — so
clearing an override "fell back" to the override that had just been cleared and the wrong name
stuck permanently. Keep the two columns independent.

`setValidator` rejects any name outside the designated validators rather than accepting it, and
matches case-insensitively so a lowercase entry is canonicalised rather than refused.

Two consequences worth knowing:

- A RAW row synced before `reviewerAtEntry` existed yields nothing from the index and falls back to
  a live changelog fetch. That self-heals as `syncAllTeams` re-syncs, so no coordinated backfill is
  needed — but until then `changelogFetches` stays high and syncs are slow.
- `validator_source` stamps every row with `INCIDENT_VALIDATOR_ATTRIBUTION`. This is what makes a
  forced re-derive **converge**: `force` ignores the updated-unchanged skip, so without the marker
  every run redoes the same first N tickets until the time budget expires and never reaches the
  rest — repeated runs make no progress at all. Rows already carrying the current marker are skipped
  even under force. **Bump that constant whenever the derivation changes meaning**; that alone makes
  the next forced sync revisit every row exactly once.

To re-derive after such a change: `POST /api/gas/incidents/sync` with `{"force": true}`, repeatedly
until the response reports `capped: false`. (The 2026 cutover took 2 runs for 38 tickets: 27 then 11.)

### Issue-type groups

The incident view segregates tickets into `Backend Changes` (Backend Changes, Account Creation,
Task, Company Policy, Data Deletion, Technical Story), `Investigation` (Data Generation,
Investigation), and `Others` for anything unlisted — so a new Jira issue type shows up as
uncategorised and obvious instead of silently inflating a real group.

Derived on read from `issue_type`, not stored, so changing the grouping takes effect immediately
without re-syncing every row.

**This is not the same split as `CYCLE_TIME_INVESTIGATION_ISSUE_TYPES` in `JiraSync.gs`**, which
also counts External Support Request and Team Viewer as investigations. That list decides which
status ends cycle time; this one is a reporting grouping. Independent on purpose — don't unify them
without confirming both meanings should move.

### Scores

Two 100-based numbers, both computed over whatever period is filtered:

```
individual = 100 - (sum of that person's severity deductions)
team       = 100 - (team's total deductions / active roster size)
```

Severity impacts are stored negative (S1 = -3); the scores subtract their MAGNITUDE, so incidents
always push a score down.

The team denominator is the **full active roster**, not just people who had an incident. That makes
the team score the true average of its members' individual scores — since `avg(100 - d_i)` equals
`100 - avg(d_i)` and a member with no incidents contributes 100 — and it keeps the number stable.
Dividing by "people with logs" would score a team where one person slipped once the same as a team
where everyone did.

Not clamped at 0: it would take 34 S1 incidents by one person to go negative, so a negative score
is more useful as a signal that something is wrong with the data than a floor quietly hiding it.

Team scores always cover the whole team, **even when a member filter is active** — the team's score
doesn't change because you're looking at one person. That's why `computeIncidentStats_` takes the
member-unfiltered log set as a separate `scoreLogs` argument.

**Ordering matters in `list()`.** The date window is applied immediately after the team filter,
before anything is derived from those lists. It originally ran last, which silently broke both
derivations downstream of it: the member dropdown offered people with no logs in the window, and the
team score was computed across every date on record regardless of the selected period — Q1 with zero
logs still reported the full-year score. Keep the range filter first.

### Filters

`year` plus a single `period` — `''` (full year), `Q1`-`Q4`, or `01`-`12`. One control because a
quarter and a month are mutually exclusive; two selects would allow "Q1 and also August".

`member` filters on the **log's** person, not the ticket's doer/validator: the question is which
incidents a person is accountable for, and on a ticket where they were only the validator, the
doer's name is irrelevant to that. A tagged ticket with no log for them drops out entirely,
including from the awaiting-feedback queue. Options come from logs in the current window, collected
before the member filter is applied so selecting someone doesn't collapse the dropdown to one entry.

### The tracked window

`INCIDENT_SYNC_START_DATE_DEFAULT` (`2026-01-01`) is a **fixed floor**, not a rolling lookback —
incidents feed evaluations, and a rolling window would silently drop the earliest month of history
every time it moved. Override it with an `INCIDENT_SYNC_START_DATE` script property (`yyyy-MM-dd`)
to move the floor without a redeploy.

It is enforced in two places, and both are needed:
- the JQL `updated >= floor` clause, a cheap prefilter and a safe superset (a ticket cannot be
  created or resolved after its own last-updated timestamp);
- a precise per-ticket check on `incident_date`, which is what the year/month filter actually keys
  on. Without it, a 2025 incident touched in 2026 would pass the JQL and land under 2025 on screen.

Narrowing the floor also **prunes** rows already stored from before it — otherwise the window would
only stop new rows arriving and leave the old ones in the list forever. A ticket that already has an
incident log is exempt and reported as `prunedKeptBecauseLogged`: that log is manager-written
feedback feeding someone's evaluation, and orphaning it to tidy a date range would destroy the most
valuable data on the page to remove the least valuable.

Observed on the 2026 cutover: `prunedBefore: 117` (9 from 2024, 108 from 2025), `outOfWindow: 21`
per run, leaving 38 tickets and a year filter offering only 2026. The prune is a one-time cost —
117 individual row deletions took ~38s; the next run was 5s.

## AI cost control (read before adding a trigger)

**There is deliberately NO scheduled AI.** `installTriggers` does not create a trigger for
`generateInsightsAllTeams`, and lists it for deletion so re-running actively removes one.

It used to run daily at 06:00: 4 Groq requests a day (3 teams + rollup), roughly 1,460 a year,
generating narratives whether anyone opened the dashboard or not. On a free tier that is the whole
budget spent unattended.

Insights are now generated on request through the `generate-insight` route, and served from
`INSIGHTS_CACHE` on every page view. **A page load costs zero AI requests.**

Two mechanisms keep it that way:

- `source_version` on each `INSIGHTS_CACHE` row fingerprints the metrics the insight was generated
  from. `generateInsightForScope_` recomputes that fingerprint and returns early — no model call —
  when it matches. `force=true` bypasses it. The fingerprint covers the *aggregated* figures the
  prompt contains, so a single new ticket that doesn't move them changes nothing.
- `AI_MODELS` in `AiClient.gs` has two tiers, picked per call site. Narrative insights use `fast`
  (Llama 3.1 8B) because they are prose written around numbers that are already computed and
  verified; that needs fluency, not reasoning.

If you do want it scheduled, add a trigger for `generateInsightsAllTeams` by hand — it still works,
and the source-version check means an unchanged-metrics run skips the model call anyway.

## Installing the recurring triggers (after Milestones 1-5 are all deployed)

Run `installTriggers` once from the editor. It installs `syncAllTeams` (every 2h),
`syncInitiativeTickets` (every 4h), `syncIncidentTickets` (daily, ~7am Asia/Manila),
`aggregateAllTeams` (every 2h, staggered ~2min later), and `generateInsightsAllTeams`
(daily, ~6am Asia/Manila) — and is safe to re-run any time (it clears old triggers for
these functions first, so it never creates duplicates).

**Do this only after the initial 2-year backfill (`runInitialBackfill`) has completed
for all teams** — `syncTeam_` intentionally no-ops until `SYNC_CHECKPOINT.last_full_backfill_completed_at`
is set, so installing triggers early just means synced-nothing runs every 2h until then, which is harmless but pointless.

## Reviewing ERROR_LOG

Sync failures that shouldn't abort the whole run (currently: unparseable
`customfield_11153` text-datetime values) are logged to `PlatOps - Jira Data` →
`ERROR_LOG` instead of throwing. Periodically:

1. Sort/filter by `field` to spot a recurring pattern (e.g. one product's tickets
   always fail — often means their `customfield_11153` values come from a slightly
   different format than the `YYYY-MM-DD HH:mm:ss` regex in `parseResolvedDateField_`
   expects).
2. Cross-reference `issue_key` against Jira directly to see the real raw value and
   adjust the regex/parsing if a new format shows up.
3. There's no automatic cleanup — old rows stay until you delete them manually; the
   table is small enough (one row per failure) that this doesn't need automation yet.

## Load-testing before relying on this for a real MBR/QBR

Once the full 2-year backfill and a few aggregation runs have completed, load the
Next.js dashboard against the real dataset and check:

- `[team]` page load time with `range=year` (the widest `METRICS_DAILY` scan)
- `[team]/performance` with several months selected
- Whether `METRICS_DAILY` has grown roughly as predicted (~13k rows for 3 teams x 2
  years x ~6 issue types) — if it's far larger, issue types may be more numerous than
  expected and worth checking `TEAMS_CONFIG.issue_types_csv` accuracy

If page loads feel slow, the fix is almost always in `MetricsApi.gs` (e.g. cache
`getMetricsDailyRowsInRange_`'s full-sheet read across calls within one request) —
the raw ticket tabs should never be in the request path at all.

## Active-effort-time tracking (ST only)

Tracks total minutes an ST ticket actually spent In Progress, summed across every
cycle — handles tickets that bounce In Progress → On Hold → In Progress → ... →
resolved, unlike `cycle_time` (which is one elapsed span from first-out-of-backlog
to resolution and includes On Hold/For Checking time). Gated by
`TEAMS_CONFIG.has_in_progress_tracking` (TRUE for ST, FALSE for DE/DEV) — the
extraction reuses the changelog fetch ST already makes for holding-reason tracking,
so this adds no extra Jira API calls for ST.

Rollout steps for the already-provisioned spreadsheets (fresh `setupAll()` runs pick
this up automatically):

1. Run `migrateAddInProgressTracking` (Setup.gs) once — adds
   `has_in_progress_tracking` to `TEAMS_CONFIG` (TRUE for ST), `total_in_progress_minutes`
   to every `RAW_ST_<year>`/`RAW_DE_<year>`/`RAW_DEV_<year>` tab, and
   `avg_in_progress_minutes` to `METRICS_BY_ASSIGNEE_MONTHLY`.
2. Run `runStInProgressRebackfill` (Backfill.gs) once — backfills
   `total_in_progress_minutes` into ST's existing RAW rows (self-continuing across
   executions like the other backfills; only touches tickets that were ever In Progress).
3. Run `aggregateAllTeams` (or wait for its next trigger) to recompute
   `avg_in_progress_minutes` in `METRICS_BY_ASSIGNEE_MONTHLY` from the backfilled data.
4. Smoke-test: `curl "<URL>?route=assignee-metrics&apiKey=<KEY>&team=ST&range=month&period=2026-07"`
   — each assignee should have a non-null `avgInProgressMinutes`.

**Week-range caveat:** `avgInProgressMinutes` (like the existing `avgLeadTimeMinutes`/
`avgCycleTimeMinutes`) is rolled up from `METRICS_BY_ASSIGNEE_MONTHLY`, which is
monthly-grain — `range=week` sums the entire month(s) overlapping that week, not just
the week's days. Pre-existing limitation of the assignee-metrics endpoint, not new to
this feature.

## Manifest (appsscript.json)

`gas/appsscript.json` sets the project timezone to `Asia/Manila` (matches the
`TIMEZONE` constant hardcoded in `Utils.gs`, which the text-datetime parsing and daily
trigger scheduling both depend on), the Web App access/executeAs settings, and the
OAuth scopes needed (Sheets, external requests for Jira/the AI provider, and mail for alerts).
In the Apps Script editor: Project Settings → check "Show `appsscript.json` manifest
file in editor", then paste this file's contents in to replace the default.
