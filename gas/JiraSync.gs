/**
 * Incremental Jira sync (runs every 2h once a team's backfill is complete).
 * See Backfill.gs for the one-time historical load that populates SYNC_CHECKPOINT
 * with `last_full_backfill_completed_at` in the first place.
 */

const RAW_TICKET_HEADERS = [
  'issue_key', 'project_key', 'issue_type', 'status', 'created', 'updated',
  'resolved_datetime', 'resolved_raw_text', 'first_out_of_backlog_todo',
  'fcr_value', 'escalation_value', 'assigned_se', 'assigned_cod', 'due_date',
  'product', 'holding_reasons_json', 'rejection_category', 'cancellation_reason',
  'total_on_hold_minutes', 'total_in_progress_minutes', 'assignee_display_name',
  'reporter_display_name', 'last_synced_at', 'peer_review_cycles_json',
  'cycle_time_start', 'cycle_time_end', 'labels', 'priority',
];

function syncAllTeams() {
  getActiveTeamsConfig_().forEach((team) => {
    try {
      syncTeam_(team);
    } catch (err) {
      writeSyncStatus_(team.jira_project_key, {
        last_sync_status: 'FAILED',
        last_sync_run_at: nowIso_(),
        last_sync_error_message: String(err),
      });
      notifyFailure_(`syncAllTeams failed for ${team.jira_project_key}`, err);
    }
  });
}

function syncTeam_(team) {
  const checkpoint = readSyncCheckpoint_(team.jira_project_key);
  if (!checkpoint.last_full_backfill_completed_at) {
    Logger.log(`Skipping incremental sync for ${team.jira_project_key}: backfill not complete yet.`);
    return;
  }

  const jql = buildJqlIncremental_(team, checkpoint.last_synced_updated_ts);
  const fields = buildJiraFieldList_(team);

  let pageToken;
  let maxUpdated = checkpoint.last_synced_updated_ts || '';
  let count = 0;

  while (true) {
    const page = jiraSearchIssues_(jql, pageToken, 100, fields);
    page.issues.forEach((issue) => {
      processAndUpsertIssue_(team, issue);
      count++;
      if (!maxUpdated || issue.fields.updated > maxUpdated) maxUpdated = issue.fields.updated;
    });

    if (!page.nextPageToken || page.issues.length === 0 || page.nextPageToken === pageToken) break;
    pageToken = page.nextPageToken;
  }

  flushDirtyDates_(team.team_key);
  writeSyncStatus_(team.jira_project_key, {
    last_synced_updated_ts: maxUpdated,
    last_sync_status: 'SUCCESS',
    last_sync_run_at: nowIso_(),
    last_sync_error_message: '',
    tickets_synced_last_run: count,
  });
}

