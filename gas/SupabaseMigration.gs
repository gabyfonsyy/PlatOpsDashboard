/**
 * Phase 2 of the Sheets -> Supabase migration: one-time historical backfill. Reads every
 * existing sheet across all 3 workbooks and upserts it into the Supabase project set up in
 * Phase 1 (see supabase/schema.sql). Nothing here changes what the app reads from today —
 * Sheets stays the source of truth until Phase 4 cuts the frontend over route by route.
 *
 * Requires two Script Properties that do NOT exist yet in this project (set them via the Apps
 * Script editor: Project Settings -> Script Properties). Deliberately NOT added to
 * REQUIRED_SCRIPT_PROPERTIES in Config.gs, same reasoning as getInitiativesSpreadsheet_ — that
 * list is enforced on every request, so listing a migration-only property there would break
 * every existing route until it's set:
 *   SUPABASE_URL                — e.g. https://xxxxxxxxxxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — Project Settings -> API -> service_role secret, in Supabase
 *
 * Run runSupabaseMigration() manually from the Apps Script editor once. Apps Script caps
 * executions at 6 minutes, so — same shape as runInitialBackfill (Backfill.gs) — this processes
 * ONE step per execution (one small-tables pass, one RAW_<team>_<year> tab, or one rollup table)
 * and reschedules itself via a one-off trigger until every step is done. Safe to re-run: every
 * upsert targets its table's natural key via on_conflict, so already-migrated rows are just
 * overwritten with the same values, EXCEPT error_log (no natural key — see
 * migrateErrorLogToSupabase) which guards itself with its own done-flag.
 *
 * After it finishes, run verifySupabaseMigrationCounts() and spot-check a few real rows in the
 * Supabase table editor before anything downstream (Phase 3+) depends on this data.
 */

const SUPABASE_MIGRATION_CURSOR_KEY = 'SUPABASE_MIGRATION_STEP_INDEX';
const SUPABASE_ERROR_LOG_MIGRATED_KEY = 'SUPABASE_ERROR_LOG_MIGRATED';

function buildSupabaseMigrationSteps_() {
  const teams = getTeamsConfig_(); // all teams, active or not — migrate everything that exists
  const steps = ['smallTables'];
  teams.forEach((team) => {
    getAllRawYearsForTeam_(team.team_key).forEach((year) => {
      steps.push(`tickets:${team.team_key}:${year}`);
    });
  });
  steps.push('metricsDaily', 'metricsByAssigneeMonthly');
  COD_INITIATIVE_TEAM_KEYS.forEach((teamKey) => steps.push(`initiativeTickets:${teamKey}`));
  return steps;
}

function runSupabaseMigration() {
  const props = PropertiesService.getScriptProperties();
  const steps = buildSupabaseMigrationSteps_();
  const index = Number(props.getProperty(SUPABASE_MIGRATION_CURSOR_KEY) || 0);

  if (index >= steps.length) {
    deleteSupabaseMigrationTrigger_();
    sendAlertEmail_('Supabase migration complete', `All ${steps.length} steps finished. Run verifySupabaseMigrationCounts() next.`);
    return;
  }

  const step = steps[index];
  try {
    runSupabaseMigrationStep_(step);
  } catch (err) {
    notifyFailure_(`runSupabaseMigration failed at step "${step}" (${index + 1}/${steps.length})`, err);
    deleteSupabaseMigrationTrigger_();
    return; // do not advance past a failed step — fix the cause and re-run to retry it
  }

  props.setProperty(SUPABASE_MIGRATION_CURSOR_KEY, String(index + 1));
  Logger.log(`Supabase migration: completed step ${index + 1}/${steps.length} (${step}).`);
  scheduleSupabaseMigrationContinuation_();
}

function runSupabaseMigrationStep_(step) {
  if (step === 'smallTables') return migrateSmallTablesToSupabase();
  if (step === 'metricsDaily') return migrateMetricsDailyToSupabase();
  if (step === 'metricsByAssigneeMonthly') return migrateMetricsByAssigneeMonthlyToSupabase();
  if (step.indexOf('tickets:') === 0) {
    const parts = step.split(':');
    return migrateTicketsYearToSupabase_(parts[1], Number(parts[2]));
  }
  if (step.indexOf('initiativeTickets:') === 0) {
    return migrateInitiativeTicketsTeamToSupabase_(step.split(':')[1]);
  }
  throw new Error(`Unknown migration step: ${step}`);
}

