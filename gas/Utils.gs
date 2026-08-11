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

/** Converts an object into a row array matching the sheet's current header order. */
function objectToSheetRow_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.map((h) => (h in obj ? obj[h] : ''));
}

function appendObjectToSheet_(sheet, obj) {
  sheet.appendRow(objectToSheetRow_(sheet, obj));
}

/** Overwrites an existing row (1-indexed) with the given object's values. */
function updateSheetRow_(sheet, rowIndex, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map((h) => (h in obj ? obj[h] : sheet.getRange(rowIndex, headers.indexOf(h) + 1).getValue()));
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

function quarterLabel_(date) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

/** Shared rounding helpers — used by both Aggregation.gs and MetricsApi.gs. */
function round2_(n) { return Math.round(n * 100) / 100; }
function round4_(n) { return Math.round(n * 10000) / 10000; }

/**
 * Business-day / Manila-time helpers for SLA date math (LatePickupApi.gs). The
 * `new Date(y, m-1, d, ...)` local constructors here rely on the Apps Script project's
 * timeZone being Asia/Manila (appsscript.json) — the same implicit assumption
 * parseResolvedDateField_/resolvePeriodToDateRange_ already make elsewhere.
 */
function manilaHour_(date) {
  return Number(Utilities.formatDate(date, TIMEZONE, 'H'));
}

/** Manila calendar date, midnight, with no time-of-day component. */
function manilaDateOnly_(date) {
  const [y, m, d] = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd').split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Sat/Sun in Manila — no PH holiday calendar (confirmed out of scope). */
function isWeekend_(date) {
  const day = manilaDateOnly_(date).getDay(); // 0=Sun..6=Sat
  return day === 0 || day === 6;
}

/** Next Mon-Fri date strictly after `date` (`date` itself is assumed already a manilaDateOnly_ value). */
function nextBusinessDay_(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  while (isWeekend_(next)) next.setDate(next.getDate() + 1);
  return next;
}

/** 23:59:59.999 instant for a Manila calendar date. */
function endOfManilaDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/**
 * Reads RAW_<teamKey>_<year> for every calendar year [startDate,endDate] spans (both
 * 'yyyy-MM-dd' strings), merged into one array. Skips a tab that doesn't exist yet
 * (e.g. a future year not yet created by getOrCreateRawTab_) rather than throwing.
 */
function getRawRowsForYears_(teamKey, startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const ss = getJiraDataSpreadsheet_();
  let rows = [];
  for (let year = startYear; year <= endYear; year++) {
    const sheet = ss.getSheetByName(`RAW_${teamKey}_${year}`);
    if (!sheet) continue;
    rows = rows.concat(sheetToObjectsCached_(sheet));
  }
  return rows;
}

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
