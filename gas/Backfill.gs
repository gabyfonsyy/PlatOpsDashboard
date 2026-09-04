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
 *
 * Needs a re-run after the 2026-09-02 fix to extractReviewCycleTimeRange_: previously a LATER
 * transition between two terminal statuses (e.g. Archived -> Rejected, discovered via ST-85420)
 * overwrote cycle_time_end with the reclassification date instead of keeping the original
 * completion date, inflating cycle time for any ticket reclassified well after it first went
 * archived/rejected. This rebackfill re-derives cycle_time_end (and cycle_time_start,
 * peer_review_cycles_json) under the corrected first-terminal-wins logic.
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
 * Targeted re-backfill for ST's `resolved_datetime` specifically — a DIFFERENT population than
 * runStPeerReviewRebackfill above. That job's JQL only matches tickets that were EVER in For
 * Peer Review/For Checking/For Product Team/Archived/Rejected, which excludes the exact tickets
 * this one exists to fix: ones that went straight from active work to Done with no formal
 * review step recorded at all (confirmed live 2026-09-03/04 — this is the COMMON case for
 * 2024-2025 ST tickets, not an edge case: e.g. ST-54812, ST-76687, ST-76591, ST-76565, ST-75961,
 * ST-75335 all show a bare To Do -> In Progress -> On Hold -> Done history). Those need
 * extractSeResolvedAtFallback_'s "Done" last-resort fallback (JiraSync.gs), which
 * processAndUpsertIssue_ only reaches once the ticket is actually reprocessed.
 *
 * JQL targets the root cause directly — status = Done AND the native resolved-date custom
 * field (customfield_10188, i.e. resolved_date_field_id) is empty — rather than reusing the
 * peer-review job's "status WAS X" shape, which would silently miss this population again.
 * Confirmed 2026-09-04: 15,856 ST tickets currently match. Deliberately NO created-date floor
 * (her call, 2026-09-04) — the ST project goes back to 2019, well before the "late
 * 2024/early 2025" she originally estimated, and any straight-to-Done ticket left unbackfilled
 * stays permanently miscounted as open backlog regardless of how old it is.
 *
 * Mirrors runStPeerReviewRebackfill's shape exactly (own Script Properties cursor, self-
 * rescheduling trigger, idempotent upsert by issue_key). After it finishes, run
 * backfillResolvedOnDate + backfillResolvedInMonth so METRICS_DAILY/METRICS_BY_ASSIGNEE_MONTHLY
 * recompute from the corrected values.
 */
const ST_RESOLVED_DATETIME_CURSOR_KEY = 'ST_RESOLVED_DATETIME_REBACKFILL_CURSOR';