/** Shared by both incremental sync and backfill (Backfill.gs). */
function processAndUpsertIssue_(team, issue) {
  const fields = issue.fields;
  const resolved = parseResolvedDateField_(team, fields, issue.key);
  const row = mapIssueToRawRow_(team, issue, resolved);

  if (issueNeedsChangelog_(team, fields, resolved.value)) {
    const changelog = jiraGetChangelog_(issue.key);
    row.first_out_of_backlog_todo = extractCycleTimeStart_(changelog, team.backlog_status_names_csv);
    // DE/DEV: resolved_datetime comes ONLY from the changelog (moved to Ready for Checking or
    // Cancelled) — never from resolved_date_field_id's raw text value, which isn't reliably
    // updated for every outcome (confirmed: some tickets carry a stale/earlier value, which showed
    // up as impossible negative lead/cycle times). issueNeedsChangelog_ always returns true for
    // these teams (has_fcr_escalation is false), so this unconditionally replaces whatever
    // parseResolvedDateField_ set — no changelog match means genuinely not resolved yet (or the
    // transition isn't recorded), not "fall back to a maybe-wrong date". Blank is safer than wrong.
    if (team.resolved_date_field_type === 'text') {
      const changelogResolvedAt = extractDeDevResolvedAt_(changelog);
      row.resolved_datetime = changelogResolvedAt ? new Date(changelogResolvedAt).toISOString() : '';
    }
    if (team.has_holding_reason) {
      const cycles = extractHoldingCyclesWithReasons_(changelog);
      row.holding_reasons_json = JSON.stringify(cycles.map((c) => c.reason).filter(Boolean));
      row.total_on_hold_minutes = round2_(cycles.reduce((sum, c) => {
        return c.exitedAt ? sum + (new Date(c.exitedAt) - new Date(c.enteredAt)) / 60000 : sum;
      }, 0));
    }
    if (team.has_in_progress_tracking) {
      const inProgressCycles = extractInProgressCycles_(changelog);
      row.total_in_progress_minutes = round2_(inProgressCycles.reduce((sum, c) => {
        return c.exitedAt ? sum + (new Date(c.exitedAt) - new Date(c.enteredAt)) / 60000 : sum;
      }, 0));
    }
    if (team.has_peer_review_tracking) {
      row.peer_review_cycles_json = JSON.stringify(extractPeerReviewCyclesWithReviewer_(changelog));
      const endStatuses = cycleTimeEndStatusesForIssueType_(row.issue_type);
      const reviewCycleTime = extractReviewCycleTimeRange_(changelog, row.first_out_of_backlog_todo, endStatuses);
      row.cycle_time_start = reviewCycleTime.startAt || '';
      row.cycle_time_end = reviewCycleTime.endAt || '';
    }
  }

  upsertRawTicketRow_(team.team_key, row);
  markDirtyDate_(team.team_key, toIsoDate_(new Date(row.created)));
  // Also mark the resolved date dirty so the resolved-by-resolved-date trend
  // (tickets_resolved_on_date in METRICS_DAILY) recomputes for that day — the day a
  // ticket resolves is usually different from the day it was created.
  if (row.resolved_datetime) {
    markDirtyDate_(team.team_key, toIsoDate_(new Date(row.resolved_datetime)));
  }
}

function buildJqlIncremental_(team, sinceTs) {
  return `project = ${team.jira_project_key} AND updated >= "${formatJqlDateTime_(sinceTs)}" ORDER BY updated ASC`;
}

function formatJqlDateTime_(isoString) {
  const date = isoString ? new Date(isoString) : new Date(0);
  return Utilities.formatDate(date, TIMEZONE, 'yyyy/MM/dd HH:mm');
}

function mapIssueToRawRow_(team, issue, resolved) {
  const fields = issue.fields;
  return {
    issue_key: issue.key,
    project_key: team.jira_project_key,
    issue_type: fields.issuetype ? fields.issuetype.name : '',
    status: fields.status ? fields.status.name : '',
    created: fields.created,
    updated: fields.updated,
    resolved_datetime: resolved.value ? resolved.value.toISOString() : '',
    resolved_raw_text: resolved.rawText || '',
    first_out_of_backlog_todo: '',
    fcr_value: extractJiraFieldValue_(fields.customfield_10143),
    escalation_value: extractJiraFieldValue_(fields.customfield_10146),
    assigned_se: team.assignee_field_id === 'customfield_10189' ? extractJiraFieldValue_(fields.customfield_10189) : '',
    assigned_cod: team.assignee_field_id === 'customfield_10097' ? extractJiraFieldValue_(fields.customfield_10097) : '',
    due_date: extractJiraFieldValue_(fields.duedate),
    product: extractJiraFieldValue_(fields.customfield_10197),
    holding_reasons_json: '[]',
    rejection_category: extractJiraFieldValue_(fields.customfield_11496),
    cancellation_reason: extractJiraFieldValue_(fields.customfield_11285),
    total_on_hold_minutes: 0,
    total_in_progress_minutes: 0,
    assignee_display_name: fields.assignee ? fields.assignee.displayName : '',
    reporter_display_name: fields.reporter ? fields.reporter.displayName : '',
    labels: Array.isArray(fields.labels) ? fields.labels.join(', ') : '',
    last_synced_at: nowIso_(),
    peer_review_cycles_json: '[]',
    cycle_time_start: '',
    cycle_time_end: '',
    // Jira's native Priority field, e.g. 'P1 (Very Urgent)' — backs the P1 SLA Compliance
    // scorecard (lib/p1-sla.ts). extractJiraFieldValue_ handles its {id,name,iconUrl} shape via
    // the 'name' branch, same as issuetype/status.
    priority: extractJiraFieldValue_(fields.priority),
  };
}

