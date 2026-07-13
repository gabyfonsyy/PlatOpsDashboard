/**
 * One-time setup: builds every tab, header row, and pre-filled config row in both
 * spreadsheets. Idempotent — re-running skips tabs that already exist with a header row.
 *
 * Run manually from the Apps Script editor (select setupAll, click Run) after setting
 * SPREADSHEET_ID_JIRA and SPREADSHEET_ID_MANAGER in Script Properties (see README.md).
 */

function setupAll() {
  setupJiraDataSpreadsheet_();
  setupManagerDataSpreadsheet_();
  Logger.log('Setup complete.');
}

function setupJiraDataSpreadsheet_() {
  const ss = SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_JIRA'));
  const currentYear = new Date().getFullYear();

  // RAW_TICKET_HEADERS lives in JiraSync.gs — shared here so the two never drift apart.
  ['ST', 'DE', 'DEV'].forEach((team) => {
    ensureTab_(ss, `RAW_${team}_${currentYear}`, RAW_TICKET_HEADERS);
  });

  ensureTab_(ss, 'METRICS_DAILY', [
    'team_key', 'issue_type', 'date', 'tickets_created_count', 'tickets_resolved_count',
    'tickets_resolved_on_date', 'overdue_resolved_on_date',
    'fcr_yes_resolved_on_date', 'escalation_qualifying_resolved_on_date',
    'lead_time_sum_minutes', 'lead_time_count', 'cycle_time_sum_minutes', 'cycle_time_count',
    'fcr_eligible_count', 'fcr_not_escalated_count', 'escalated_count',
    'resolved_after_due_count', 'total_for_aging_denominator', 'assigned_count',
    'holding_reason_json', 'rejection_category_json', 'cancellation_reason_json',
    'on_hold_pickup_sum_minutes', 'on_hold_pickup_count',
  ]);

  ensureTab_(ss, 'METRICS_BY_ASSIGNEE_MONTHLY', [
    'team_key', 'assignee_display_name', 'month', 'tickets_assigned', 'tickets_resolved',
    'tickets_resolved_in_month', 'overdue_resolved_in_month',
    'fcr_yes_resolved_in_month', 'escalation_qualifying_resolved_in_month',
    'escalated_count', 'fcr_eligible_count', 'fcr_not_escalated_count',
    'resolved_after_due_count', 'avg_lead_time_minutes', 'avg_cycle_time_minutes',
    'avg_in_progress_minutes',
  ]);

  const syncCheckpoint = ensureTab_(ss, 'SYNC_CHECKPOINT', [
    'project_key', 'last_synced_updated_ts', 'last_sync_status', 'last_sync_run_at',
    'last_sync_error_message', 'last_full_backfill_completed_at', 'tickets_synced_last_run',
    'backfill_cursor',
  ]);
  ensureRowsByKey_(syncCheckpoint, 'project_key', ['ST', 'DE', 'DEV']);

  const aggCheckpoint = ensureTab_(ss, 'AGG_CHECKPOINT', [
    'team_key', 'last_aggregated_at', 'dirty_dates_json',
  ]);
  ensureRowsByKey_(aggCheckpoint, 'team_key', ['ST', 'DE', 'DEV'], { dirty_dates_json: '[]' });

  ensureTab_(ss, 'ERROR_LOG', [
    'timestamp', 'team_key', 'issue_key', 'field', 'raw_value', 'error_message',
  ]);

  removeDefaultBlankSheet_(ss);
}

