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

  const rawHeaders = [
    'issue_key', 'project_key', 'issue_type', 'status', 'created', 'updated',
    'resolved_datetime', 'resolved_raw_text', 'first_out_of_backlog_todo',
    'fcr_value', 'escalation_value', 'assigned_se', 'assigned_cod', 'due_date',
    'product', 'holding_reason', 'rejection_category', 'cancellation_reason',
    'on_hold_entered_at', 'on_hold_exited_at', 'assignee_display_name',
    'reporter_display_name', 'last_synced_at',
  ];
  ['ST', 'DE', 'DEV'].forEach((team) => {
    ensureTab_(ss, `RAW_${team}_${currentYear}`, rawHeaders);
  });

  ensureTab_(ss, 'METRICS_DAILY', [
    'team_key', 'issue_type', 'date', 'tickets_created_count', 'tickets_resolved_count',
    'lead_time_sum_minutes', 'lead_time_count', 'cycle_time_sum_minutes', 'cycle_time_count',
    'fcr_eligible_count', 'fcr_not_escalated_count', 'escalated_count',
    'resolved_after_due_count', 'total_for_aging_denominator', 'assigned_count',
    'holding_reason_json', 'rejection_category_json', 'cancellation_reason_json',
    'on_hold_pickup_sum_minutes', 'on_hold_pickup_count',
  ]);

  ensureTab_(ss, 'METRICS_BY_ASSIGNEE_MONTHLY', [
    'team_key', 'assignee_display_name', 'month', 'tickets_assigned', 'tickets_resolved',
    'escalated_count', 'fcr_eligible_count', 'fcr_not_escalated_count',
    'resolved_after_due_count', 'avg_lead_time_minutes', 'avg_cycle_time_minutes',
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
  ]);
  if (teamsConfig.getLastRow() < 2) {
    teamsConfig.getRange(2, 1, 3, 15).setValues([
      ['ST', 'Support Experts (SE)', 'ST', 'native', 'customfield_10188', 'customfield_10189',
        true, true, true, false, 'Backlog,To Do', '', '#18A558', true, 1],
      ['DE', 'DBA', 'DE', 'text', 'customfield_11153', 'customfield_10097',
        false, false, false, true, 'Backlog,To Do', '', '#18A558', true, 2],
      ['DEV', 'DevOps', 'DEV', 'text', 'customfield_11153', 'customfield_10097',
        false, false, false, true, 'Backlog,To Do', '', '#18A558', true, 3],
    ]);
  }

  ensureTab_(ss, 'ROSTER', [
    'employee_name', 'team_key', 'role_title', 'status', 'start_date', 'jira_display_name_alias',
  ]);

  ensureTab_(ss, 'LEAVE', [
    'leave_id', 'employee_name', 'team_key', 'leave_type', 'start_date', 'end_date',
    'num_days', 'status', 'notes', 'created_by', 'created_at', 'updated_at',
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