/**
 * Jira custom fields come back in several shapes depending on field type (select,
 * multi-select, user picker, plain text). Handles all of them generically rather than
 * guessing one shape per field — verify against real payloads during Milestone 2 testing.
 */
function extractJiraFieldValue_(field) {
  if (field === null || field === undefined) return '';
  if (typeof field === 'string' || typeof field === 'number') return field;
  if (Array.isArray(field)) return field.map(extractJiraFieldValue_).filter(String).join(', ');
  if (typeof field === 'object') {
    if ('displayName' in field) return field.displayName;
    if ('value' in field) return field.value;
    if ('name' in field) return field.name;
  }
  return String(field);
}

/**
 * native: Jira returns a full ISO datetime with offset, e.g. "2026-06-05T14:07:58.000+0800" — `new Date()` parses it directly.
 * text: customfield_11153 is a plain string like "2026-06-05 14:07:58" — `new Date(...)` on that exact format is
 * unreliable across Apps Script locales, so it's parsed explicitly and constructed in the script's Asia/Manila timezone.
 */
function parseResolvedDateField_(team, fields, issueKey) {
  const raw = fields[team.resolved_date_field_id];
  if (!raw) return { value: null, rawText: '' };

  if (team.resolved_date_field_type === 'native') {
    return { value: new Date(raw), rawText: '' };
  }

  // customfield_11153 is *usually* the plain "YYYY-MM-DD HH:mm:ss" format below, but some
  // tickets carry a full ISO-8601 datetime with an explicit offset (e.g.
  // "2026-05-11T15:29:03.000+0000") written by a different automation. ISO strings carry
  // their own timezone, so new Date() parses them unambiguously — handle them before the
  // manual space-format parse rather than logging them as unparseable.
  const str = String(raw);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
    const isoDate = new Date(str);
    if (!isNaN(isoDate.getTime())) return { value: isoDate, rawText: '' };
  }

  const match = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    logSyncError_(team.team_key, issueKey, 'resolved_datetime', raw, 'Unparseable text datetime');
    return { value: null, rawText: String(raw) };
  }
  const y = Number(match[1]), mo = Number(match[2]), d = Number(match[3]);
  const h = Number(match[4]), mi = Number(match[5]), s = Number(match[6]);
  return { value: new Date(y, mo - 1, d, h, mi, s), rawText: String(raw) };
}

/**
 * DE/DEV always need the changelog to find cycle-time-start (proxied here by has_fcr_escalation=false,
 * since only ST-shaped teams have that field — see TEAMS_CONFIG). ST only needs it once a ticket has
 * left Backlog/To Do AND either resolved or currently On Hold, to avoid the expensive changelog call
 * for tickets still untouched in the backlog.
 */
function issueNeedsChangelog_(team, fields, resolvedValue) {
  if (!team.has_fcr_escalation) return true;

  const status = (fields.status && fields.status.name || '').toLowerCase();
  const backlogNames = team.backlog_status_names_csv.split(',').map((s) => s.trim().toLowerCase());
  if (backlogNames.indexOf(status) !== -1) return false;

  if (team.has_holding_reason) return true;
  if (team.has_in_progress_tracking) return true;
  return !!resolvedValue || status === 'on hold';
}

/** First changelog entry where status moved FROM a backlog-ish status TO anything else. */
function extractCycleTimeStart_(changelog, backlogStatusNamesCsv) {
  const backlogNames = backlogStatusNamesCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (let i = 0; i < changelog.length; i++) {
    const statusItem = (changelog[i].items || []).find((item) => item.field === 'status');
    if (!statusItem) continue;
    const from = (statusItem.fromString || '').toLowerCase();
    const to = (statusItem.toString || '').toLowerCase();
    if (backlogNames.indexOf(from) !== -1 && backlogNames.indexOf(to) === -1) {
      return changelog[i].created;
    }
  }
  return '';
}

