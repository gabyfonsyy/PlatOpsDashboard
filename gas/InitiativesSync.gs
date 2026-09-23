/**
 * Pulls Jira "cod-initiative" tickets straight into Supabase's `initiative_tickets` table
 * (schema: supabase/schema.sql, primary key (team_key, issue_key)) instead of the old per-team
 * INITIATIVE_TICKETS_<team> Sheets tabs. Scoped to the teams in COD_INITIATIVE_TEAM_KEYS
 * (DBA/DevOps + Support Experts) and to tickets created in 2026 onward. The label is per team
 * (see COD_INITIATIVE_LABEL_BY_TEAM): DE/DEV use 'cod-initiative', SE/ST uses 'se-initiative'.
 * Volume is low, so each run does a full re-pull and upserts by (team_key, issue_key) (reuses
 * JiraClient.gs's jiraSearchIssues_ — no changelog needed here).
 *
 * Row shape/coercion matches SupabaseMigration.gs's migrateInitiativeTicketsTeamToSupabase_
 * exactly (same table, same helpers from SupabaseClient.gs) so a live sync and a historical
 * backfill can never disagree on shape. Used to write the per-team Sheets tabs directly; moved
 * onto Supabase so Records -> Project Tracking reads/writes one consistent backend instead of
 * splitting parent projects (already migrated to Supabase, see gas/SupabaseMigration.gs's
 * migrateProjectsToSupabase) from their linked tickets (previously Sheets-only).
 */

// Legacy per-team Sheets tab name, e.g. 'DE' -> 'INITIATIVE_TICKETS_DE'. The live sync no longer
// writes these (see syncInitiativeTickets below), but Setup.gs still creates them on a fresh
// install for historical continuity, and SupabaseMigration.gs/InitiativesApi.gs still read them
// (a one-time historical backfill path / now-unused list route) — kept here since both need it.
function initiativeTicketsTabName_(teamKey) {
  return `INITIATIVE_TICKETS_${teamKey}`;
}

const INITIATIVE_TICKET_HEADERS = [
  'issue_key', 'project_key', 'summary', 'issue_type', 'status', 'labels',
  'assignee_display_name', 'reporter_display_name', 'created', 'updated',
  'duedate', 'resolution', 'resolved_datetime', 'last_synced_at',
];

const COD_INITIATIVE_TEAM_KEYS = ['DE', 'DEV', 'ST'];
const COD_INITIATIVE_LABEL = 'cod-initiative'; // default label
// Per-team label overrides — teams whose initiative tickets carry a different label than the
// default. SE (team_key ST) uses 'se-initiative'; DE/DEV fall back to COD_INITIATIVE_LABEL.
const COD_INITIATIVE_LABEL_BY_TEAM = { ST: 'se-initiative' };
const COD_INITIATIVE_SINCE = '2026-01-01';

/** The cod-initiative label a given team's tickets carry (per-team override, else the default). */
function initiativeLabelForTeam_(teamKey) {
  return COD_INITIATIVE_LABEL_BY_TEAM[teamKey] || COD_INITIATIVE_LABEL;
}

/** Entry point (manual run + time trigger). Returns { synced } for the API. */
function syncInitiativeTickets() {
  const teams = getTeamsConfig_().filter((t) => COD_INITIATIVE_TEAM_KEYS.indexOf(t.team_key) !== -1);
  if (!teams.length) {
    throw new Error(`No teams found in TEAMS_CONFIG for keys: ${COD_INITIATIVE_TEAM_KEYS.join(', ')}`);
  }

  const teamByProjectKey = {};
  teams.forEach((t) => { teamByProjectKey[t.jira_project_key] = t; });

  // Label varies per team, so match each team's project to its own label and OR them together,
  // e.g. (project = DE AND labels = "cod-initiative") OR (project = ST AND labels = "se-initiative").
  const teamClauses = teams.map((t) =>
    `(project = ${t.jira_project_key} AND labels = "${initiativeLabelForTeam_(t.team_key)}")`);
  const jql = `(${teamClauses.join(' OR ')})`
    + ` AND created >= "${COD_INITIATIVE_SINCE}" ORDER BY updated ASC`;
  // Resolved-date field differs per team (DE/DEV: customfield_11153 text; ST: customfield_10188
  // native). Pull each configured team's field so resolved_datetime populates for all of them
  // instead of hardcoding one — parseResolvedDateField_ then reads the right one per ticket.
  const resolvedFields = teams
    .map((t) => t.resolved_date_field_id)
    .filter((id, i, arr) => id && arr.indexOf(id) === i);
  const fields = [
    'summary', 'labels', 'status', 'issuetype', 'assignee', 'reporter',
    'created', 'updated', 'duedate', 'resolution', 'priority',
  ].concat(resolvedFields);

  let pageToken;
  let count = 0;
  let batch = [];
  const flush = function () {
    if (!batch.length) return;
    const deduped = dedupeByKey_(batch, (r) => `${r.team_key}|${r.issue_key}`);
    supabaseUpsert_('initiative_tickets', deduped, 'team_key,issue_key');
    batch = [];
  };

  while (true) {
    const page = jiraSearchIssues_(jql, pageToken, 100, fields);
    page.issues.forEach((issue) => {
      const projectKey = projectKeyFromIssueKey_(issue.key);
      const team = teamByProjectKey[projectKey];
      if (!team) return; // defensive — every issue in the JQL result should match a configured team
      batch.push(mapInitiativeIssueToRow_(team, issue, projectKey));
      count++;
      if (batch.length >= 500) flush();
    });
    if (!page.nextPageToken || page.issues.length === 0 || page.nextPageToken === pageToken) break;
    pageToken = page.nextPageToken;
  }
  flush();

  Logger.log(`syncInitiativeTickets: upserted ${count} ticket(s).`);
  return { synced: count };
}

/** e.g. "DEV-45" -> "DEV". */
function projectKeyFromIssueKey_(issueKey) {
  const key = String(issueKey);
  const i = key.lastIndexOf('-');
  return i > 0 ? key.slice(0, i) : key;
}

/** Same field shape/coercion as SupabaseMigration.gs's migrateInitiativeTicketsTeamToSupabase_. */
function mapInitiativeIssueToRow_(team, issue, projectKey) {
  const f = issue.fields || {};
  const resolved = parseResolvedDateField_(team, f, issue.key);
  return {
    issue_key: issue.key,
    team_key: team.team_key,
    project_key: projectKey,
    summary: toStringOrNull_(f.summary),
    issue_type: toStringOrNull_(f.issuetype ? f.issuetype.name : ''),
    status: toStringOrNull_(f.status ? f.status.name : ''),
    priority: toStringOrNull_(f.priority ? f.priority.name : ''),
    labels: toStringOrNull_(Array.isArray(f.labels) ? f.labels.join(', ') : ''),
    assignee_display_name: toStringOrNull_(f.assignee ? f.assignee.displayName : ''),
    reporter_display_name: toStringOrNull_(f.reporter ? f.reporter.displayName : ''),
    created: toTimestampOrNull_(f.created),
    updated: toTimestampOrNull_(f.updated),
    duedate: toDateOrNull_(extractJiraFieldValue_(f.duedate)),
    resolution: toStringOrNull_(f.resolution ? f.resolution.name : ''),
    resolved_datetime: resolved.value ? resolved.value.toISOString() : null,
    last_synced_at: nowIso_(),
  };
}
