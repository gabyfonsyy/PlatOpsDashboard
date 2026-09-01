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
    if (code >= 200 && code < 300) {
      // A successful PUT answers 204 with an EMPTY body, and JSON.parse('') throws — so an empty
      // 2xx is returned as null rather than parsed. Only jiraUpdateIssueFields_ hits this path;
      // every read endpoint returns a body.
      const text = response.getContentText();
      return text ? JSON.parse(text) : null;
    }

    if (JIRA_RETRYABLE_STATUS_CODES.indexOf(code) !== -1 && attempt < JIRA_MAX_RETRIES) {
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }

    throw new Error(`Jira request failed (HTTP ${code}): ${response.getContentText().slice(0, 500)}`);
  }
  throw new Error(`Jira request failed after ${JIRA_MAX_RETRIES} retries: ${lastError}`);
}

/**
 * True if `err` is jiraFetchWithRetry_ reporting that Jira rejected a stored nextPageToken
 * as invalid/expired (HTTP 400, "next page token" in the body). Unlike 429/5xx this is never
 * transient — retrying with the same token just fails again forever, so callers must clear
 * their stored cursor instead of scheduling another retry.
 */
function isExpiredPageTokenError_(err) {
  const message = String(err && err.message ? err.message : err);
  return /HTTP 400\b/.test(message) && /next page token/i.test(message);
}

/**
 * One page of JQL search results via /rest/api/3/search/jql — the endpoint Atlassian
 * replaced /rest/api/3/search with (the old one returns HTTP 410 Gone as of their 2025
 * migration, see CHANGE-2046). Pagination is now token-based, not offset-based:
 * pass `pageToken` falsy for the first page; the response's `nextPageToken` is empty/
 * absent on the last page instead of a `total` count (the new endpoint doesn't return
 * a total at all). Returns { issues, nextPageToken }.
 */
function jiraSearchIssues_(jql, pageToken, maxResults, fields) {
  const base = getScriptProperty_('JIRA_BASE_URL');
  const payload = {
    jql: jql,
    maxResults: maxResults,
    fields: fields || ['*all'],
  };
  if (pageToken) payload.nextPageToken = pageToken;

  const result = jiraFetchWithRetry_(`${base}/rest/api/3/search/jql`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  });
  return { issues: result.issues || [], nextPageToken: result.nextPageToken || '' };
}

/**
 * Sets fields on ONE issue — PUT /rest/api/3/issue/{key}. Pass null as a value to clear a field.
 *
 * The ONLY write this integration makes to Jira, and it exists for exactly one caller:
 * IncidentsApi.removeTicket clearing Report Tagging (customfield_10262) on a ticket that turned out
 * not to be a valid incident. It is here rather than inlined there so the fact that this client can
 * write at all is visible in one place — everything else in this file reads, and it should stay
 * that way.
 *
 * Retrying is safe: the only call sets a field to a fixed value, so a replayed request lands on the
 * same state. Jira returns 204 with no body, so a successful call is simply one that doesn't throw.
 */
function jiraUpdateIssueFields_(issueKey, fields) {
  const base = getScriptProperty_('JIRA_BASE_URL');
  jiraFetchWithRetry_(`${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify({ fields: fields }),
  });
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
  const standard = ['created', 'updated', 'status', 'issuetype', 'assignee', 'reporter', 'resolution', 'duedate', 'labels'];
  const custom = [
    teamConfig.resolved_date_field_id,
    teamConfig.assignee_field_id,
    'customfield_10143', // First Contact Resolution
    'customfield_10146', // Ticket Escalation
    'customfield_10197', // Product
    'customfield_11463', // Ticket Holding Reason
    'customfield_11496', // Ticket Rejection Category
    'customfield_11285', // Cancellation Reason
  ];
  return standard.concat(custom);
}
