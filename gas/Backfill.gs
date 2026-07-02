/**
 * One-time historical backfill (2 years, per team). A single execution cannot finish
 * this — Apps Script caps executions at 6 minutes — so this processes ONE JQL page
 * (100 issues, with changelog fetch for the subset that needs it) per execution, then
 * reschedules itself via a one-off trigger firing ~1s later, until every active team's
 * SYNC_CHECKPOINT.last_full_backfill_completed_at is set.
 *
 * Run manually from the Apps Script editor (select runInitialBackfill, click Run) once
 * per team's first-ever setup. Safe to re-run: already-complete teams are skipped.
 */

// Calendar-aligned, not a rolling window — matches the RAW_<TEAM>_<YEAR> tab sharding
// (2024/2025/2026) rather than "the last 730 days from whenever this happens to run."
const BACKFILL_START_DATE = '2024-01-01';

function runInitialBackfill() {
  const teams = getActiveTeamsConfig_();

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const checkpoint = readSyncCheckpoint_(team.jira_project_key);
    if (checkpoint.last_full_backfill_completed_at) continue;

    // backfill_cursor holds an opaque nextPageToken string (falsy/empty = first page) —
    // /rest/api/3/search/jql paginates by token, not numeric offset (see JiraClient.gs).
    const pageToken = checkpoint.backfill_cursor || undefined;
    const jql = buildJqlBackfillFull_(team);
    const fields = buildJiraFieldList_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, pageToken, 100, fields);
    } catch (err) {
      notifyFailure_(`runInitialBackfill failed for ${team.jira_project_key}`, err);
      writeSyncStatus_(team.jira_project_key, {
        last_sync_status: 'FAILED',
        last_sync_run_at: nowIso_(),
        last_sync_error_message: String(err),
      });
      // Reschedule anyway — a transient Jira outage shouldn't permanently strand the backfill.
      scheduleBackfillContinuation_();
      return;
    }

    if (page.nextPageToken && page.nextPageToken === pageToken) {
      // Guards against a reported /rest/api/3/search/jql bug where nextPageToken can
      // fail to advance (Atlassian community reports of endless identical pages) —
      // stop and surface it rather than looping forever burning Jira API quota.
      const message = `Backfill stalled for ${team.jira_project_key}: nextPageToken did not advance past the same page.`;
      writeSyncStatus_(team.jira_project_key, { last_sync_status: 'FAILED', last_sync_run_at: nowIso_(), last_sync_error_message: message });
      notifyFailure_(`runInitialBackfill stalled for ${team.jira_project_key}`, message);
      return; // do not reschedule — needs a human to check the Jira response before retrying
    }

    page.issues.forEach((issue) => processAndUpsertIssue_(team, issue));
    flushDirtyDates_(team.team_key);

    const ticketsSoFar = (Number(checkpoint.tickets_synced_last_run) || 0) + page.issues.length;

    if (page.nextPageToken && page.issues.length > 0) {
      writeSyncStatus_(team.jira_project_key, {
        backfill_cursor: page.nextPageToken,
        last_sync_status: 'IN_PROGRESS',
        last_sync_run_at: nowIso_(),
        tickets_synced_last_run: ticketsSoFar,
      });
      scheduleBackfillContinuation_();
      return; // end this execution slice — the continuation trigger resumes it
    }

    markTeamBackfillComplete_(team.jira_project_key, ticketsSoFar);
    // Falls through to the next team in this SAME execution if there's one —
    // small teams (DE/DEV) can finish well within one 6-minute run.
  }

  deleteBackfillContinuationTrigger_();
  sendAlertEmail_('Initial backfill complete for all teams', 'All active teams have finished their 2-year historical Jira backfill.');
}

function buildJqlBackfillFull_(team) {
  return `project = ${team.jira_project_key} AND created >= "${BACKFILL_START_DATE}" ORDER BY created ASC`;
}

function markTeamBackfillComplete_(projectKey, ticketsSynced) {
  const now = nowIso_();
  writeSyncStatus_(projectKey, {
    last_full_backfill_completed_at: now,
    last_synced_updated_ts: now, // incremental sync picks up from here going forward
    backfill_cursor: '',
    last_sync_status: 'SUCCESS',
    last_sync_run_at: now,
    tickets_synced_last_run: ticketsSynced,
  });
}

function scheduleBackfillContinuation_() {
  deleteBackfillContinuationTrigger_();
  ScriptApp.newTrigger('runInitialBackfill').timeBased().after(1000).create();
}

function deleteBackfillContinuationTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runInitialBackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
