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

const BACKFILL_WINDOW_DAYS = 730;

function runInitialBackfill() {
  const teams = getActiveTeamsConfig_();

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const checkpoint = readSyncCheckpoint_(team.jira_project_key);
    if (checkpoint.last_full_backfill_completed_at) continue;

    const startAt = Number(checkpoint.backfill_cursor) || 0;
    const jql = buildJqlBackfillFull_(team);
    const fields = buildJiraFieldList_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, startAt, 100, fields);
    } catch (err) {
      notifyFailure_(`runInitialBackfill failed for ${team.jira_project_key} at startAt=${startAt}`, err);
      writeSyncStatus_(team.jira_project_key, {
        last_sync_status: 'FAILED',
        last_sync_run_at: nowIso_(),
        last_sync_error_message: String(err),
      });
      // Reschedule anyway — a transient Jira outage shouldn't permanently strand the backfill.
      scheduleBackfillContinuation_();
      return;
    }

    page.issues.forEach((issue) => processAndUpsertIssue_(team, issue));
    flushDirtyDates_(team.team_key);

    const nextStartAt = startAt + page.issues.length;
    if (page.issues.length > 0 && nextStartAt < page.total) {
      writeSyncStatus_(team.jira_project_key, {
        backfill_cursor: nextStartAt,
        last_sync_status: 'IN_PROGRESS',
        last_sync_run_at: nowIso_(),
        tickets_synced_last_run: nextStartAt,
      });
      scheduleBackfillContinuation_();
      return; // end this execution slice — the continuation trigger resumes it
    }

    markTeamBackfillComplete_(team.jira_project_key, nextStartAt);
    // Falls through to the next team in this SAME execution if there's one —
    // small teams (DE/DEV) can finish well within one 6-minute run.
  }

  deleteBackfillContinuationTrigger_();
  sendAlertEmail_('Initial backfill complete for all teams', 'All active teams have finished their 2-year historical Jira backfill.');
}

function buildJqlBackfillFull_(team) {
  return `project = ${team.jira_project_key} AND created >= -${BACKFILL_WINDOW_DAYS}d ORDER BY created ASC`;
}

function markTeamBackfillComplete_(projectKey, ticketsSynced) {
  const now = nowIso_();
  writeSyncStatus_(projectKey, {
    last_full_backfill_completed_at: now,
    last_synced_updated_ts: now, // incremental sync picks up from here going forward
    backfill_cursor: 0,
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
