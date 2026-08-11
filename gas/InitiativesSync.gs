/**
 * Pulls Jira "cod-initiative" tickets into the Initiatives workbook, split into one tab per team
 * (INITIATIVE_TICKETS_<team>, e.g. INITIATIVE_TICKETS_DE / INITIATIVE_TICKETS_DEV /
 * INITIATIVE_TICKETS_ST) so each team's initiatives are easy to eyeball in the sheet. Scoped to
 * the teams in COD_INITIATIVE_TEAM_KEYS (DBA/DevOps + Support Experts) and to tickets created in
 * 2026 onward. The label is per team (see COD_INITIATIVE_LABEL_BY_TEAM): DE/DEV use
 * 'cod-initiative', SE/ST uses 'se-initiative'. SE/ST is wired in but stays empty until those
 * tickets actually carry 'se-initiative' in Jira. Volume is low, so each run does a full re-pull
 * and upserts by issue_key (reuses JiraClient.gs jiraSearchIssues_ — no changelog needed here).
 */

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
    'created', 'updated', 'duedate', 'resolution',
  ].concat(resolvedFields);

  // One {sheet, index} per team tab, created lazily as tickets for that team are seen.
  const tabs = {};
  const getTab = function (teamKey) {
    if (!tabs[teamKey]) {
      const sheet = getOrCreateInitiativeTicketsTab_(teamKey);
      tabs[teamKey] = { sheet: sheet, index: getInitiativeTicketIndex_(sheet) };
    }
    return tabs[teamKey];
  };

  let pageToken;
  let count = 0;
  while (true) {
    const page = jiraSearchIssues_(jql, pageToken, 100, fields);
    page.issues.forEach((issue) => {
      const projectKey = projectKeyFromIssueKey_(issue.key);
      const team = teamByProjectKey[projectKey];
      const teamKey = team ? team.team_key : projectKey; // team_key == project_key for DE/DEV
      const tab = getTab(teamKey);
      upsertInitiativeTicketRow_(tab.sheet, tab.index, mapInitiativeIssueToRow_(team, issue));
      count++;
    });
    if (!page.nextPageToken || page.issues.length === 0 || page.nextPageToken === pageToken) break;
    pageToken = page.nextPageToken;
  }

  Logger.log(`syncInitiativeTickets: upserted ${count} ticket(s).`);
  return { synced: count };
}

/** e.g. "DEV-45" -> "DEV". */
function projectKeyFromIssueKey_(issueKey) {
  const key = String(issueKey);
  const i = key.lastIndexOf('-');
  return i > 0 ? key.slice(0, i) : key;
}

function mapInitiativeIssueToRow_(team, issue) {
  const f = issue.fields || {};
  const resolved = team ? parseResolvedDateField_(team, f, issue.key) : { value: null };
  return {
    issue_key: issue.key,
    project_key: projectKeyFromIssueKey_(issue.key),
    summary: f.summary || '',
    issue_type: f.issuetype ? f.issuetype.name : '',
    status: f.status ? f.status.name : '',
    labels: Array.isArray(f.labels) ? f.labels.join(', ') : '',
    assignee_display_name: f.assignee ? f.assignee.displayName : '',
    reporter_display_name: f.reporter ? f.reporter.displayName : '',
    created: f.created || '',
    updated: f.updated || '',
    duedate: extractJiraFieldValue_(f.duedate),
    resolution: f.resolution ? f.resolution.name : '',
    resolved_datetime: resolved.value ? resolved.value.toISOString() : '',
    last_synced_at: nowIso_(),
  };
}

/** Per-team initiative-tickets tab name, e.g. 'DE' -> 'INITIATIVE_TICKETS_DE'. */
function initiativeTicketsTabName_(teamKey) {
  return `INITIATIVE_TICKETS_${teamKey}`;
}

function getOrCreateInitiativeTicketsTab_(teamKey) {
  const ss = getInitiativesSpreadsheet_();
  const name = initiativeTicketsTabName_(teamKey);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, INITIATIVE_TICKET_HEADERS.length).setValues([INITIATIVE_TICKET_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * One-time migration: splits a legacy single INITIATIVE_TICKETS tab into per-team tabs by
 * project_key, then leaves the old tab for you to delete once verified. Safe to re-run — if the
 * legacy tab is gone it just ensures the per-team tabs exist. (Re-running syncInitiativeTickets
 * also repopulates them from Jira via a full re-pull, so this migration is optional.)
 */
function migrateSplitInitiativeTickets() {
  const ss = getInitiativesSpreadsheet_();
  COD_INITIATIVE_TEAM_KEYS.forEach((tk) => getOrCreateInitiativeTicketsTab_(tk));

  const legacy = ss.getSheetByName('INITIATIVE_TICKETS');
  if (!legacy) { Logger.log('No legacy INITIATIVE_TICKETS tab — per-team tabs ensured.'); return; }

  const tabs = {};
  let moved = 0;
  sheetToObjects_(legacy).forEach((r) => {
    const tk = String(r.project_key || '').trim();
    if (!tk) return;
    if (!tabs[tk]) {
      const sheet = getOrCreateInitiativeTicketsTab_(tk);
      tabs[tk] = { sheet: sheet, index: getInitiativeTicketIndex_(sheet) };
    }
    upsertInitiativeTicketRow_(tabs[tk].sheet, tabs[tk].index, stripRowMeta_(r));
    moved++;
  });
  Logger.log(`migrateSplitInitiativeTickets: moved ${moved} row(s) into per-team tabs. `
    + 'Delete the old INITIATIVE_TICKETS tab manually once verified.');
}

/** issue_key -> row number, computed once per run (mirrors JiraSync.gs getRawTicketIndex_). */
function getInitiativeTicketIndex_(sheet) {
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((r, i) => { if (r[0]) map[r[0]] = i + 2; });
  }
  return { map: map, nextRow: lastRow + 1 };
}

function upsertInitiativeTicketRow_(sheet, index, row) {
  const existing = index.map[row.issue_key];
  if (existing) {
    updateSheetRow_(sheet, existing, row);
  } else {
    appendObjectToSheet_(sheet, row);
    index.map[row.issue_key] = index.nextRow;
    index.nextRow += 1;
  }
}