function scheduleSupabaseMigrationContinuation_() {
  deleteSupabaseMigrationTrigger_();
  ScriptApp.newTrigger('runSupabaseMigration').timeBased().after(1000).create();
}

function deleteSupabaseMigrationTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runSupabaseMigration')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Clears the cursor so the next runSupabaseMigration() call starts over from step 0. */
function resetSupabaseMigration() {
  PropertiesService.getScriptProperties().deleteProperty(SUPABASE_MIGRATION_CURSOR_KEY);
  deleteSupabaseMigrationTrigger_();
  Logger.log('resetSupabaseMigration: cursor cleared. Run runSupabaseMigration to start over.');
}

// Supabase REST helpers, value coercion, dedupeByKey_, and the ticket/metrics row mappers all
// moved to SupabaseClient.gs — shared with the Phase 3 dual-write hooks in JiraSync.gs/
// Aggregation.gs so migration and ongoing sync can never disagree on row shape.

// ============================================================================
// Workbook 2 (Manager Data) + Workbook 3 (Initiatives) small tables — all comfortably small
// enough (manager-entered, low hundreds of rows) to migrate in one execution.
// ============================================================================

function migrateSmallTablesToSupabase() {
  migrateTeamsConfigToSupabase(); // first: roster/leave/rto reference team_key
  migrateRosterToSupabase();
  migrateLeaveToSupabase();
  migrateRtoToSupabase();
  migrateInsightsCacheToSupabase();
  migrateAppConfigToSupabase();
  migrateSyncCheckpointToSupabase();
  migrateAggCheckpointToSupabase();
  migrateErrorLogToSupabase();
  migrateProjectsToSupabase(); // before ticket_project_map/project_progress/project_tasks (FK)
  migrateTicketProjectMapToSupabase();
  migrateProjectProgressToSupabase();
  migrateProjectTasksToSupabase();
}

function migrateTeamsConfigToSupabase() {
  supabaseUpsert_('teams_config', getTeamsConfig_(), 'team_key');
}

function migrateRosterToSupabase() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('ROSTER');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      employee_name: String(r.employee_name || '').trim(),
      team_key: toStringOrNull_(r.team_key),
      role_title: toStringOrNull_(r.role_title),
      status: toStringOrNull_(r.status),
      start_date: toDateOrNull_(r.start_date),
      jira_display_name_alias: toStringOrNull_(r.jira_display_name_alias),
    }))
    .filter((r) => r.employee_name);
  supabaseUpsert_('roster', rows, 'employee_name');
}

function migrateLeaveToSupabase() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      leave_id: r.leave_id,
      employee_name: r.employee_name,
      team_key: toStringOrNull_(r.team_key),
      leave_type: toStringOrNull_(r.leave_type),
      start_date: toDateOrNull_(r.start_date),
      end_date: toDateOrNull_(r.end_date),
      num_days: toNumberOrNull_(r.num_days),
      half_day_period: toStringOrNull_(r.half_day_period),
      status: toStringOrNull_(r.status) || 'Approved',
      notes: toStringOrNull_(r.notes),
      created_by: toStringOrNull_(r.created_by),
      created_at: toTimestampOrNull_(r.created_at) || nowIso_(),
      updated_at: toTimestampOrNull_(r.updated_at) || nowIso_(),
    }))
    .filter((r) => r.leave_id);
  supabaseUpsert_('leave', rows, 'leave_id');
}

function migrateRtoToSupabase() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      rto_id: r.rto_id,
      employee_name: r.employee_name,
      team_key: toStringOrNull_(r.team_key),
      date: toDateOrNull_(r.date),
      attendance_type: r.attendance_type,
      notes: toStringOrNull_(r.notes),
      created_by: toStringOrNull_(r.created_by),
      created_at: toTimestampOrNull_(r.created_at) || nowIso_(),
      updated_at: toTimestampOrNull_(r.updated_at) || nowIso_(),
    }))
    .filter((r) => r.rto_id && r.date);
  supabaseUpsert_('rto', rows, 'rto_id');
}

