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
  'reporter_display_name', 'last_synced_at',
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
    last_synced_at: nowIso_(),
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
