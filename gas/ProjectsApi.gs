/** CRUD for the manager-entered PROJECTS (Project Tracker) tab. */
var ProjectsApi = {
  list: function (params) {
    const sheet = getManagerDataSpreadsheet_().getSheetByName('PROJECTS');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.owning_team === params.team);
    if (params.status) rows = rows.filter((r) => r.status === params.status);
    return rows.map(stripRowMeta_);
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('PROJECTS');
      const now = nowIso_();
      const record = Object.assign({}, payload, {
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
      const sheet = getManagerDataSpreadsheet_().getSheetByName('PROJECTS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.project_id === id);
      if (!existing) throw new Error(`Project not found: ${id}`);
      const record = Object.assign({}, existing, payload, { updated_at: nowIso_() });
      updateSheetRow_(sheet, existing._row, record);
      return stripRowMeta_(record);
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('PROJECTS');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.project_id === id);
      if (!existing) throw new Error(`Project not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { project_id: id, deleted: true };
    });
  },
};
