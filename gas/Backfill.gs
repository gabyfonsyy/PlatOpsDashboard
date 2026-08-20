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
      if (isExpiredPageTokenError_(err)) {
        // Not transient like a Jira outage — the same token will fail forever, so clear it
        // instead of rescheduling a continuation that would just repeat this failure.
        writeSyncStatus_(team.jira_project_key, {
          backfill_cursor: '',
          last_sync_status: 'FAILED',
          last_sync_run_at: nowIso_(),
          last_sync_error_message: String(err),
        });
        notifyFailure_(
          `runInitialBackfill: page token expired for ${team.jira_project_key}, cursor reset`,
          `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired. The cursor has been cleared — re-run runInitialBackfill manually to restart ${team.jira_project_key} from the beginning (upserts are idempotent by issue_key).`
        );
        deleteBackfillContinuationTrigger_();
        return;
      }
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
    deleteStHoldingTrigger_();
    if (isExpiredPageTokenError_(err)) {
      props.deleteProperty(ST_HOLDING_CURSOR_KEY);
      notifyFailure_(
        'runStHoldingRebackfill: page token expired, cursor reset',
        `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runStHoldingRebackfill manually to restart from the beginning (upserts are idempotent by issue_key).`
      );
      return;
    }
    notifyFailure_('runStHoldingRebackfill: Jira fetch failed', err);
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
 * Targeted re-backfill for ST "For Peer Review" cycles (peer_review_cycles_json) AND the
 * cycle_time_start/cycle_time_end columns (extractReviewCycleTimeRange_ in JiraSync.gs) —
 * both are computed from the same changelog walk inside processAndUpsertIssue_'s
 * has_peer_review_tracking block, so one rebackfill covers both. Fetches ST tickets that have
 * ever been in any status that can end cycle time (see cycleTimeEndStatusesForIssueType_ in
 * JiraSync.gs): For Peer Review or For Checking for the normal review path, For Product Team
 * for the Investigations path, and Archived/Rejected for every issue type regardless of path
 * (a ticket archived/rejected outright never reaches a review status at all, so it needs its
 * own JQL clause too, or it'd never get cycle_time_start/end populated). Re-extracts everything
 * via changelog and upserts into the existing RAW rows. Needed because ordinary incremental
 * sync only reprocesses tickets Jira has touched since the last checkpoint — historical
 * tickets that already passed through one of these statuses but haven't been touched since
 * would otherwise never get these fields populated (or re-populated after the cycle-time
 * formula change). After running this, aggregateAllTeams's normal dirty-date pickup recomputes
 * the affected historical METRICS_DAILY/METRICS_BY_ASSIGNEE_MONTHLY cycle-time averages
 * automatically.
 *
 * Uses its own Script Properties cursor (ST_PEER_REVIEW_REBACKFILL_CURSOR) so it never
 * touches SYNC_CHECKPOINT or interferes with the regular sync triggers. Mirrors
 * runStHoldingRebackfill exactly. Run once manually (and again any time the cycle-time or
 * peer-review extraction logic changes, to re-derive historical rows under the new logic) —
 * safe to just re-run: it deletes its own cursor on completion rather than a permanent
 * done-flag, so nothing needs resetting first.
 */
const ST_PEER_REVIEW_BACKFILL_SINCE = '2025-01-01';
const ST_PEER_REVIEW_CURSOR_KEY = 'ST_PEER_REVIEW_REBACKFILL_CURSOR';

function runStPeerReviewRebackfill() {
  const team = getActiveTeamsConfig_().find((t) => t.team_key === 'ST');
  if (!team) throw new Error('ST team not found in active config — check TEAMS_CONFIG.');

  const props = PropertiesService.getScriptProperties();
  const pageToken = props.getProperty(ST_PEER_REVIEW_CURSOR_KEY) || undefined;

  const jql = `project = ${team.jira_project_key} AND created >= "${ST_PEER_REVIEW_BACKFILL_SINCE}" AND (status WAS "For Peer Review" OR status WAS "For Checking" OR status WAS "For Product Team" OR status WAS "Archived" OR status WAS "Rejected") ORDER BY created ASC`;
  const fields = buildJiraFieldList_(team);

  let page;
  try {
    page = jiraSearchIssues_(jql, pageToken, 100, fields);
  } catch (err) {
    deleteStPeerReviewTrigger_();
    if (isExpiredPageTokenError_(err)) {
      props.deleteProperty(ST_PEER_REVIEW_CURSOR_KEY);
      notifyFailure_(
        'runStPeerReviewRebackfill: page token expired, cursor reset',
        `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runStPeerReviewRebackfill manually to restart from the beginning (upserts are idempotent by issue_key).`
      );
      return;
    }
    notifyFailure_('runStPeerReviewRebackfill: Jira fetch failed', err);
    ScriptApp.newTrigger('runStPeerReviewRebackfill').timeBased().after(5000).create();
    return;
  }

  if (page.nextPageToken && page.nextPageToken === pageToken) {
    notifyFailure_('runStPeerReviewRebackfill stalled', 'nextPageToken did not advance — check Jira response.');
    deleteStPeerReviewTrigger_();
    return;
  }

  for (const issue of page.issues) {
    try {
      processAndUpsertIssue_(team, issue);
    } catch (issueErr) {
      Logger.log(`runStPeerReviewRebackfill failed for ${issue.key}: ${issueErr}`);
      logSyncError_(team.team_key, issue.key, 'peer_review_rebackfill', '', String(issueErr));
    }
  }
  flushDirtyDates_(team.team_key);

  if (page.nextPageToken && page.issues.length > 0) {
    props.setProperty(ST_PEER_REVIEW_CURSOR_KEY, page.nextPageToken);
    deleteStPeerReviewTrigger_();
    ScriptApp.newTrigger('runStPeerReviewRebackfill').timeBased().after(1000).create();
    return;
  }

  props.deleteProperty(ST_PEER_REVIEW_CURSOR_KEY);
  deleteStPeerReviewTrigger_();
  sendAlertEmail_(
    'ST peer-review re-backfill complete',
    `All ST tickets since ${ST_PEER_REVIEW_BACKFILL_SINCE} that were ever in For Peer Review, For Checking, For Product Team, Archived, or Rejected have been re-processed with peer-review cycle data and the updated per-issue-type cycle-time definition (For Peer Review for backend-change types; For Checking or For Product Team for Investigations; Archived/Rejected end cycle time for any issue type). Historical METRICS_DAILY/METRICS_BY_ASSIGNEE_MONTHLY cycle-time averages will update automatically once aggregateAllTeams next processes the affected dates.`
  );
}

function deleteStPeerReviewTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runStPeerReviewRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Targeted re-backfill for DE/DEV's `resolved_datetime` — re-derives it from the changelog (moved
 * to Ready for Checking or Cancelled) instead of trusting resolved_date_field_id's raw text value,
 * which isn't reliably updated for every outcome. Confirmed on a real ticket (DEV-11408) that the
 * text field CAN be correct, but other tickets showed impossible negative lead/cycle times —
 * consistent with the field not being reliably set for every completion path (e.g. Cancelled).
 * processAndUpsertIssue_ no longer falls back to that field at all when the changelog doesn't
 * confirm the transition (blank beats wrong) — if you already ran this once under the old
 * fallback-preserving logic, run resetDeDevResolvedRebackfill first or this will just skip both
 * teams as already done.
 *
 * Mirrors runStPeerReviewRebackfill (re-fetches full issue + changelog, reprocesses via
 * processAndUpsertIssue_, which now applies this override for any resolved_date_field_type==='text'
 * team) but loops both DE and DEV with independent per-team cursors, same shape as
 * runDueDateRebackfill. Run once after deploying the updated JiraSync.gs. Self-continuing via
 * chained triggers. After it finishes, run backfillResolvedOnDate + backfillResolvedInMonth so the
 * columns that depend on resolved date recompute from the corrected values.
 */