/**
 * writeInsightCache_ (Insights.gs) updates in place by (scope_key, period_label), so under
 * normal operation there's at most one row per key — but a stray duplicate (predating that
 * logic, or a race between two generation runs) makes PostgREST's upsert fail outright: Postgres
 * can't apply ON CONFLICT DO UPDATE twice to the same target row within one INSERT statement.
 * Dedup by keeping the freshest (generated_at) row per key before upserting, since only the
 * latest value of a cache is ever meaningful anyway.
 *
 * period_label is written as a 'yyyy-MM' string (monthLabel_/currentMonthLabel_), but Sheets
 * auto-coerced that column to Date-typed cells at some point — confirmed via
 * logInsightsCacheKeyDistribution, which logs it as e.g. "Wed Jul 01 2026 00:00:00 GMT+0800".
 * Left uncoerced, JSON.stringify would serialize that Date as a full UTC ISO timestamp instead
 * of "2026-07", breaking any future lookup by month. monthLabel_ converts it back correctly
 * since the Date is always midnight Manila time on the 1st of the real month.
 */
function migrateInsightsCacheToSupabase() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  const latestByKey = {};
  sheetToObjects_(sheet).forEach((r) => {
    if (!r.scope_key || !r.period_label) return;
    const periodLabel = r.period_label instanceof Date ? monthLabel_(r.period_label) : String(r.period_label);
    const generatedAt = toTimestampOrNull_(r.generated_at) || '';
    const key = `${r.scope_key} ${periodLabel}`;
    if (latestByKey[key] && latestByKey[key].generated_at > generatedAt) return;
    latestByKey[key] = {
      scope_key: r.scope_key,
      period_label: periodLabel,
      narrative_text: toStringOrNull_(r.narrative_text),
      flags_json: toJsonOrNull_(r.flags_json),
      generated_at: generatedAt || nowIso_(),
      model_used: toStringOrNull_(r.model_used),
      generation_status: toStringOrNull_(r.generation_status),
      error_message: toStringOrNull_(r.error_message),
    };
  });
  supabaseUpsert_('insights_cache', Object.values(latestByKey), 'scope_key,period_label');
}

function migrateAppConfigToSupabase() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('APP_CONFIG');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      key: r.key,
      value: toStringOrNull_(r.value),
      updated_at: toTimestampOrNull_(r.updated_at) || nowIso_(),
    }))
    .filter((r) => r.key);
  supabaseUpsert_('app_config', rows, 'key');
}

function migrateSyncCheckpointToSupabase() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('SYNC_CHECKPOINT');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      project_key: r.project_key,
      last_synced_updated_ts: toTimestampOrNull_(r.last_synced_updated_ts),
      last_sync_status: toStringOrNull_(r.last_sync_status),
      last_sync_run_at: toTimestampOrNull_(r.last_sync_run_at),
      last_sync_error_message: toStringOrNull_(r.last_sync_error_message),
      last_full_backfill_completed_at: toTimestampOrNull_(r.last_full_backfill_completed_at),
      tickets_synced_last_run: toNumberOrNull_(r.tickets_synced_last_run),
      backfill_cursor: toStringOrNull_(r.backfill_cursor),
    }))
    .filter((r) => r.project_key);
  supabaseUpsert_('sync_checkpoint', rows, 'project_key');
}

function migrateAggCheckpointToSupabase() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('AGG_CHECKPOINT');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      team_key: r.team_key,
      last_aggregated_at: toTimestampOrNull_(r.last_aggregated_at),
      dirty_dates_json: toJsonOrNull_(r.dirty_dates_json) || [],
    }))
    .filter((r) => r.team_key);
  supabaseUpsert_('agg_checkpoint', rows, 'team_key');
}

/**
 * error_log has no natural key in Sheets (no *_id column), so it's a plain insert rather than
 * an upsert — re-running would duplicate every row. Guarded with its own done-flag instead,
 * same idiom as the DONE_ properties in Backfill.gs. Run resetSupabaseErrorLogMigration() first
 * if you genuinely need to redo it (e.g. after clearing the Supabase table).
 */