function runStResolvedDatetimeRebackfill() {
  const team = getActiveTeamsConfig_().find((t) => t.team_key === 'ST');
  if (!team) throw new Error('ST team not found in active config — check TEAMS_CONFIG.');

  const props = PropertiesService.getScriptProperties();
  const pageToken = props.getProperty(ST_RESOLVED_DATETIME_CURSOR_KEY) || undefined;

  const jql = `project = ${team.jira_project_key} AND status = "Done" AND cf[${team.resolved_date_field_id.replace('customfield_', '')}] is EMPTY ORDER BY created ASC`;
  const fields = buildJiraFieldList_(team);

  let page;
  try {
    page = jiraSearchIssues_(jql, pageToken, 100, fields);
  } catch (err) {
    deleteStResolvedDatetimeTrigger_();
    if (isExpiredPageTokenError_(err)) {
      props.deleteProperty(ST_RESOLVED_DATETIME_CURSOR_KEY);
      notifyFailure_(
        'runStResolvedDatetimeRebackfill: page token expired, cursor reset',
        `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runStResolvedDatetimeRebackfill manually to restart from the beginning (upserts are idempotent by issue_key).`
      );
      return;
    }
    notifyFailure_('runStResolvedDatetimeRebackfill: Jira fetch failed', err);
    ScriptApp.newTrigger('runStResolvedDatetimeRebackfill').timeBased().after(5000).create();
    return;
  }

  if (page.nextPageToken && page.nextPageToken === pageToken) {
    notifyFailure_('runStResolvedDatetimeRebackfill stalled', 'nextPageToken did not advance — check Jira response.');
    deleteStResolvedDatetimeTrigger_();
    return;
  }

  for (const issue of page.issues) {
    try {
      processAndUpsertIssue_(team, issue);
    } catch (issueErr) {
      Logger.log(`runStResolvedDatetimeRebackfill failed for ${issue.key}: ${issueErr}`);
      logSyncError_(team.team_key, issue.key, 'resolved_datetime_rebackfill', '', String(issueErr));
    }
  }
  flushDirtyDates_(team.team_key);

  if (page.nextPageToken && page.issues.length > 0) {
    props.setProperty(ST_RESOLVED_DATETIME_CURSOR_KEY, page.nextPageToken);
    deleteStResolvedDatetimeTrigger_();
    ScriptApp.newTrigger('runStResolvedDatetimeRebackfill').timeBased().after(1000).create();
    return;
  }

  props.deleteProperty(ST_RESOLVED_DATETIME_CURSOR_KEY);
  deleteStResolvedDatetimeTrigger_();
  sendAlertEmail_(
    'ST resolved_datetime re-backfill complete',
    'All ST tickets that were status=Done with an empty native resolved-date field have been re-processed — resolved_datetime now falls back to when they entered For Checking/For Product Team, or Archived/Rejected, or (last resort) Done itself. Run backfillResolvedOnDate and backfillResolvedInMonth next so METRICS_DAILY/METRICS_BY_ASSIGNEE_MONTHLY recompute from the corrected values.'
  );
}

function deleteStResolvedDatetimeTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runStResolvedDatetimeRebackfill')
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

/**
 * Lightweight re-backfill for the `priority` column (added after most tickets were already
 * synced — see migrateAddPriorityColumn in Setup.gs). Same shape as runLabelsRebackfill/
 * runDueDateRebackfill: pulls only `created` + `priority` per ticket and patches just the
 * priority cell in the existing RAW row, self-continuing across executions via per-team Script
 * Property cursors. Run once from the editor after migrateAddPriorityColumn. Needed for the P1
 * SLA Compliance report (lib/p1-sla.ts) to see tickets synced before this column existed — going
 * forward, the regular sync fills it in on its own. Safe to re-run (clear the DONE_ props to
 * force a full redo).
 */
const PRIORITY_REBACKFILL_CURSOR_PREFIX = 'PRIORITY_REBACKFILL_CURSOR_';
const PRIORITY_REBACKFILL_DONE_PREFIX = 'PRIORITY_REBACKFILL_DONE_';

