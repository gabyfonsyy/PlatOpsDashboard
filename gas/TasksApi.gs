/**
 * CRUD for the manager-entered PROJECT_TASKS tab — a per-project checklist for projects that are
 * better tracked as discrete tasks (e.g. "Databricks Handover to DBA": Review KT, Handover Session,
 * etc.) rather than batch throughput. Each task carries its own start/target date so it can render
 * as its own bar on the Gantt timeline; `done` (a plain checkbox, not a status enum) drives a
 * project's done/total task count, which ProjectsTable/ProjectsGanttChart prefer over both the
 * batch projection and the manual percent_complete field once a project has any tasks — see
 * resolveDisplayPercent in src/lib/projection.ts.
 */
var TasksApi = {
  list: function (params) {
    const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_TASKS');
    if (!sheet) return [];
    let rows = sheetToObjects_(sheet);
    if (params.project_id) rows = rows.filter((r) => String(r.project_id) === String(params.project_id));
    return rows.map((r) => {
      const o = stripRowMeta_(r);
      o.done = o.done === true || o.done === 'TRUE';
      o.start_date = toDisplayDate_(o.start_date);
      o.target_date = toDisplayDate_(o.target_date);
      return o;
    });
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_TASKS');
      if (!sheet) throw new Error('PROJECT_TASKS tab not found — run setupInitiatives.');
      const now = nowIso_();
      const record = Object.assign({ start_date: '', target_date: '', notes: '', issue_key: '' }, payload, {
        task_id: uuid_(),
        done: payload.done === true || payload.done === 'true',
        created_at: now,
        updated_at: now,
      });
      appendObjectToSheet_(sheet, record);
      const o = stripRowMeta_(record);
      o.start_date = toDisplayDate_(o.start_date);
      o.target_date = toDisplayDate_(o.target_date);
      return o;
    });
  },

  update: function (id, payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_TASKS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.task_id === id);
      if (!existing) throw new Error(`Task not found: ${id}`);
      const record = Object.assign({}, existing, payload, { updated_at: nowIso_() });
      if (payload.done !== undefined) record.done = payload.done === true || payload.done === 'true';
      updateSheetRow_(sheet, existing._row, record);
      const o = stripRowMeta_(record);
      o.start_date = toDisplayDate_(o.start_date);
      o.target_date = toDisplayDate_(o.target_date);
      return o;
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECT_TASKS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.task_id === id);
      if (!existing) throw new Error(`Task not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { task_id: id, deleted: true };
    });
  },
};