function setupManagerDataSpreadsheet_() {
  const ss = SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_MANAGER'));

  const teamsConfig = ensureTab_(ss, 'TEAMS_CONFIG', [
    'team_key', 'team_name', 'jira_project_key', 'resolved_date_field_type',
    'resolved_date_field_id', 'assignee_field_id', 'has_fcr_escalation',
    'has_holding_reason', 'has_rejection_category', 'has_cancellation_reason',
    'backlog_status_names_csv', 'issue_types_csv', 'color_accent', 'active', 'sort_order',
    'has_in_progress_tracking',
  ]);
  if (teamsConfig.getLastRow() < 2) {
    teamsConfig.getRange(2, 1, 3, 16).setValues([
      ['ST', 'Support Experts (SE)', 'ST', 'native', 'customfield_10188', 'customfield_10189',
        true, true, true, false, 'Backlog,To Do', '', '#18A558', true, 1, true],
      ['DE', 'DBA', 'DE', 'text', 'customfield_11153', 'customfield_10097',
        false, false, false, true, 'Backlog,To Do', '', '#18A558', true, 2, false],
      ['DEV', 'DevOps', 'DEV', 'text', 'customfield_11153', 'customfield_10097',
        false, false, false, true, 'Backlog,To Do', '', '#18A558', true, 3, false],
    ]);
  }

  ensureTab_(ss, 'ROSTER', [
    'employee_name', 'team_key', 'role_title', 'status', 'start_date', 'jira_display_name_alias',
  ]);

  ensureTab_(ss, 'LEAVE', [
    'leave_id', 'employee_name', 'team_key', 'leave_type', 'start_date', 'end_date',
    'num_days', 'half_day_period', 'status', 'notes', 'created_by', 'created_at', 'updated_at',
  ]);

  ensureTab_(ss, 'RTO', [
    'rto_id', 'employee_name', 'team_key', 'date', 'attendance_type', 'notes',
    'created_by', 'created_at', 'updated_at',
  ]);

  ensureTab_(ss, 'PROJECTS', [
    'project_id', 'project_name', 'owning_team', 'owner', 'status', 'start_date',
    'target_date', 'percent_complete', 'notes', 'created_by', 'created_at', 'updated_at',
  ]);

  ensureTab_(ss, 'INSIGHTS_CACHE', [
    'scope_key', 'period_label', 'narrative_text', 'flags_json', 'generated_at',
    'model_used', 'prompt_tokens_est', 'generation_status', 'error_message',
  ]);

  ensureTab_(ss, 'APP_CONFIG', ['key', 'value', 'updated_at']);

  removeDefaultBlankSheet_(ss);
}

/**
 * One-time migration: renames the old single-cycle on-hold columns to the new multi-cycle
 * equivalents in every existing RAW tab. Run once from the Apps Script editor after
 * deploying the updated JiraSync.gs. Safe to re-run — skips tabs already on new headers.
 *
 *   holding_reason      → holding_reasons_json   (JSON array of all reasons across all cycles)
 *   on_hold_entered_at  → total_on_hold_minutes   (sum of all on-hold durations)
 *   on_hold_exited_at   → _deprecated             (no longer used; column left in place)
 */
function migrateRawHoldingColumns() {
  const ss = SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_JIRA'));
  const teams = getTeamsConfig_();
  const years = ['2024', '2025', '2026'];
  const RENAME = {
    'holding_reason': 'holding_reasons_json',
    'on_hold_entered_at': 'total_on_hold_minutes',
    'on_hold_exited_at': '_deprecated',
  };

  teams.forEach((team) => {
    years.forEach((year) => {
      const tabName = `RAW_${team.team_key}_${year}`;
      const sheet = ss.getSheetByName(tabName);
      if (!sheet || sheet.getLastColumn() === 0) return;

      const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
      const headers = headerRange.getValues()[0];
      let changed = false;

      const newHeaders = headers.map((h) => {
        if (h in RENAME) { changed = true; return RENAME[h]; }
        return h;
      });

      if (changed) {
        headerRange.setValues([newHeaders]);
        Logger.log(`Migrated: ${tabName}`);
      } else {
        Logger.log(`Already up to date: ${tabName}`);
      }
    });
  });

  Logger.log('migrateRawHoldingColumns_ done.');
}

/**
 * One-time migration for already-provisioned spreadsheets (setupAll only adds columns to
 * brand-new sheets): appends the new in-progress-tracking columns used by ST's active-
 * effort-time feature. Safe to re-run — skips any column that's already present.
 *
 *   TEAMS_CONFIG                 + has_in_progress_tracking (TRUE for ST, FALSE elsewhere)
 *   RAW_<team>_<year>            + total_in_progress_minutes
 *   METRICS_BY_ASSIGNEE_MONTHLY  + avg_in_progress_minutes
 *
 * Existing RAW rows are left blank in the new column until their next sync — run
 * runStInProgressRebackfill (Backfill.gs) afterward to populate ST's history.
 */