/**
 * DE/DEV "resolved" definition: the most recent changelog entry where status moved to Ready for
 * Checking or Cancelled — both count as done, mirroring how ST's cycleTimeEndStatusForIssueType_
 * treats For Peer Review/For Checking as equally valid completion points. Overwrites every match
 * while walking chronologically, so a ticket that bounces back through one of these statuses again
 * recomputes from the LATEST entry, same as extractReviewCycleTimeRange_.
 */
const DE_DEV_RESOLVED_STATUSES = ['ready for checking', 'cancelled'];

function extractDeDevResolvedAt_(changelog) {
  let resolvedAt = null;
  for (let i = 0; i < changelog.length; i++) {
    const statusItem = (changelog[i].items || []).find((item) => item.field === 'status');
    if (!statusItem) continue;
    const toStatus = (statusItem.toString || '').toLowerCase();
    if (DE_DEV_RESOLVED_STATUSES.indexOf(toStatus) !== -1) {
      resolvedAt = changelog[i].created;
    }
  }
  return resolvedAt;
}

/**
 * Walks the changelog chronologically and returns every On Hold cycle as
 * { enteredAt, exitedAt, reason }, where `reason` is the value of customfield_11463
 * at the moment the ticket entered On Hold. Jira batches field changes that happen
 * simultaneously into one changelog entry, so the reason and status transition appear
 * together when set via automation — both are processed in the same pass.
 * Supports tickets that cycle through On Hold multiple times (e.g. PlatOps dependency
 * → client feedback → L3 dependency).
 */
function extractHoldingCyclesWithReasons_(changelog) {
  let currentReason = null;
  const cycles = [];
  let cycleStart = null;

  for (let i = 0; i < changelog.length; i++) {
    const items = changelog[i].items || [];

    items.forEach((item) => {
      if (item.field === 'customfield_11463' || item.fieldId === 'customfield_11463') {
        currentReason = item.toString || null;
      }
    });

    const statusItem = items.find((item) => item.field === 'status');
    if (!statusItem) continue;

    const toStatus = (statusItem.toString || '').toLowerCase();
    const fromStatus = (statusItem.fromString || '').toLowerCase();

    if (toStatus === 'on hold') {
      cycleStart = changelog[i].created;
    } else if (fromStatus === 'on hold' && cycleStart) {
      cycles.push({ enteredAt: cycleStart, exitedAt: changelog[i].created, reason: currentReason || '' });
      cycleStart = null;
    }
  }

  if (cycleStart) {
    cycles.push({ enteredAt: cycleStart, exitedAt: null, reason: currentReason || '' });
  }

  return cycles;
}

/**
 * Walks the changelog chronologically and returns every "For Peer Review" cycle as
 * { enteredAt, exitedAt, exitedToStatus, reviewer, reviewerAtEntry }.
 *
 * TWO assignee snapshots, because "who was assigned" answers two different questions and the
 * answers genuinely differ:
 *
 *   reviewerAtEntry — the assignee at the moment the ticket moved INTO For Peer Review. This is
 *                     the person asked to review it: the doer picks a reviewer and hands off in
 *                     one action, so the assignee set on that transition IS the reviewer.
 *   reviewer        — the assignee as of the moment the cycle CLOSES. NO LONGER READ by any
 *                     report: PeerReviewApi.gs and src/lib/peer-review.ts were repointed at
 *                     reviewerAtEntry (2026-08-24) so Review Wait Time and the Incident Logs
 *                     validator share one basis. It is still emitted because it is the honest
 *                     answer to "who held this when review ended", and dropping it from stored
 *                     rows would make already-synced JSON unreadable for that question.
 *
 * Worked example (ST-84873): Jasper Razo was assigned when it went to For Peer Review, then
 * Angelo Nico Ravilas was assigned when it moved on to For Checking. reviewerAtEntry is Jasper
 * (the validator); reviewer is Angelo Nico (who picked it up at the NEXT stage, and was never the
 * peer reviewer at all). Attributing the review to the exit assignee is what made the Incident
 * Logs validator wrong for most tickets.
 *
 * `currentAssignee` is a running value updated on every assignee changelog item (mirrors
 * currentReason in extractHoldingCyclesWithReasons_), not reset per cycle, so a cycle with no
 * in-window reassignment still reports whoever was already assigned. The assignee item is applied
 * BEFORE the status item is checked within the same changelog entry (loop order matters): Jira
 * batches simultaneous field changes into one changelog entry, so a reassignment that happens in
 * the same entry as a For Peer Review entry/exit must already be reflected in currentAssignee by
 * the time that transition is handled, not one entry later. That ordering is exactly what makes
 * reviewerAtEntry pick up a hand-off where the reassignment and the transition are one action.
 *
 * Every exit is recorded (not just to On Hold/For Checking) via exitedToStatus — callers filter to
 * the exits they care about rather than losing data for other exit paths.
 */
