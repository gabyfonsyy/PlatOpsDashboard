/**
 * Thin Jira Cloud REST v3 client: auth, retry-with-backoff, JQL search (paginated),
 * and changelog fetch (paginated). No sync/business logic lives here — see JiraSync.gs.
 */

function getJiraAuthHeader_() {
  const email = getScriptProperty_('JIRA_EMAIL');
  const token = getScriptProperty_('JIRA_API_TOKEN');
  return 'Basic ' + Utilities.base64Encode(`${email}:${token}`);
}

const JIRA_RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
const JIRA_MAX_RETRIES = 3;

/** UrlFetchApp wrapper with exponential backoff (1s, 2s, 4s) on 429/5xx. Throws on non-retryable errors. */
function jiraFetchWithRetry_(url, options) {
  const opts = Object.assign({
    method: 'get',
    headers: { Authorization: getJiraAuthHeader_(), Accept: 'application/json' },
    muteHttpExceptions: true,
  }, options || {});

  let lastError;
  for (let attempt = 0; attempt <= JIRA_MAX_RETRIES; attempt++) {
    let response;
    try {
      response = UrlFetchApp.fetch(url, opts);
    } catch (err) {
      lastError = err;
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }

    const code = response.getResponseCode();
    if (code >= 200 && code < 300) return JSON.parse(response.getContentText());

    if (JIRA_RETRYABLE_STATUS_CODES.indexOf(code) !== -1 && attempt < JIRA_MAX_RETRIES) {
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }

    throw new Error(`Jira request failed (HTTP ${code}): ${response.getContentText().slice(0, 500)}`);
  }
  throw new Error(`Jira request failed after ${JIRA_MAX_RETRIES} retries: ${lastError}`);
}

/**
 * One page of JQL search results.
 * Returns { issues, startAt, maxResults, total }.
 */
function jiraSearchIssues_(jql, startAt, maxResults, fields) {
  const base = getScriptProperty_('JIRA_BASE_URL');
  const params = {
    jql: jql,
    startAt: String(startAt),
    maxResults: String(maxResults),
    fields: (fields || ['*all']).join(','),
  };
  const query = Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  return jiraFetchWithRetry_(`${base}/rest/api/3/search?${query}`);
}

/** Fetches the FULL changelog for one issue, transparently paginating (maxResults=100/page). */
function jiraGetChangelog_(issueKey) {
  const base = getScriptProperty_('JIRA_BASE_URL');
  let startAt = 0;
  const all = [];
  while (true) {
    const page = jiraFetchWithRetry_(
      `${base}/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=100`
    );
    all.push.apply(all, page.values);
    startAt += page.values.length;
    if (startAt >= page.total || page.values.length === 0) break;
  }
  return all; // oldest first, per Jira's default changelog ordering
}

/** The field IDs every team config needs pulled from Jira, deduped, plus always-needed standard fields. */
function buildJiraFieldList_(teamConfig) {
  const standard = ['created', 'updated', 'status', 'issuetype', 'assignee', 'reporter', 'resolution'];
  const custom = [
    teamConfig.resolved_date_field_id,
    teamConfig.assignee_field_id,
    'customfield_10143', // First Contact Resolution
    'customfield_10146', // Ticket Escalation
    'customfield_10881', // Due Date
    'customfield_10197', // Product
    'customfield_11463', // Ticket Holding Reason
    'customfield_11496', // Ticket Rejection Category
    'customfield_11285', // Cancellation Reason
  ];
  return standard.concat(custom);
}