function runPriorityRebackfill() {
  const props = PropertiesService.getScriptProperties();
  const teams = getActiveTeamsConfig_();

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    if (props.getProperty(PRIORITY_REBACKFILL_DONE_PREFIX + team.team_key)) continue;

    const pageToken = props.getProperty(PRIORITY_REBACKFILL_CURSOR_PREFIX + team.team_key) || undefined;
    const jql = buildJqlBackfillFull_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, pageToken, 100, ['created', 'priority']);
    } catch (err) {
      deletePriorityRebackfillTrigger_();
      if (isExpiredPageTokenError_(err)) {
        props.deleteProperty(PRIORITY_REBACKFILL_CURSOR_PREFIX + team.team_key);
        notifyFailure_(
          `runPriorityRebackfill: page token expired for ${team.jira_project_key}, cursor reset`,
          `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runPriorityRebackfill manually to restart ${team.jira_project_key} from the beginning.`
        );
        return;
      }
      notifyFailure_(`runPriorityRebackfill: Jira fetch failed for ${team.jira_project_key}`, err);
      ScriptApp.newTrigger('runPriorityRebackfill').timeBased().after(5000).create();
      return;
    }

    if (page.nextPageToken && page.nextPageToken === pageToken) {
      notifyFailure_(`runPriorityRebackfill stalled for ${team.jira_project_key}`, 'nextPageToken did not advance — check Jira response.');
      deletePriorityRebackfillTrigger_();
      return;
    }

    // Group this page's priority updates by the ticket's created-year (RAW tabs are sharded by it).
    const updatesByYear = {};
    page.issues.forEach((issue) => {
      const created = issue.fields && issue.fields.created;
      if (!created) return;
      const year = new Date(created).getFullYear();
      (updatesByYear[year] = updatesByYear[year] || {})[issue.key] =
        extractJiraFieldValue_(issue.fields.priority);
    });
    Object.keys(updatesByYear).forEach((year) => applyPriorityUpdates_(team.team_key, year, updatesByYear[year]));

    if (page.nextPageToken && page.issues.length > 0) {
      props.setProperty(PRIORITY_REBACKFILL_CURSOR_PREFIX + team.team_key, page.nextPageToken);
      deletePriorityRebackfillTrigger_();
      ScriptApp.newTrigger('runPriorityRebackfill').timeBased().after(1000).create();
      return;
    }

    props.setProperty(PRIORITY_REBACKFILL_DONE_PREFIX + team.team_key, nowIso_());
    props.deleteProperty(PRIORITY_REBACKFILL_CURSOR_PREFIX + team.team_key);
  }

  deletePriorityRebackfillTrigger_();
  sendAlertEmail_(
    'Priority re-backfill complete',
    'All active teams have had RAW priority populated from Jira, in the Sheets (RAW_<team>_<year> tabs). ' +
    'Now run runSupabaseMigration() (SupabaseMigration.gs) to push it into Supabase — see applyPriorityUpdates_ ' +
    'for why this step deliberately does not dual-write Supabase itself.'
  );
}

/**
 * Patches the priority cell for the given issue keys in one RAW_<team>_<year> tab (single batched
 * write). Sheets ONLY — deliberately does not also dual-write Supabase, unlike the regular
 * incremental sync path (upsertRawTicketRow_ -> dualWriteTicketToSupabase_). Two things were tried
 * and both failed, worth recording so a future change doesn't repeat them:
 *
 *   1. A partial {issue_key, priority} upsert. Confirmed by direct testing 2026-09-02: Postgres's
 *      `INSERT ... ON CONFLICT DO UPDATE` validates NOT NULL constraints (and applies column
 *      defaults) on the CANDIDATE insert row REGARDLESS of whether a conflict occurs and the
 *      UPDATE branch is taken instead — so a partial upsert against `tickets` (many NOT NULL
 *      columns with no default) fails with a NOT NULL violation even for a row confirmed to
 *      already exist. A same-row-existence check doesn't make this safe; it's not possible to fix
 *      by checking existence first.
 *   2. A full row via sheetToObjects_ (every column) per ticket, to make the upsert always valid.
 *      Correct in principle, but sheetToObjects_ reads the WHOLE year tab — repeating that read on
 *      every ~100-issue JQL page (there can be 400+ pages for one team) made each execution slow
 *      enough that Jira's nextPageToken expired before the next chained trigger could fire,
 *      stalling the backfill entirely (confirmed twice, same failure point both times).
 *
 * The fix is architectural, not a cleverer patch: migrateTicketsYearToSupabase_ (SupabaseMigration.gs)
 * already does exactly what full-row correctness requires — one sheetToObjects_ read per (team,
 * year), not per page — because it runs ONCE per tab as its own migration step, not once per JQL
 * page. So this function stays Sheets-only and fast (matching applyDueDateUpdates_/
 * applyLabelsUpdates_), and runPriorityRebackfill's completion email says to run
 * runSupabaseMigration() afterward to push the now-complete Sheets data into Supabase in one pass
 * per tab — safe to re-run, every upsert already targets issue_key via on_conflict.
 */
function applyPriorityUpdates_(teamKey, year, keyToPriority) {
  const sheet = getOrCreateRawTab_(teamKey, year);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const keyCol = headers.indexOf('issue_key');
  const priorityCol = headers.indexOf('priority');
  if (keyCol === -1 || priorityCol === -1) return;

  const keys = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
  const priorities = sheet.getRange(2, priorityCol + 1, lastRow - 1, 1).getValues();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i][0];
    if (k && Object.prototype.hasOwnProperty.call(keyToPriority, k)) {
      priorities[i][0] = keyToPriority[k];
      changed = true;
    }
  }
  if (changed) sheet.getRange(2, priorityCol + 1, priorities.length, 1).setValues(priorities);
}