function extractPeerReviewCyclesWithReviewer_(changelog) {
  let currentAssignee = null;
  const cycles = [];
  let cycleStart = null;
  let cycleStartAssignee = null;

  for (let i = 0; i < changelog.length; i++) {
    const items = changelog[i].items || [];

    items.forEach((item) => {
      if (item.field === 'assignee' || item.fieldId === 'assignee') {
        currentAssignee = item.toString || null;
      }
    });

    const statusItem = items.find((item) => item.field === 'status');
    if (!statusItem) continue;

    const toStatus = (statusItem.toString || '').toLowerCase();
    const fromStatus = (statusItem.fromString || '').toLowerCase();

    if (toStatus === 'for peer review') {
      cycleStart = changelog[i].created;
      cycleStartAssignee = currentAssignee;
    } else if (fromStatus === 'for peer review' && cycleStart) {
      cycles.push({
        enteredAt: cycleStart, exitedAt: changelog[i].created,
        exitedToStatus: statusItem.toString || '',
        reviewer: currentAssignee || '',
        reviewerAtEntry: cycleStartAssignee || '',
      });
      cycleStart = null;
      cycleStartAssignee = null;
    }
  }

  if (cycleStart) {
    cycles.push({
      enteredAt: cycleStart, exitedAt: null, exitedToStatus: null,
      reviewer: currentAssignee || '',
      reviewerAtEntry: cycleStartAssignee || '',
    });
  }

  return cycles;
}

/**
 * Which issue types skip peer/dev review entirely and hand off straight to the requester
 * ("Investigations") vs which go through the normal SE peer-review path ("backend changes" —
 * also the fallback for any issue type not explicitly listed in either group).
 */
const CYCLE_TIME_INVESTIGATION_ISSUE_TYPES = ['data generation', 'external support request', 'investigation', 'team viewer'];

// Archived/Rejected end cycle time for EVERY issue type regardless of group — a ticket that's
// archived or rejected outright never reaches a review status at all, so without this it would
// have no cycle_time_end and get silently excluded from the average forever.
const CYCLE_TIME_UNIVERSAL_END_STATUSES = ['archived', 'rejected'];

/**
 * The representative review-handoff status for this issue type's GROUP — used where only group
 * membership matters (e.g. ToolAssistedApi.gs excluding Investigations from its comparison),
 * not the full set of statuses that can end cycle time — see cycleTimeEndStatusesForIssueType_
 * for that.
 */
function cycleTimeEndStatusForIssueType_(issueType) {
  const type = (issueType || '').toLowerCase();
  return CYCLE_TIME_INVESTIGATION_ISSUE_TYPES.indexOf(type) !== -1 ? 'for checking' : 'for peer review';
}

/**
 * Every status that ends this issue type's cycle time (see extractReviewCycleTimeRange_) —
 * "backend changes" issue types (Company Policy, Backend Changes, Task, Account Creation, Data
 * Deletion, Technical Story — also the fallback for anything unlisted) hand off at For Peer
 * Review; "Investigations" issue types hand off at For Checking or For Product Team instead.
 * Archived/Rejected apply on top, regardless of group.
 */
function cycleTimeEndStatusesForIssueType_(issueType) {
  const type = (issueType || '').toLowerCase();
  const reviewHandoffStatuses = CYCLE_TIME_INVESTIGATION_ISSUE_TYPES.indexOf(type) !== -1
    ? ['for checking', 'for product team']
    : ['for peer review'];
  return reviewHandoffStatuses.concat(CYCLE_TIME_UNIVERSAL_END_STATUSES);
}