const DE_DEV_RESOLVED_BACKFILL_SINCE = '2024-01-01';
const DE_DEV_RESOLVED_CURSOR_PREFIX = 'DE_DEV_RESOLVED_REBACKFILL_CURSOR_';
const DE_DEV_RESOLVED_DONE_PREFIX = 'DE_DEV_RESOLVED_REBACKFILL_DONE_';

function runDeDevResolvedRebackfill() {
  const props = PropertiesService.getScriptProperties();
  const teams = getActiveTeamsConfig_().filter((t) => t.resolved_date_field_type === 'text');

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    if (props.getProperty(DE_DEV_RESOLVED_DONE_PREFIX + team.team_key)) continue;

    const pageToken = props.getProperty(DE_DEV_RESOLVED_CURSOR_PREFIX + team.team_key) || undefined;
    const jql = `project = ${team.jira_project_key} AND created >= "${DE_DEV_RESOLVED_BACKFILL_SINCE}" AND (status WAS "Ready for Checking" OR status WAS "Cancelled") ORDER BY created ASC`;
    const fields = buildJiraFieldList_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, pageToken, 100, fields);
    } catch (err) {
      deleteDeDevResolvedRebackfillTrigger_();
      if (isExpiredPageTokenError_(err)) {
        props.deleteProperty(DE_DEV_RESOLVED_CURSOR_PREFIX + team.team_key);
        notifyFailure_(
          `runDeDevResolvedRebackfill: page token expired for ${team.jira_project_key}, cursor reset`,
          `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runDeDevResolvedRebackfill manually to restart ${team.jira_project_key} from the beginning (upserts are idempotent by issue_key).`
        );
        return;
      }
      notifyFailure_(`runDeDevResolvedRebackfill: Jira fetch failed for ${team.jira_project_key}`, err);
      ScriptApp.newTrigger('runDeDevResolvedRebackfill').timeBased().after(5000).create();
      return;
    }

    if (page.nextPageToken && page.nextPageToken === pageToken) {
      notifyFailure_(`runDeDevResolvedRebackfill stalled for ${team.jira_project_key}`, 'nextPageToken did not advance — check Jira response.');
      deleteDeDevResolvedRebackfillTrigger_();
      return;
    }

    page.issues.forEach((issue) => {
      try {
        processAndUpsertIssue_(team, issue);
      } catch (issueErr) {
        Logger.log(`runDeDevResolvedRebackfill failed for ${issue.key}: ${issueErr}`);
        logSyncError_(team.team_key, issue.key, 'de_dev_resolved_rebackfill', '', String(issueErr));
      }
    });
    flushDirtyDates_(team.team_key);

    if (page.nextPageToken && page.issues.length > 0) {
      props.setProperty(DE_DEV_RESOLVED_CURSOR_PREFIX + team.team_key, page.nextPageToken);
      deleteDeDevResolvedRebackfillTrigger_();
      ScriptApp.newTrigger('runDeDevResolvedRebackfill').timeBased().after(1000).create();
      return;
    }

    props.setProperty(DE_DEV_RESOLVED_DONE_PREFIX + team.team_key, nowIso_());
    props.deleteProperty(DE_DEV_RESOLVED_CURSOR_PREFIX + team.team_key);
  }

  deleteDeDevResolvedRebackfillTrigger_();
  sendAlertEmail_(
    'DE/DEV resolved-date re-backfill complete',
    'DE and DEV tickets that ever reached Ready for Checking or Cancelled have had resolved_datetime re-derived from the changelog. Run backfillResolvedOnDate and backfillResolvedInMonth next so dependent METRICS_DAILY/METRICS_BY_ASSIGNEE_MONTHLY columns recompute from the corrected values.'
  );
}

function deleteDeDevResolvedRebackfillTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runDeDevResolvedRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Clears the DONE_/CURSOR_ properties for both DE and DEV so the next runDeDevResolvedRebackfill
 * call does a full redo instead of skipping teams already marked complete. Needed whenever the
 * extraction logic in processAndUpsertIssue_/extractDeDevResolvedAt_ changes — e.g. the fallback-
 * to-the-raw-text-field behavior was removed after it turned out to reintroduce the exact bad
 * dates the changelog override was meant to fix. Run this once, then run runDeDevResolvedRebackfill.
 */
function resetDeDevResolvedRebackfill() {
  const props = PropertiesService.getScriptProperties();
  ['DE', 'DEV'].forEach((teamKey) => {
    props.deleteProperty(DE_DEV_RESOLVED_DONE_PREFIX + teamKey);
    props.deleteProperty(DE_DEV_RESOLVED_CURSOR_PREFIX + teamKey);
  });
  deleteDeDevResolvedRebackfillTrigger_();
  Logger.log('resetDeDevResolvedRebackfill: cleared. Run runDeDevResolvedRebackfill next.');
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
    deleteStInProgressTrigger_();
    if (isExpiredPageTokenError_(err)) {
      props.deleteProperty(ST_IN_PROGRESS_CURSOR_KEY);
      notifyFailure_(
        'runStInProgressRebackfill: page token expired, cursor reset',
        `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runStInProgressRebackfill manually to restart from the beginning (upserts are idempotent by issue_key).`
      );
      return;
    }
    notifyFailure_('runStInProgressRebackfill: Jira fetch failed', err);
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
      deleteDueDateRebackfillTrigger_();
      if (isExpiredPageTokenError_(err)) {
        props.deleteProperty(DUEDATE_REBACKFILL_CURSOR_PREFIX + team.team_key);
        notifyFailure_(
          `runDueDateRebackfill: page token expired for ${team.jira_project_key}, cursor reset`,
          `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runDueDateRebackfill manually to restart ${team.jira_project_key} from the beginning.`
        );
        return;
      }
      notifyFailure_(`runDueDateRebackfill: Jira fetch failed for ${team.jira_project_key}`, err);
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

/**
 * Lightweight re-backfill for the `labels` column (added after most tickets were already synced —
 * see migrateAddLabelsColumn in Setup.gs). Same shape as runDueDateRebackfill: pulls only `created`
 * + `labels` per ticket and patches just the labels cell in the existing RAW row, self-continuing
 * across executions via per-team Script Property cursors. Run once from the editor after
 * migrateAddLabelsColumn. Needed for the "tool-assisted" cycle-time report (ToolAssistedApi.gs) to
 * see tickets labeled before this column existed — going forward, the regular sync fills it in on
 * its own. Safe to re-run (clear the DONE_ props to force a full redo).
 */
const LABELS_REBACKFILL_CURSOR_PREFIX = 'LABELS_REBACKFILL_CURSOR_';
const LABELS_REBACKFILL_DONE_PREFIX = 'LABELS_REBACKFILL_DONE_';

function runLabelsRebackfill() {
  const props = PropertiesService.getScriptProperties();
  const teams = getActiveTeamsConfig_();

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    if (props.getProperty(LABELS_REBACKFILL_DONE_PREFIX + team.team_key)) continue;

    const pageToken = props.getProperty(LABELS_REBACKFILL_CURSOR_PREFIX + team.team_key) || undefined;
    const jql = buildJqlBackfillFull_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, pageToken, 100, ['created', 'labels']);
    } catch (err) {
      deleteLabelsRebackfillTrigger_();
      if (isExpiredPageTokenError_(err)) {
        props.deleteProperty(LABELS_REBACKFILL_CURSOR_PREFIX + team.team_key);
        notifyFailure_(
          `runLabelsRebackfill: page token expired for ${team.jira_project_key}, cursor reset`,
          `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runLabelsRebackfill manually to restart ${team.jira_project_key} from the beginning.`
        );
        return;
      }
      notifyFailure_(`runLabelsRebackfill: Jira fetch failed for ${team.jira_project_key}`, err);
      ScriptApp.newTrigger('runLabelsRebackfill').timeBased().after(5000).create();
      return;
    }

    if (page.nextPageToken && page.nextPageToken === pageToken) {
      notifyFailure_(`runLabelsRebackfill stalled for ${team.jira_project_key}`, 'nextPageToken did not advance — check Jira response.');
      deleteLabelsRebackfillTrigger_();
      return;
    }

    // Group this page's label updates by the ticket's created-year (RAW tabs are sharded by it).
    const updatesByYear = {};
    page.issues.forEach((issue) => {
      const created = issue.fields && issue.fields.created;
      if (!created) return;
      const year = new Date(created).getFullYear();
      (updatesByYear[year] = updatesByYear[year] || {})[issue.key] =
        Array.isArray(issue.fields.labels) ? issue.fields.labels.join(', ') : '';
    });
    Object.keys(updatesByYear).forEach((year) => applyLabelsUpdates_(team.team_key, year, updatesByYear[year]));

    if (page.nextPageToken && page.issues.length > 0) {
      props.setProperty(LABELS_REBACKFILL_CURSOR_PREFIX + team.team_key, page.nextPageToken);
      deleteLabelsRebackfillTrigger_();
      ScriptApp.newTrigger('runLabelsRebackfill').timeBased().after(1000).create();
      return;
    }

    props.setProperty(LABELS_REBACKFILL_DONE_PREFIX + team.team_key, nowIso_());
    props.deleteProperty(LABELS_REBACKFILL_CURSOR_PREFIX + team.team_key);
  }

  deleteLabelsRebackfillTrigger_();
  sendAlertEmail_(
    'Labels re-backfill complete',
    'All active teams have had RAW labels populated from Jira. The tool-assisted cycle-time report now covers tickets synced before the labels column existed.'
  );
}

/** Patches the labels cell for the given issue keys in one RAW_<team>_<year> tab (single batched write). */
function applyLabelsUpdates_(teamKey, year, keyToLabels) {
  const sheet = getOrCreateRawTab_(teamKey, year);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const keyCol = headers.indexOf('issue_key');
  const labelsCol = headers.indexOf('labels');
  if (keyCol === -1 || labelsCol === -1) return;

  const keys = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
  const labelsVals = sheet.getRange(2, labelsCol + 1, lastRow - 1, 1).getValues();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i][0];
    if (k && Object.prototype.hasOwnProperty.call(keyToLabels, k)) {
      labelsVals[i][0] = keyToLabels[k];
      changed = true;
    }
  }
  if (changed) sheet.getRange(2, labelsCol + 1, labelsVals.length, 1).setValues(labelsVals);
}

function deleteLabelsRebackfillTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runLabelsRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
