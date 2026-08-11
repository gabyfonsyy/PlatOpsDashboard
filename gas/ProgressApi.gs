/**
 * CRUD for the manager-entered PROJECT_PROGRESS tab — the per-batch "databases processed" log.
 * One row per processing event (a batch / a ticket's worth of items); rows are keyed by
 * project_id and summed by the frontend into a project's actual processed total (which drives
 * % complete + the actual-throughput re-forecast). An optional issue_key links a batch to a
 * cod-initiative ticket. Lives in the Initiatives workbook next to PROJECTS; the Jira re-sync
 * never touches it, so manual counts are safe.
 */
var ProgressApi = {
  list: function (params) {
    const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_PROGRESS');
    if (!sheet) return [];
    let rows = sheetToObjects_(sheet);
    if (params.project_id) rows = rows.filter((r) => String(r.project_id) === String(params.project_id));
    return rows.map((r) => {
      const o = stripRowMeta_(r);
      o.date = toDisplayDate_(o.date); // Sheets round-trips dates as Date objects — normalize to yyyy-MM-dd Manila.
      return o;
    });
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_PROGRESS');
      if (!sheet) throw new Error('PROJECT_PROGRESS tab not found — run setupInitiatives.');
      const now = nowIso_();
      const record = Object.assign({ issue_key: '', notes: '' }, payload, {
        progress_id: uuid_(),
        items_processed: Number(payload.items_processed) || 0,
        created_at: now,
        updated_at: now,
      });
      appendObjectToSheet_(sheet, record);
      const o = stripRowMeta_(record);
      o.date = toDisplayDate_(o.date);
      return o;
    });
  },

  update: function (id, payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_PROGRESS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.progress_id === id);
      if (!existing) throw new Error(`Progress row not found: ${id}`);
      const record = Object.assign({}, existing, payload, { updated_at: nowIso_() });
      if (payload.items_processed !== undefined) record.items_processed = Number(payload.items_processed) || 0;
      updateSheetRow_(sheet, existing._row, record);
      const o = stripRowMeta_(record);
      o.date = toDisplayDate_(o.date);
      return o;
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_PROGRESS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.progress_id === id);
      if (!existing) throw new Error(`Progress row not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { progress_id: id, deleted: true };
    });
  },
};