/**
 * SE/ST cycle-time definition (replaces backlog-exit -> resolution for teams with
 * has_peer_review_tracking): the span from when the ticket first moved OUT of Backlog/To Do
 * (`backlogExitFallback`, i.e. `first_out_of_backlog_todo` — a fixed point per ticket) to the
 * end of `endStatuses` (see cycleTimeEndStatusesForIssueType_), which splits into two cases:
 *
 * - Handoff statuses (For Peer Review / For Checking / For Product Team) can legitimately be
 *   re-entered after more work, so `cycleTimeEnd` is overwritten every time a LATER matching
 *   transition is seen while walking the changelog chronologically — a ticket that bounces
 *   On Hold -> In Progress -> handoff again automatically recomputes using the latest entry.
 * - CYCLE_TIME_UNIVERSAL_END_STATUSES (archived/rejected) are terminal: once a ticket reaches
 *   either one, it's done. A LATER move between them, or from a handoff status into one of them
 *   after the ticket had already gone terminal, is a reclassification of an already-finished
 *   ticket (e.g. Archived -> Rejected weeks later) — not more work — so only the FIRST terminal
 *   transition counts, and it wins outright over any handoff timestamp. A ticket that reaches its
 *   review status and is only LATER archived/rejected (no prior terminal transition) still picks
 *   up that archived/rejected timestamp — this is the same case the old "latest wins" rule
 *   handled, since the first terminal transition and the latest are the same event there.
 *
 * The start does NOT track "In Progress" re-entries — it's always the ticket's original
 * backlog-exit moment, regardless of how many times it later cycles back through review.
 */
function extractReviewCycleTimeRange_(changelog, backlogExitFallback, endStatuses) {
  let cycleTimeEnd = null;
  let terminalAt = null;

  for (let i = 0; i < changelog.length; i++) {
    const statusItem = (changelog[i].items || []).find((item) => item.field === 'status');
    if (!statusItem) continue;

    const toStatus = (statusItem.toString || '').toLowerCase();
    if (endStatuses.indexOf(toStatus) === -1) continue;

    if (CYCLE_TIME_UNIVERSAL_END_STATUSES.indexOf(toStatus) !== -1) {
      if (!terminalAt) terminalAt = changelog[i].created;
    } else if (!terminalAt) {
      cycleTimeEnd = changelog[i].created;
    }
  }

  return { startAt: backlogExitFallback || null, endAt: terminalAt || cycleTimeEnd };
}

/**
 * Walks the changelog chronologically and returns every In Progress cycle as
 * { enteredAt, exitedAt } — mirrors extractHoldingCyclesWithReasons_'s multi-cycle
 * handling but for "In Progress" and without reason-tracking (not applicable here).
 * Captures active-effort time even for tickets that bounce back into In Progress
 * multiple times (e.g. In Progress -> On Hold -> In Progress -> On Hold -> For Checking).
 */
function extractInProgressCycles_(changelog) {
  const cycles = [];
  let cycleStart = null;

  for (let i = 0; i < changelog.length; i++) {
    const statusItem = (changelog[i].items || []).find((item) => item.field === 'status');
    if (!statusItem) continue;

    const toStatus = (statusItem.toString || '').toLowerCase();
    const fromStatus = (statusItem.fromString || '').toLowerCase();

    if (toStatus === 'in progress') {
      cycleStart = changelog[i].created;
    } else if (fromStatus === 'in progress' && cycleStart) {
      cycles.push({ enteredAt: cycleStart, exitedAt: changelog[i].created });
      cycleStart = null;
    }
  }

  if (cycleStart) {
    cycles.push({ enteredAt: cycleStart, exitedAt: null });
  }

  return cycles;
}