function migrateErrorLogToSupabase() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(SUPABASE_ERROR_LOG_MIGRATED_KEY)) return;

  const sheet = getJiraDataSpreadsheet_().getSheetByName('ERROR_LOG');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      timestamp: toTimestampOrNull_(r.timestamp) || nowIso_(),
      team_key: toStringOrNull_(r.team_key),
      issue_key: toStringOrNull_(r.issue_key),
      field: toStringOrNull_(r.field),
      raw_value: toStringOrNull_(r.raw_value),
      error_message: toStringOrNull_(r.error_message),
    }));
  supabaseInsert_('error_log', rows);
  props.setProperty(SUPABASE_ERROR_LOG_MIGRATED_KEY, nowIso_());
}

function resetSupabaseErrorLogMigration() {
  PropertiesService.getScriptProperties().deleteProperty(SUPABASE_ERROR_LOG_MIGRATED_KEY);
  Logger.log('resetSupabaseErrorLogMigration: cleared. Truncate the Supabase error_log table yourself before re-running, or you will get duplicates.');
}

function migrateProjectsToSupabase() {
  const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECTS');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      owning_team: toStringOrNull_(r.owning_team),
      teams_involved: toStringOrNull_(r.teams_involved) || '',
      owner: toStringOrNull_(r.owner),
      status: toStringOrNull_(r.status) || 'Not Started',
      tracking_mode: toStringOrNull_(r.tracking_mode) || 'manual',
      start_date: toDateOrNull_(r.start_date),
      target_date: toDateOrNull_(r.target_date),
      percent_complete: toNumberOrNull_(r.percent_complete) || 0,
      jira_label: toStringOrNull_(r.jira_label) || '',
      total_items: toNumberOrNull_(r.total_items),
      batch_size: toNumberOrNull_(r.batch_size),
      batches_per_week: toNumberOrNull_(r.batches_per_week),
      weekly_plan_json: toJsonOrNull_(r.weekly_plan_json) || [],
      notes: toStringOrNull_(r.notes),
      created_by: toStringOrNull_(r.created_by),
      created_at: toTimestampOrNull_(r.created_at) || nowIso_(),
      updated_at: toTimestampOrNull_(r.updated_at) || nowIso_(),
    }))
    .filter((r) => r.project_id);
  supabaseUpsert_('projects', rows, 'project_id');
}

function migrateTicketProjectMapToSupabase() {
  const sheet = getInitiativesSpreadsheet_().getSheetByName('TICKET_PROJECT_MAP');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      issue_key: r.issue_key,
      project_id: r.project_id,
      assigned_by: toStringOrNull_(r.assigned_by),
      assigned_at: toTimestampOrNull_(r.assigned_at) || nowIso_(),
    }))
    .filter((r) => r.issue_key);
  supabaseUpsert_('ticket_project_map', rows, 'issue_key');
}

function migrateProjectProgressToSupabase() {
  const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_PROGRESS');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      progress_id: r.progress_id,
      project_id: r.project_id,
      date: toDateOrNull_(r.date),
      issue_key: toStringOrNull_(r.issue_key) || '',
      items_processed: toNumberOrZero_(r.items_processed),
      notes: toStringOrNull_(r.notes) || '',
      created_by: toStringOrNull_(r.created_by),
      created_at: toTimestampOrNull_(r.created_at) || nowIso_(),
      updated_at: toTimestampOrNull_(r.updated_at) || nowIso_(),
    }))
    .filter((r) => r.progress_id);
  supabaseUpsert_('project_progress', rows, 'progress_id');
}

function migrateProjectTasksToSupabase() {
  const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_TASKS');
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      task_id: r.task_id,
      project_id: r.project_id,
      task_name: r.task_name,
      issue_key: toStringOrNull_(r.issue_key) || '',
      done: r.done === true || String(r.done).trim().toUpperCase() === 'TRUE',
      start_date: toDateOrNull_(r.start_date),
      target_date: toDateOrNull_(r.target_date),
      notes: toStringOrNull_(r.notes),
      created_by: toStringOrNull_(r.created_by),
      created_at: toTimestampOrNull_(r.created_at) || nowIso_(),
      updated_at: toTimestampOrNull_(r.updated_at) || nowIso_(),
    }))
    .filter((r) => r.task_id);
  supabaseUpsert_('project_tasks', rows, 'task_id');
}

