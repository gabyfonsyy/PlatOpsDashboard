/** CRUD for the manager-entered LEAVE tab. No self-serve — writes only ever come from the dashboard's forms. */
var LeaveApi = {
  list: function (params) {
    const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.team_key === params.team);
    if (params.employee) rows = rows.filter((r) => r.employee_name === params.employee);
    if (params.startDate) rows = rows.filter((r) => toIsoDate_(new Date(r.end_date)) >= params.startDate);
    if (params.endDate) rows = rows.filter((r) => toIsoDate_(new Date(r.start_date)) <= params.endDate);
    return rows.map(stripRowMeta_);
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
      const now = nowIso_();
      const record = Object.assign({}, payload, {
        leave_id: uuid_(),
        status: payload.status || 'Approved',
        created_at: now,
        updated_at: now,
      });
      appendObjectToSheet_(sheet, record);
      return stripRowMeta_(record);
    });
  },

  update: function (id, payload) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.leave_id === id);
      if (!existing) throw new Error(`Leave record not found: ${id}`);
      const record = Object.assign({}, existing, payload, { updated_at: nowIso_() });
      updateSheetRow_(sheet, existing._row, record);
      return stripRowMeta_(record);
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.leave_id === id);
      if (!existing) throw new Error(`Leave record not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { leave_id: id, deleted: true };
    });
  },
};

function stripRowMeta_(obj) {
  const copy = Object.assign({}, obj);
  delete copy._row;
  return copy;
}