/**
 * Clears the DONE_/CURSOR_ properties for every active team so the next runPriorityRebackfill call
 * does a full redo instead of skipping teams already marked complete — needed after the
 * applyPriorityUpdates_ fix above, since any team that finished (or partially finished) under the
 * old partial-upsert logic may have silently failed the Supabase side for some tickets. Mirrors
 * resetDeDevResolvedRebackfill exactly. Run this once, then run runPriorityRebackfill.
 */
function resetPriorityRebackfill() {
  const props = PropertiesService.getScriptProperties();
  getActiveTeamsConfig_().forEach((team) => {
    props.deleteProperty(PRIORITY_REBACKFILL_DONE_PREFIX + team.team_key);
    props.deleteProperty(PRIORITY_REBACKFILL_CURSOR_PREFIX + team.team_key);
  });
  deletePriorityRebackfillTrigger_();
  Logger.log('resetPriorityRebackfill: cleared. Run runPriorityRebackfill next.');
}

function deletePriorityRebackfillTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runPriorityRebackfill')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Targeted fixup for `tickets.priority` still being NULL in Supabase for specific tickets that
 * DO have a real priority in Jira right now (reported by Gaby 2026-09-04: ST-84399, ST-84419,
 * ST-84480, and 772 others across ST/DE/DEV). Confirmed root cause: `extractJiraFieldValue_`
 * returns '' when `fields.priority` is absent/null AT THE MOMENT A TICKET WAS SYNCED — for most
 * of these that was before priority tracking existed at all (a January 2024 batch of ~200 ST
 * tickets, matching runPriorityRebackfill's original "column added after most tickets were
 * already synced" gap), but a handful (the 3 she found, all July/Aug 2026) show the field was
 * genuinely empty in Jira at THEIR sync time too and simply hasn't been reprocessed since —
 * `toStringOrNull_('')` (SupabaseClient.gs) then stores that empty string as SQL NULL.
 *
 * Deliberately does NOT go through runPriorityRebackfill's Sheets-then-runSupabaseMigration
 * two-step (that path exists because bulk full-row Sheets reads are the only way to keep a
 * partial Supabase upsert NOT-NULL-safe across an entire team/year — see applyPriorityUpdates_'s
 * doc comment). This job instead re-fetches and reprocesses each affected ticket INDIVIDUALLY
 * through processAndUpsertIssue_, which always builds a complete row before upserting — the
 * NOT-NULL problem that motivated the Sheets-only design doesn't apply here, so this can dual-
 * write Supabase directly in one pass, no separate migration step needed.
 *
 * Reads the affected issue_key list FROM SUPABASE ITSELF (priority IS NULL), so it self-scopes
 * to whatever's actually still broken — no hardcoded ticket list to keep in sync by hand.
 *
 * ⚠ Guards against a real bug found and fixed 2026-09-04: Jira's `key in (...)` JQL resolves a
 * MOVED issue's old key to its CURRENT key/project — e.g. searching "ST-84399" can come back as
 * "L3-2893" if that ticket was later moved to project L3. processAndUpsertIssue_ upserts by
 * `issue.key`, so blindly processing the search result wrote a WRONG row (a non-ST ticket
 * mislabeled team_key/project_key='ST') while leaving the real stale ST-84399 row untouched —
 * confirmed live: 8 such rows (L3-2893, EAB-5739/5740/5741/5752/5769/5842/5995) got created this
 * way and had to be deleted. Now skips (and logs) any returned issue whose key doesn't match
 * what was actually queried, rather than trusting the search result's own key.
 */
function runPriorityNullFixup() {
  const teams = getActiveTeamsConfig_();
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const res = supabaseRequest_('GET', `tickets?team_key=eq.${team.team_key}&priority=is.null&select=issue_key`, undefined, {});
    const issueKeys = (res.body || []).map((r) => r.issue_key);
    if (!issueKeys.length) continue;

    Logger.log(`runPriorityNullFixup: ${team.team_key} has ${issueKeys.length} tickets with null priority`);
    const CHUNK = 50;
    for (let j = 0; j < issueKeys.length; j += CHUNK) {
      const batch = issueKeys.slice(j, j + CHUNK);
      const batchSet = {};
      batch.forEach((k) => (batchSet[k] = true));
      const jql = `key in (${batch.map((k) => `"${k}"`).join(',')})`;
      let page;
      try {
        page = jiraSearchIssues_(jql, undefined, batch.length, buildJiraFieldList_(team));
      } catch (err) {
        notifyFailure_(`runPriorityNullFixup: Jira fetch failed for ${team.team_key} batch starting at ${j}`, err);
        continue;
      }
      page.issues.forEach((issue) => {
        if (!batchSet[issue.key]) {
          // This ticket was moved to another project since we last synced it — Jira resolved our
          // old key to its new home. Do NOT upsert it (would mislabel a non-ST/DE/DEV ticket
          // under this team); the original stale row is a separate, deliberate follow-up.
          Logger.log(`runPriorityNullFixup: key mismatch — a queried key in this batch now resolves to ${issue.key}, skipping (likely moved to another project)`);
          logSyncError_(team.team_key, issue.key, 'priority_null_fixup_key_mismatch', '', `Search returned ${issue.key}, which was not in the queried batch — ticket likely moved projects`);
          return;
        }
        try {
          processAndUpsertIssue_(team, issue);
        } catch (issueErr) {
          Logger.log(`runPriorityNullFixup failed for ${issue.key}: ${issueErr}`);
          logSyncError_(team.team_key, issue.key, 'priority_null_fixup', '', String(issueErr));
        }
      });
      flushDirtyDates_(team.team_key);
    }
  }

  sendAlertEmail_(
    'Priority null fixup complete',
    'Every ticket that had priority=NULL in Supabase (across ST/DE/DEV) has been re-fetched from Jira and reprocessed. Any still null after this genuinely has no priority set on the Jira issue itself, or was skipped because it has since moved to a different Jira project (see ERROR_LOG for priority_null_fixup_key_mismatch entries).'
  );
}