function migrateAddInProgressTracking() {
  const jiraSs = SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_JIRA'));
  const managerSs = SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_MANAGER'));

  const teamsConfig = managerSs.getSheetByName('TEAMS_CONFIG');
  if (teamsConfig) {
    const added = appendColumnIfMissing_(teamsConfig, 'has_in_progress_tracking');
    if (added) {
      const headers = teamsConfig.getRange(1, 1, 1, teamsConfig.getLastColumn()).getValues()[0];
      const teamKeyCol = headers.indexOf('team_key') + 1;
      const newCol = headers.indexOf('has_in_progress_tracking') + 1;
      const lastRow = teamsConfig.getLastRow();
      if (lastRow > 1) {
        const teamKeys = teamsConfig.getRange(2, teamKeyCol, lastRow - 1, 1).getValues().flat();
        const values = teamKeys.map((k) => [String(k).trim() === 'ST']);
        teamsConfig.getRange(2, newCol, values.length, 1).setValues(values);
      }
      Logger.log('TEAMS_CONFIG: added has_in_progress_tracking.');
    }
  }

  ['ST', 'DE', 'DEV'].forEach((team) => {
    ['2024', '2025', '2026'].forEach((year) => {
      const sheet = jiraSs.getSheetByName(`RAW_${team}_${year}`);
      if (!sheet || sheet.getLastColumn() === 0) return;
      if (appendColumnIfMissing_(sheet, 'total_in_progress_minutes')) {
        Logger.log(`RAW_${team}_${year}: added total_in_progress_minutes.`);
      }
    });
  });

  const assigneeMonthly = jiraSs.getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  if (assigneeMonthly && appendColumnIfMissing_(assigneeMonthly, 'avg_in_progress_minutes')) {
    Logger.log('METRICS_BY_ASSIGNEE_MONTHLY: added avg_in_progress_minutes.');
  }

  Logger.log('migrateAddInProgressTracking done.');
}

/**
 * One-time migration: adds `tickets_resolved_on_date` to an existing METRICS_DAILY tab
 * (setupAll only adds it to brand-new sheets). This column holds tickets whose RESOLVED
 * date equals the row's date — the basis for the resolved-by-resolved-date trend line,
 * as opposed to `tickets_resolved_count` which counts by created date. After running this,
 * run backfillResolvedOnDate (Aggregation.gs) once to populate it for existing history.
 * Safe to re-run — skips if the column is already present.
 */
function migrateAddResolvedOnDate() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY');
  if (!sheet) { Logger.log('METRICS_DAILY not found.'); return; }
  ['tickets_resolved_on_date', 'overdue_resolved_on_date'].forEach((col) => {
    if (appendColumnIfMissing_(sheet, col)) {
      Logger.log(`METRICS_DAILY: added ${col}.`);
    } else {
      Logger.log(`METRICS_DAILY: ${col} already present.`);
    }
  });
}

/**
 * One-time migration: adds `tickets_resolved_in_month` to an existing METRICS_BY_ASSIGNEE_MONTHLY
 * tab — the assignee counterpart of tickets_resolved_on_date, counting tickets a person resolved
 * DURING the month (by resolved date). After running this, run backfillResolvedInMonth
 * (Aggregation.gs) once. Safe to re-run.
 */
function migrateAddResolvedInMonth() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  if (!sheet) { Logger.log('METRICS_BY_ASSIGNEE_MONTHLY not found.'); return; }
  ['tickets_resolved_in_month', 'overdue_resolved_in_month'].forEach((col) => {
    if (appendColumnIfMissing_(sheet, col)) {
      Logger.log(`METRICS_BY_ASSIGNEE_MONTHLY: added ${col}.`);
    } else {
      Logger.log(`METRICS_BY_ASSIGNEE_MONTHLY: ${col} already present.`);
    }
  });
}

