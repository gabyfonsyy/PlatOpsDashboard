/**
 * Script Properties accessors and the TEAMS_CONFIG reader that drives every
 * sync/aggregation/API function (see Section 8, scalability path, in the plan).
 */

const REQUIRED_SCRIPT_PROPERTIES = [
  'SPREADSHEET_ID_JIRA',
  'SPREADSHEET_ID_MANAGER',
  'JIRA_BASE_URL',
  'JIRA_EMAIL',
  'JIRA_API_TOKEN',
  'AI_API_KEY',
  'API_SHARED_SECRET',
];

function getScriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Missing required Script Property: ${key}`);
  return value;
}

/** Fails loudly and lists every missing property, rather than one at a time. */
function assertConfigured_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = REQUIRED_SCRIPT_PROPERTIES.filter((k) => !props[k]);
  if (missing.length) {
    throw new Error(`Missing Script Properties: ${missing.join(', ')}`);
  }
}

function getJiraDataSpreadsheet_() {
  return SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_JIRA'));
}

function getManagerDataSpreadsheet_() {
  return SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_MANAGER'));
}

/**
 * The separate Initiatives workbook (logged PROJECTS + Jira-pulled INITIATIVE_TICKETS).
 * Deliberately NOT in REQUIRED_SCRIPT_PROPERTIES: that list is enforced by assertConfigured_
 * on every request, so listing it there would break all existing routes until the property
 * is set. Instead this throws a clear "Missing required Script Property" only when an
 * initiatives route is actually used.
 */
function getInitiativesSpreadsheet_() {
  return SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_INITIATIVES'));
}

/**
 * The Site Monitoring workbook (per-client ops data — Domain, Database, App Pool, Keycloak — read
 * by SiteMonitoringApi.gs for P1 triage). Not in REQUIRED_SCRIPT_PROPERTIES for the same reason
 * as getInitiativesSpreadsheet_ above: adding it there would break every existing route until this
 * one property is set. It throws its own clear "Missing required Script Property" only when the
 * site-monitoring route is actually used.
 */
function getSiteMonitoringSpreadsheet_() {
  return SpreadsheetApp.openById(getScriptProperty_('SPREADSHEET_ID_SITE_MONITORING'));
}

/** Reads TEAMS_CONFIG and coerces boolean/number columns — the single source every module reads from. */
function getTeamsConfig_() {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('TEAMS_CONFIG');
  const rows = sheetToObjects_(sheet);
  return rows.map((r) => ({
    team_key: String(r.team_key).trim(),
    team_name: String(r.team_name).trim(),
    jira_project_key: String(r.jira_project_key).trim(),
    resolved_date_field_type: String(r.resolved_date_field_type).trim(),
    resolved_date_field_id: String(r.resolved_date_field_id).trim(),
    assignee_field_id: String(r.assignee_field_id).trim(),
    has_fcr_escalation: parseBool_(r.has_fcr_escalation),
    has_holding_reason: parseBool_(r.has_holding_reason),
    has_rejection_category: parseBool_(r.has_rejection_category),
    has_cancellation_reason: parseBool_(r.has_cancellation_reason),
    has_in_progress_tracking: parseBool_(r.has_in_progress_tracking),
    has_peer_review_tracking: parseBool_(r.has_peer_review_tracking),
    has_p1_sla_tracking: parseBool_(r.has_p1_sla_tracking),
    backlog_status_names_csv: String(r.backlog_status_names_csv || ''),
    issue_types_csv: String(r.issue_types_csv || ''),
    color_accent: String(r.color_accent || '#18A558'),
    active: parseBool_(r.active),
    sort_order: Number(r.sort_order) || 0,
  }));
}

function getActiveTeamsConfig_() {
  return getTeamsConfig_().filter((t) => t.active);
}

function getTeamConfigByProjectKey_(projectKey) {
  return getTeamsConfig_().find((t) => t.jira_project_key === projectKey);
}

function parseBool_(value) {
  if (typeof value === 'boolean') return value;
  return String(value).trim().toUpperCase() === 'TRUE';
}
