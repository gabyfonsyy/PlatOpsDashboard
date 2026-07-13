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

    for (const issue of page.issues) {
      try {
        processAndUpsertIssue_(team, issue);
      } catch (issueErr) {
        Logger.log(`processAndUpsertIssue_ failed for ${issue.key}: ${issueErr}`);
        logSyncError_(team.team_key, issue.key, 'upsert', '', String(issueErr));
      }
    }
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

/**
 * Targeted re-backfill for ST on-hold holding reasons. Only fetches ST tickets that
 * have ever been in "On Hold" status (status WAS "On Hold") since the holding-reason
 * field was introduced, re-extracts all on-hold cycles via changelog, and upserts
 * holding_reasons_json + total_on_hold_minutes into the existing RAW rows.
 *
 * Uses Script Properties (ST_HOLDING_REBACKFILL_CURSOR) for its cursor so it never
 * touches SYNC_CHECKPOINT or interferes with the regular sync triggers.
 *
 * Run once manually. Adjust ST_HOLDING_BACKFILL_SINCE below if the holding-reason
 * field was introduced on a date other than 2025-01-01.
 */
const ST_HOLDING_BACKFILL_SINCE = '2025-01-01';
const ST_HOLDING_CURSOR_KEY = 'ST_HOLDING_REBACKFILL_CURSOR';

function runStHoldingRebackfill() {
  const team = getActiveTeamsConfig_().find((t) => t.team_key === 'ST');
  if (!team) throw new Error('ST team not found in active config — check TEAMS_CONFIG.');

  const props = PropertiesService.getScriptProperties();
  const pageToken = props.getProperty(ST_HOLDING_CURSOR_KEY) || undefined;

  const jql = `project = ${team.jira_project_key} AND created >= "${ST_HOLDING_BACKFILL_SINCE}" AND status WAS "On Hold" ORDER BY created ASC`;
  const fields = buildJiraFieldList_(team);

  let page;
  try {
    page = jiraSearchIssues_(jql, pageToken, 100, fields);
  } catch (err) {
    notifyFailure_('runStHoldingRebackfill: Jira fetch failed', err);
    deleteStHoldingTrigger_();
    ScriptApp.newTrigger('runStHoldingRebackfill').timeBased().after(5000).create();
    return;
  }

  if (page.nextPageToken && page.nextPageToken === pageToken) {
    notifyFailure_('runStHoldingRebackfill stalled', 'nextPageToken did not advance — check Jira response.');
    deleteStHoldingTrigger_();
    return;
  }

  for (const issue of page.issues) {
    try {
      processAndUpsertIssue_(team, issue);
    } catch (issueErr) {
      Logger.log(`runStHoldingRebackfill failed for ${issue.key}: ${issueErr}`);
      logSyncError_(team.team_key, issue.key, 'holding_rebackfill', '', String(issueErr));
    }
  }
  flushDirtyDates_(team.team_key);

  if (page.nextPageToken && page.issues.length > 0) {
    props.setProperty(ST_HOLDING_CURSOR_KEY, page.nextPageToken);
    deleteStHoldingTrigger_();
    ScriptApp.newTrigger('runStHoldingRebackfill').timeBased().after(1000).create();
    return;
  }

  props.deleteProperty(ST_HOLDING_CURSOR_KEY);
  deleteStHoldingTrigger_();
  sendAlertEmail_(
    'ST holding re-backfill complete',
    `All ST tickets since ${ST_HOLDING_BACKFILL_SINCE} that were ever On Hold have been re-processed with multi-cycle holding data.`
  );
}

function deleteStHoldingTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runStHoldingRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Targeted re-backfill for ST's total_in_progress_minutes (active-effort-time tracking).
 * Only fetches ST tickets that have ever been In Progress since BACKFILL_START_DATE,
 * re-extracts all in-progress cycles via changelog, and upserts total_in_progress_minutes
 * into the existing RAW rows. Run once, after migrateAddInProgressTracking (Setup.gs) and
 * after has_in_progress_tracking is confirmed TRUE for ST in TEAMS_CONFIG.
 *
 * Uses Script Properties (ST_IN_PROGRESS_REBACKFILL_CURSOR) for its cursor so it never
 * touches SYNC_CHECKPOINT or interferes with the regular sync triggers.
 */
const ST_IN_PROGRESS_CURSOR_KEY = 'ST_IN_PROGRESS_REBACKFILL_CURSOR';