/**
 * One-off catch-up re-sync for tickets the regular incremental sync (syncTeam_ in JiraSync.gs)
 * silently skipped. Discovered 2026-09-03 via ST-84399/84419/84480: each had real Jira updates
 * (priority set, status moved past "To do") weeks old that never reached Sheets/Supabase, even
 * though syncTeam_'s 2h trigger was actively processing brand-new tickets in the same window —
 * evidence its Jira pagination silently stalled/drifted at some point and orphaned a chunk of
 * tickets instead of erroring out. syncTeam_ had no stall guard until the 2026-09-03 fix (see
 * the `page.nextPageToken === pageToken` block there, mirroring runInitialBackfill's).
 *
 * Re-walks the last STUCK_CATCHUP_WINDOW_DAYS of `updated` per team and reprocesses every issue
 * through the SAME processAndUpsertIssue_ path the regular sync uses — a full row upsert, not a
 * narrow field patch, so status/priority/everything else is corrected together in one pass. Own
 * Script Properties cursor per team, isolated from SYNC_CHECKPOINT, so it can't interfere with
 * or be confused with the regular incremental sync's cursor. Safe to re-run (upserts are
 * idempotent by issue_key).
 *
 * Run once from the editor (select runStuckTicketCatchup, click Run). If more stuck tickets
 * surface outside the window later, run resetStuckTicketCatchup then bump
 * STUCK_CATCHUP_WINDOW_DAYS and re-run.
 */
const STUCK_CATCHUP_WINDOW_DAYS = 120;
const STUCK_CATCHUP_CURSOR_PREFIX = 'STUCK_CATCHUP_CURSOR_';
const STUCK_CATCHUP_DONE_PREFIX = 'STUCK_CATCHUP_DONE_';

