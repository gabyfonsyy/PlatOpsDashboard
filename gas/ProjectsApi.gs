/** CRUD for the manager-entered PROJECTS (Project Tracker) tab. */
var ProjectsApi = {
  list: function (params) {
    const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECTS');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.owning_team === params.team);
    if (params.status) rows = rows.filter((r) => r.status === params.status);
    return rows.map(stripRowMeta_);
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECTS');
      const now = nowIso_();
      const record = Object.assign({
        teams_involved: '',
        jira_label: '',
        total_items: '',
        batch_size: '',
        batches_per_week: '',
        weekly_plan_json: '[]',
        tracking_mode: 'manual',
      }, payload, {
        project_id: uuid_(),
        status: payload.status || 'Not Started',
        percent_complete: payload.percent_complete || 0,
        created_at: now,
        updated_at: now,
      });
      appendObjectToSheet_(sheet, record);
      return stripRowMeta_(record);
    });
  },

  update: function (id, payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECTS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.project_id === id);
      if (!existing) throw new Error(`Project not found: ${id}`);
      // project_id pinned to the existing value AFTER payload, not before — payload has no field
      // whitelist (found via a full-codebase audit), so without this a client could pass its own
      // project_id and silently reassign this row's identity, orphaning it from future lookups.
      const record = Object.assign({}, existing, payload, { project_id: existing.project_id, updated_at: nowIso_() });
      updateSheetRow_(sheet, existing._row, record);
      return stripRowMeta_(record);
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('PROJECTS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.project_id === id);
      if (!existing) throw new Error(`Project not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { project_id: id, deleted: true };
    });
  },
};