function runStInProgressRebackfill() {
  const team = getActiveTeamsConfig_().find((t) => t.team_key === 'ST');
  if (!team) throw new Error('ST team not found in active config — check TEAMS_CONFIG.');
  if (!team.has_in_progress_tracking) {
    throw new Error('ST.has_in_progress_tracking is not TRUE — run migrateAddInProgressTracking first.');
  }

  const props = PropertiesService.getScriptProperties();
  const pageToken = props.getProperty(ST_IN_PROGRESS_CURSOR_KEY) || undefined;

  const jql = `project = ${team.jira_project_key} AND created >= "${BACKFILL_START_DATE}" AND status WAS "In Progress" ORDER BY created ASC`;
  const fields = buildJiraFieldList_(team);

  let page;
  try {
    page = jiraSearchIssues_(jql, pageToken, 100, fields);
  } catch (err) {
    notifyFailure_('runStInProgressRebackfill: Jira fetch failed', err);
    deleteStInProgressTrigger_();
    ScriptApp.newTrigger('runStInProgressRebackfill').timeBased().after(5000).create();
    return;
  }

  if (page.nextPageToken && page.nextPageToken === pageToken) {
    notifyFailure_('runStInProgressRebackfill stalled', 'nextPageToken did not advance — check Jira response.');
    deleteStInProgressTrigger_();
    return;
  }

  for (const issue of page.issues) {
    try {
      processAndUpsertIssue_(team, issue);
    } catch (issueErr) {
      Logger.log(`runStInProgressRebackfill failed for ${issue.key}: ${issueErr}`);
      logSyncError_(team.team_key, issue.key, 'in_progress_rebackfill', '', String(issueErr));
    }
  }
  flushDirtyDates_(team.team_key);

  if (page.nextPageToken && page.issues.length > 0) {
    props.setProperty(ST_IN_PROGRESS_CURSOR_KEY, page.nextPageToken);
    deleteStInProgressTrigger_();
    ScriptApp.newTrigger('runStInProgressRebackfill').timeBased().after(1000).create();
    return;
  }

  props.deleteProperty(ST_IN_PROGRESS_CURSOR_KEY);
  deleteStInProgressTrigger_();
  sendAlertEmail_(
    'ST in-progress re-backfill complete',
    `All ST tickets since ${BACKFILL_START_DATE} that were ever In Progress have been re-processed with total_in_progress_minutes. Run aggregateAllTeams to recompute avg_in_progress_minutes.`
  );
}

function deleteStInProgressTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runStInProgressRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Lightweight re-backfill that corrects the RAW `due_date` column after it was switched from the
 * wrong custom field to Jira's native `duedate`. Unlike runInitialBackfill it does NOT re-fetch
 * changelogs or rewrite whole rows — it pulls only `created` + `duedate` per ticket and patches
 * just the due_date cell in the existing RAW row (one batched column write per year tab per page).
 *
 * Self-continuing across executions via per-team Script Property cursors, all active teams. Run
 * once from the editor. When it finishes, run backfillResolvedOnDate + backfillResolvedInMonth so
 * Backlog Aging recomputes from the corrected due dates. Safe to re-run (clear the DONE_ props to
 * force a full redo).
 */
const DUEDATE_REBACKFILL_CURSOR_PREFIX = 'DUEDATE_REBACKFILL_CURSOR_';
const DUEDATE_REBACKFILL_DONE_PREFIX = 'DUEDATE_REBACKFILL_DONE_';

function runDueDateRebackfill() {
  const props = PropertiesService.getScriptProperties();
  const teams = getActiveTeamsConfig_();

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    if (props.getProperty(DUEDATE_REBACKFILL_DONE_PREFIX + team.team_key)) continue;

    const pageToken = props.getProperty(DUEDATE_REBACKFILL_CURSOR_PREFIX + team.team_key) || undefined;
    const jql = buildJqlBackfillFull_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, pageToken, 100, ['created', 'duedate']);
    } catch (err) {
      notifyFailure_(`runDueDateRebackfill: Jira fetch failed for ${team.jira_project_key}`, err);
      deleteDueDateRebackfillTrigger_();
      ScriptApp.newTrigger('runDueDateRebackfill').timeBased().after(5000).create();
      return;
    }

    if (page.nextPageToken && page.nextPageToken === pageToken) {
      notifyFailure_(`runDueDateRebackfill stalled for ${team.jira_project_key}`, 'nextPageToken did not advance — check Jira response.');
      deleteDueDateRebackfillTrigger_();
      return;
    }

    // Group this page's due-date updates by the ticket's created-year (RAW tabs are sharded by it).
    const updatesByYear = {};
    page.issues.forEach((issue) => {
      const created = issue.fields && issue.fields.created;
      if (!created) return;
      const year = new Date(created).getFullYear();
      (updatesByYear[year] = updatesByYear[year] || {})[issue.key] =
        extractJiraFieldValue_(issue.fields.duedate);
    });
    Object.keys(updatesByYear).forEach((year) => applyDueDateUpdates_(team.team_key, year, updatesByYear[year]));

    if (page.nextPageToken && page.issues.length > 0) {
      props.setProperty(DUEDATE_REBACKFILL_CURSOR_PREFIX + team.team_key, page.nextPageToken);
      deleteDueDateRebackfillTrigger_();
      ScriptApp.newTrigger('runDueDateRebackfill').timeBased().after(1000).create();
      return;
    }

    props.setProperty(DUEDATE_REBACKFILL_DONE_PREFIX + team.team_key, nowIso_());
    props.deleteProperty(DUEDATE_REBACKFILL_CURSOR_PREFIX + team.team_key);
  }

  deleteDueDateRebackfillTrigger_();
  sendAlertEmail_(
    'Due-date re-backfill complete',
    'All active teams have had RAW due_date corrected from Jira native duedate. Now run backfillResolvedOnDate and backfillResolvedInMonth so Backlog Aging recomputes.'
  );
}

/** Patches the due_date cell for the given issue keys in one RAW_<team>_<year> tab (single batched write). */
function applyDueDateUpdates_(teamKey, year, keyToDue) {
  const sheet = getOrCreateRawTab_(teamKey, year);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const keyCol = headers.indexOf('issue_key');
  const dueCol = headers.indexOf('due_date');
  if (keyCol === -1 || dueCol === -1) return;

  const keys = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
  const dues = sheet.getRange(2, dueCol + 1, lastRow - 1, 1).getValues();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i][0];
    if (k && Object.prototype.hasOwnProperty.call(keyToDue, k)) {
      dues[i][0] = keyToDue[k];
      changed = true;
    }
  }
  if (changed) sheet.getRange(2, dueCol + 1, dues.length, 1).setValues(dues);
}

function deleteDueDateRebackfillTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runDueDateRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