// ============================================================================
// Large tables — one chunk (one RAW_<team>_<year> tab, or one whole rollup table) per step.
// ============================================================================

function migrateTicketsYearToSupabase_(teamKey, year) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName(`RAW_${teamKey}_${year}`);
  if (!sheet) return;
  const rows = sheetToObjects_(sheet)
    .filter((r) => r.issue_key && r.created) // created is NOT NULL in schema
    .map((r) => mapRawTicketRowToSupabase_(teamKey, r));
  const deduped = dedupeByKey_(rows, (r) => r.issue_key, (r) => r.last_synced_at);
  supabaseUpsert_('tickets', deduped, 'issue_key');
  Logger.log(`Supabase migration: tickets ${teamKey}_${year} — ${deduped.length} rows (${rows.length - deduped.length} duplicate issue_key rows collapsed).`);
}

function migrateMetricsDailyToSupabase() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY');
  const rows = sheetToObjects_(sheet)
    .filter((r) => r.team_key && r.issue_type && r.date)
    .map(mapMetricsDailyRowToSupabase_);
  // No reliable per-row timestamp on METRICS_DAILY — dedupeByKey_ falls back to sheet order
  // (last occurrence wins), which is fine since appendRow always adds new rows at the bottom.
  const deduped = dedupeByKey_(rows, (r) => `${r.team_key}|${r.issue_type}|${r.date}`);
  supabaseUpsert_('metrics_daily', deduped, 'team_key,issue_type,date');
}

function migrateMetricsByAssigneeMonthlyToSupabase() {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  const rows = sheetToObjects_(sheet)
    .filter((r) => r.team_key && r.assignee_display_name && r.month)
    .map(mapAssigneeMonthlyRowToSupabase_);
  const deduped = dedupeByKey_(rows, (r) => `${r.team_key}|${r.assignee_display_name}|${r.month}`);
  supabaseUpsert_('metrics_by_assignee_monthly', deduped, 'team_key,assignee_display_name,month');
}

function migrateInitiativeTicketsTeamToSupabase_(teamKey) {
  const sheet = getInitiativesSpreadsheet_().getSheetByName(initiativeTicketsTabName_(teamKey));
  if (!sheet) return;
  const rows = sheetToObjects_(sheet)
    .map((r) => ({
      issue_key: r.issue_key,
      team_key: teamKey,
      project_key: toStringOrNull_(r.project_key),
      summary: toStringOrNull_(r.summary),
      issue_type: toStringOrNull_(r.issue_type),
      status: toStringOrNull_(r.status),
      labels: toStringOrNull_(r.labels),
      assignee_display_name: toStringOrNull_(r.assignee_display_name),
      reporter_display_name: toStringOrNull_(r.reporter_display_name),
      created: toTimestampOrNull_(r.created),
      updated: toTimestampOrNull_(r.updated),
      duedate: toDateOrNull_(r.duedate),
      resolution: toStringOrNull_(r.resolution),
      resolved_datetime: toTimestampOrNull_(r.resolved_datetime),
      last_synced_at: toTimestampOrNull_(r.last_synced_at) || nowIso_(),
    }))
    .filter((r) => r.issue_key);
  const deduped = dedupeByKey_(rows, (r) => r.issue_key, (r) => r.last_synced_at);
  supabaseUpsert_('initiative_tickets', deduped, 'team_key,issue_key');
}

/**
 * Diagnostic for the insights_cache row-count mismatch verifySupabaseMigrationCounts reports:
 * migrateInsightsCacheToSupabase collapses duplicate (scope_key, period_label) rows, keeping
 * only the freshest — this logs how many sheet rows fall under each key, so you can confirm
 * those really are stale duplicates (heavy re-runs during development, most likely from
 * writeInsightCache_ never being wrapped in withLock_ the way LeaveApi/RtoApi/ProjectsApi are)
 * rather than distinct periods that got wrongly merged. Read-only, changes nothing.
 */