function runStuckTicketCatchup() {
  const props = PropertiesService.getScriptProperties();
  const teams = getActiveTeamsConfig_();

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    if (props.getProperty(STUCK_CATCHUP_DONE_PREFIX + team.team_key)) continue;

    const pageToken = props.getProperty(STUCK_CATCHUP_CURSOR_PREFIX + team.team_key) || undefined;
    const jql = `project = ${team.jira_project_key} AND updated >= "-${STUCK_CATCHUP_WINDOW_DAYS}d" ORDER BY updated ASC`;
    const fields = buildJiraFieldList_(team);

    let page;
    try {
      page = jiraSearchIssues_(jql, pageToken, 100, fields);
    } catch (err) {
      deleteStuckTicketCatchupTrigger_();
      if (isExpiredPageTokenError_(err)) {
        props.deleteProperty(STUCK_CATCHUP_CURSOR_PREFIX + team.team_key);
        notifyFailure_(
          `runStuckTicketCatchup: page token expired for ${team.jira_project_key}, cursor reset`,
          `${err}\n\nThe stored nextPageToken was rejected by Jira as invalid/expired, so retrying it would fail forever. The cursor has been cleared — re-run runStuckTicketCatchup manually to restart ${team.jira_project_key} from the beginning (upserts are idempotent by issue_key).`
        );
        return;
      }
      notifyFailure_(`runStuckTicketCatchup: Jira fetch failed for ${team.jira_project_key}`, err);
      ScriptApp.newTrigger('runStuckTicketCatchup').timeBased().after(5000).create();
      return;
    }

    if (page.nextPageToken && page.nextPageToken === pageToken) {
      notifyFailure_(`runStuckTicketCatchup stalled for ${team.jira_project_key}`, 'nextPageToken did not advance — check Jira response.');
      deleteStuckTicketCatchupTrigger_();
      return;
    }

    page.issues.forEach((issue) => {
      try {
        processAndUpsertIssue_(team, issue);
      } catch (issueErr) {
        Logger.log(`runStuckTicketCatchup failed for ${issue.key}: ${issueErr}`);
        logSyncError_(team.team_key, issue.key, 'stuck_ticket_catchup', '', String(issueErr));
      }
    });
    flushDirtyDates_(team.team_key);

    if (page.nextPageToken && page.issues.length > 0) {
      props.setProperty(STUCK_CATCHUP_CURSOR_PREFIX + team.team_key, page.nextPageToken);
      deleteStuckTicketCatchupTrigger_();
      ScriptApp.newTrigger('runStuckTicketCatchup').timeBased().after(1000).create();
      return;
    }

    props.setProperty(STUCK_CATCHUP_DONE_PREFIX + team.team_key, nowIso_());
    props.deleteProperty(STUCK_CATCHUP_CURSOR_PREFIX + team.team_key);
  }

  deleteStuckTicketCatchupTrigger_();
  sendAlertEmail_(
    'Stuck-ticket catch-up complete',
    `All active teams' tickets updated in the last ${STUCK_CATCHUP_WINDOW_DAYS} days have been re-synced (Sheets + Supabase), correcting any tickets the regular sync had silently skipped before the 2026-09-03 stall-guard fix in JiraSync.gs. aggregateAllTeams will pick up the affected dates (marked dirty automatically) on its next run. Re-run resetStuckTicketCatchup + runStuckTicketCatchup with a larger STUCK_CATCHUP_WINDOW_DAYS if more stuck tickets are found outside this window.`
  );
}

function resetStuckTicketCatchup() {
  const props = PropertiesService.getScriptProperties();
  getActiveTeamsConfig_().forEach((team) => {
    props.deleteProperty(STUCK_CATCHUP_DONE_PREFIX + team.team_key);
    props.deleteProperty(STUCK_CATCHUP_CURSOR_PREFIX + team.team_key);
  });
  deleteStuckTicketCatchupTrigger_();
  Logger.log('resetStuckTicketCatchup: cleared. Run runStuckTicketCatchup next.');
}

function deleteStuckTicketCatchupTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runStuckTicketCatchup')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
