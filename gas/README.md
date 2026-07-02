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
8. `Insights.gs` — Gemini narrative generation + deterministic outlier detection
9. `Code.gs` — the `doGet`/`doPost` router, ties everything together
10. `LeaveApi.gs`, `RtoApi.gs`, `ProjectsApi.gs`
11. `Setup.gs` — one-time bootstrap, not called by the router
12. `Triggers.gs` — installs every recurring trigger, run last of all

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
   GEMINI_API_KEY=<Gemini free-tier API key>
   API_SHARED_SECRET=<generate a random string, e.g. `openssl rand -hex 24`>
   ```
4. In the editor, select the `setupAll` function (top dropdown) and click **Run**.
   First run will prompt for authorization — grant access to both spreadsheets.
   This builds every tab in both files (see the schema in the project plan, Section 2).
5. Open `PlatOps - Manager Data` → `TEAMS_CONFIG` tab and confirm the 3 pre-filled rows
   (ST/DE/DEV) look right — especially `issue_types_csv`, which is left blank for you to
   fill in with your real Jira issue types (comma-separated, no spaces after commas).
6. Populate the `ROSTER` tab with real team members (used for per-person filtering and
   Gemini outlier flagging later).
7. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access
   **Anyone**. Copy the `/exec` URL.
8. In the Next.js app's `.env.local`, set:
   ```
   GAS_WEB_APP_URL=<the /exec URL from step 7>
   GAS_API_KEY=<the same value as API_SHARED_SECRET from step 3>
   ```

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
```

Hand-verify the returned `fcrRate`/`escalationRate`/`backlogAgingRate`/lead-cycle-time
averages against a handful of tickets you know the history of before trusting the
numbers for a real MBR/QBR.

## Gemini insights (Milestone 5)

`GEMINI_API_KEY` must already be set in Script Properties (see step 3). Smoke-test once
`Insights.gs` is pasted in:

1. Select `generateInsightsAllTeams` in the function dropdown and click **Run**.
2. Check `PlatOps - Manager Data` → `INSIGHTS_CACHE` — one row per team (`TEAM:ST`, etc.)
   plus `ROLLUP:ALL`, each with `generation_status = SUCCESS` and a `narrative_text`.
3. Read the narratives for hallucination/accuracy before trusting them for a real
   MBR/QBR — the prompt only receives aggregated numbers (never raw tickets), but LLM
   output should still be spot-checked, especially early on.
4. Confirm `gemini-2.0-flash` (the model id hardcoded in `Insights.gs`) is still current
   on the [Gemini API free tier](https://ai.google.dev/gemini-api/docs/pricing) — model
   availability shifts over time.

## Installing the recurring triggers (after Milestones 1-5 are all deployed)

Run `installTriggers` once from the editor. It installs `syncAllTeams` (every 2h),
`aggregateAllTeams` (every 2h, staggered ~2min later), and `generateInsightsAllTeams`
(daily, ~6am Asia/Manila) — and is safe to re-run any time (it clears old triggers for
these functions first, so it never creates duplicates).

**Do this only after the initial 2-year backfill (`runInitialBackfill`) has completed
for all teams** — `syncTeam_` intentionally no-ops until `SYNC_CHECKPOINT.last_full_backfill_completed_at`
is set, so installing triggers early just means synced-nothing runs every 2h until then, which is harmless but pointless.

## Manifest (appsscript.json)

`gas/appsscript.json` sets the project timezone to `Asia/Manila` (matches the
`TIMEZONE` constant hardcoded in `Utils.gs`, which the text-datetime parsing and daily
trigger scheduling both depend on), the Web App access/executeAs settings, and the
OAuth scopes needed (Sheets, external requests for Jira/Gemini, and mail for alerts).
In the Apps Script editor: Project Settings → check "Show `appsscript.json` manifest
file in editor", then paste this file's contents in to replace the default.