function logInsightsCacheKeyDistribution() {
  const rows = sheetToObjects_(getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE'));
  const counts = {};
  rows.forEach((r) => {
    const key = `${r.scope_key} | ${r.period_label}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  const lines = Object.keys(counts).sort().map((k) => `${k}: ${counts[k]} row(s)`);
  Logger.log(lines.join('\n'));
  Logger.log(`Total rows: ${rows.length}, distinct (scope_key, period_label) keys: ${lines.length}`);
}

// ============================================================================
// Post-migration verification — row-count comparison against the live sheets. Run once after
// runSupabaseMigration finishes; check the emailed report before starting Phase 3.
// ============================================================================

function verifySupabaseMigrationCounts() {
  const lines = [];
  let mismatches = 0;

  function check(label, sheetCount, table) {
    let supabaseCount;
    try {
      supabaseCount = supabaseCount_(table);
    } catch (err) {
      lines.push(`${label}: ERROR reading Supabase count — ${err}`);
      mismatches++;
      return;
    }
    const match = sheetCount === supabaseCount;
    if (!match) mismatches++;
    lines.push(`${label}: sheet=${sheetCount} supabase=${supabaseCount} ${match ? 'OK' : 'MISMATCH'}`);
  }

  const managerSs = getManagerDataSpreadsheet_();
  const jiraSs = getJiraDataSpreadsheet_();
  const initiativesSs = getInitiativesSpreadsheet_();

  check('teams_config', getTeamsConfig_().length, 'teams_config');
  check('roster', sheetToObjects_(managerSs.getSheetByName('ROSTER')).length, 'roster');
  check('leave', sheetToObjects_(managerSs.getSheetByName('LEAVE')).length, 'leave');
  check('rto', sheetToObjects_(managerSs.getSheetByName('RTO')).length, 'rto');
  check('insights_cache', sheetToObjects_(managerSs.getSheetByName('INSIGHTS_CACHE')).length, 'insights_cache');
  check('app_config', sheetToObjects_(managerSs.getSheetByName('APP_CONFIG')).length, 'app_config');
  check('sync_checkpoint', sheetToObjects_(jiraSs.getSheetByName('SYNC_CHECKPOINT')).length, 'sync_checkpoint');
  check('agg_checkpoint', sheetToObjects_(jiraSs.getSheetByName('AGG_CHECKPOINT')).length, 'agg_checkpoint');
  check('error_log', sheetToObjects_(jiraSs.getSheetByName('ERROR_LOG')).length, 'error_log');
  check('projects', sheetToObjects_(initiativesSs.getSheetByName('PROJECTS')).length, 'projects');
  check('ticket_project_map', sheetToObjects_(initiativesSs.getSheetByName('TICKET_PROJECT_MAP')).length, 'ticket_project_map');
  check('project_progress', sheetToObjects_(initiativesSs.getSheetByName('PROJECT_PROGRESS')).length, 'project_progress');
  check('project_tasks', sheetToObjects_(initiativesSs.getSheetByName('PROJECT_TASKS')).length, 'project_tasks');
  check('metrics_daily', sheetToObjects_(jiraSs.getSheetByName('METRICS_DAILY')).length, 'metrics_daily');
  check('metrics_by_assignee_monthly', sheetToObjects_(jiraSs.getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY')).length, 'metrics_by_assignee_monthly');

  let ticketSheetTotal = 0;
  getTeamsConfig_().forEach((team) => {
    getAllRawYearsForTeam_(team.team_key).forEach((year) => {
      const sheet = jiraSs.getSheetByName(`RAW_${team.team_key}_${year}`);
      if (sheet) ticketSheetTotal += sheetToObjects_(sheet).length;
    });
  });
  check('tickets (all RAW_<team>_<year> tabs)', ticketSheetTotal, 'tickets');

  let initiativeSheetTotal = 0;
  COD_INITIATIVE_TEAM_KEYS.forEach((teamKey) => {
    const sheet = initiativesSs.getSheetByName(initiativeTicketsTabName_(teamKey));
    if (sheet) initiativeSheetTotal += sheetToObjects_(sheet).length;
  });
  check('initiative_tickets (all teams)', initiativeSheetTotal, 'initiative_tickets');

  const report = lines.join('\n');
  Logger.log(report);
  sendAlertEmail_(
    mismatches ? `Supabase migration verification: ${mismatches} mismatch(es)` : 'Supabase migration verification: all counts match',
    report
  );
}