function getOrCreateRawTab_(teamKey, year) {
  const tabName = `RAW_${teamKey}_${year}`;
  const ss = getJiraDataSpreadsheet_();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  // Self-heals a tab that exists but has no header row — e.g. a prior execution got interrupted
  // (quota/timeout) between insertSheet and writing headers, or the Sheets service returned a
  // stale getLastColumn() under load. Without this, objectToSheetRow_/updateSheetRow_ (Utils.gs)
  // crash with "The number of columns in the range must be at least 1" on every write into it.
  if (sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, RAW_TICKET_HEADERS.length).setValues([RAW_TICKET_HEADERS]);
    sheet.getRange(1, 1, 1, RAW_TICKET_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Per-execution cache of issue_key -> row number, so a sync run doesn't re-scan column A per issue (avoids O(n^2)). */
var _rawIndexCache_ = {};

function getRawTicketIndex_(sheet, tabKey) {
  if (_rawIndexCache_[tabKey]) return _rawIndexCache_[tabKey];
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((r, i) => {
      if (r[0]) map[r[0]] = i + 2;
    });
  }
  const index = { map: map, nextRow: lastRow + 1 };
  _rawIndexCache_[tabKey] = index;
  return index;
}

function upsertRawTicketRow_(teamKey, row) {
  const year = new Date(row.created).getFullYear();
  const tabKey = `${teamKey}_${year}`;
  const sheet = getOrCreateRawTab_(teamKey, year);
  const index = getRawTicketIndex_(sheet, tabKey);
  const existingRow = index.map[row.issue_key];

  if (existingRow) {
    updateSheetRow_(sheet, existingRow, row);
  } else {
    appendObjectToSheet_(sheet, row);
    index.map[row.issue_key] = index.nextRow;
    index.nextRow += 1;
  }

  // Phase 3 of the Sheets -> Supabase migration: keep Supabase current alongside Sheets.
  // dualWriteTicketToSupabase_ (SupabaseClient.gs) swallows its own errors — Sheets stays
  // authoritative during this phase, so a Supabase hiccup must never break sync/backfill.
  dualWriteTicketToSupabase_(teamKey, row);
}

/** Accumulated in memory during a sync run, written once per team via flushDirtyDates_ (avoids a sheet write per issue). */
var _dirtyDatesCache_ = {};

function markDirtyDate_(teamKey, isoDate) {
  if (!_dirtyDatesCache_[teamKey]) _dirtyDatesCache_[teamKey] = {};
  _dirtyDatesCache_[teamKey][isoDate] = true;
}

function flushDirtyDates_(teamKey) {
  const pending = _dirtyDatesCache_[teamKey];
  if (!pending) return;
  const newDates = Object.keys(pending);
  if (!newDates.length) return;

  const sheet = getJiraDataSpreadsheet_().getSheetByName('AGG_CHECKPOINT');
  const rows = sheetToObjects_(sheet);
  const existing = rows.find((r) => r.team_key === teamKey);
  const currentDates = existing && existing.dirty_dates_json ? JSON.parse(existing.dirty_dates_json) : [];
  const merged = Array.from(new Set(currentDates.concat(newDates)));

  if (existing) {
    updateSheetRow_(sheet, existing._row, { dirty_dates_json: JSON.stringify(merged) });
  } else {
    appendObjectToSheet_(sheet, { team_key: teamKey, last_aggregated_at: '', dirty_dates_json: JSON.stringify(merged) });
  }
  delete _dirtyDatesCache_[teamKey];
}

function readSyncCheckpoint_(projectKey) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('SYNC_CHECKPOINT');
  const rows = sheetToObjects_(sheet);
  return rows.find((r) => r.project_key === projectKey) || { project_key: projectKey };
}

function writeSyncStatus_(projectKey, patch) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('SYNC_CHECKPOINT');
  const rows = sheetToObjects_(sheet);
  const existing = rows.find((r) => r.project_key === projectKey);
  const record = Object.assign({}, existing, patch, { project_key: projectKey });
  if (existing) {
    updateSheetRow_(sheet, existing._row, record);
  } else {
    appendObjectToSheet_(sheet, record);
  }
}

function logSyncError_(teamKey, issueKey, field, rawValue, message) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('ERROR_LOG');
  appendObjectToSheet_(sheet, {
    timestamp: nowIso_(),
    team_key: teamKey,
    issue_key: issueKey,
    field: field,
    raw_value: String(rawValue),
    error_message: message,
  });
}