/**
 * One-time migration: adds the resolved-date-bucketed FCR=Yes and "real escalation" counts to an
 * existing METRICS_DAILY tab. These back the redefined FCR Rate (FCR=Yes ÷ resolved in period) and
 * Escalation Rate (escalation not in {N/A,CA,SE,blank} ÷ resolved in period). After running this,
 * run backfillResolvedOnDate (Aggregation.gs) to populate them for existing history. Safe to re-run.
 */
function migrateAddFcrEscResolvedOnDate() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY');
  if (!sheet) { Logger.log('METRICS_DAILY not found.'); return; }
  ['fcr_yes_resolved_on_date', 'escalation_qualifying_resolved_on_date'].forEach((col) => {
    if (appendColumnIfMissing_(sheet, col)) {
      Logger.log(`METRICS_DAILY: added ${col}.`);
    } else {
      Logger.log(`METRICS_DAILY: ${col} already present.`);
    }
  });
}

/**
 * One-time migration: adds the per-assignee resolved-month FCR=Yes and "real escalation" counts to
 * METRICS_BY_ASSIGNEE_MONTHLY — the assignee counterpart of migrateAddFcrEscResolvedOnDate, backing
 * the Performance page per-assignee FCR/Escalation rates. After running this, run
 * backfillResolvedInMonth (Aggregation.gs). Safe to re-run.
 */
function migrateAddFcrEscResolvedInMonth() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  if (!sheet) { Logger.log('METRICS_BY_ASSIGNEE_MONTHLY not found.'); return; }
  ['fcr_yes_resolved_in_month', 'escalation_qualifying_resolved_in_month'].forEach((col) => {
    if (appendColumnIfMissing_(sheet, col)) {
      Logger.log(`METRICS_BY_ASSIGNEE_MONTHLY: added ${col}.`);
    } else {
      Logger.log(`METRICS_BY_ASSIGNEE_MONTHLY: ${col} already present.`);
    }
  });
}

/**
 * One-time migration: adds `half_day_period` to an existing LEAVE tab (setupAll only adds it
 * to brand-new sheets). This column records which half a half-day leave falls on
 * ('First Half' / 'Second Half'); it's blank for full-day leaves. Safe to re-run.
 */
function migrateAddLeaveHalfDay() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
  if (!sheet) { Logger.log('LEAVE not found.'); return; }
  if (appendColumnIfMissing_(sheet, 'half_day_period')) {
    Logger.log('LEAVE: added half_day_period.');
  } else {
    Logger.log('LEAVE: half_day_period already present.');
  }
}

/** Appends `headerName` as a new last column if the sheet doesn't already have it. Returns true if added. */
function appendColumnIfMissing_(sheet, headerName) {
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (headers.indexOf(headerName) !== -1) return false;

  const col = lastCol + 1;
  sheet.getRange(1, col).setValue(headerName).setFontWeight('bold');
  return true;
}

/** Creates the tab with a bold, frozen header row if it doesn't already exist. Returns the Sheet. */
function ensureTab_(spreadsheet, tabName, headers) {
  let sheet = spreadsheet.getSheetByName(tabName);
  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(tabName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

/** Appends one row per key in `keys` (matched against `keyColumn`) if not already present. */
function ensureRowsByKey_(sheet, keyColumn, keys, extraDefaults) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const keyIdx = headers.indexOf(keyColumn);
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, keyIdx + 1, sheet.getLastRow() - 1, 1).getValues().flat()
    : [];

  keys.filter((k) => existing.indexOf(k) === -1).forEach((k) => {
    const row = headers.map((h) => {
      if (h === keyColumn) return k;
      if (extraDefaults && h in extraDefaults) return extraDefaults[h];
      return '';
    });
    sheet.appendRow(row);
  });
}

/** New spreadsheets start with a blank "Sheet1" — remove it once real tabs exist. */
function removeDefaultBlankSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Sheet1');
  if (sheet && spreadsheet.getSheets().length > 1) {
    spreadsheet.deleteSheet(sheet);
  }
}
