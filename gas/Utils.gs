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

function monthLabel_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM');
}

function quarterLabel_(date) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}
