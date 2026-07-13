/** CRUD for the manager-entered LEAVE tab. No self-serve — writes only ever come from the dashboard's forms. */
var LeaveApi = {
  list: function (params) {
    const sheet = getManagerDataSpreadsheet_().getSheetByName('LEAVE');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.team_key === params.team);
    if (params.employee) rows = rows.filter((r) => r.employee_name === params.employee);
    if (params.startDate) rows = rows.filter((r) => toIsoDate_(new Date(r.end_date)) >= params.startDate);
    if (params.endDate) rows = rows.filter((r) => toIsoDate_(new Date(r.start_date)) <= params.endDate);
    rows = rows
      .map(stripRowMeta_)
      .map((r) => {
        r.start_date = toDisplayDate_(r.start_date);
        r.end_date = toDisplayDate_(r.end_date);
        return r;
      })
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
    return { records: rows, stats: computeLeaveStats_(rows) };
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

/**
 * Aggregates a set of leave records (already team/date filtered) into headline totals
 * plus by-type and by-employee breakdowns, for the Leave Tracker stats panel.
 */
function computeLeaveStats_(records) {
  const byType = {};
  const byEmployee = {};
  const employees = {};
  let totalDays = 0;
  let halfDayCount = 0;

  records.forEach((r) => {
    const days = Number(r.num_days) || 0;
    totalDays += days;
    if (String(r.half_day_period || '').trim() !== '') halfDayCount += 1;

    const type = String(r.leave_type || 'Other').trim() || 'Other';
    if (!byType[type]) byType[type] = { type: type, count: 0, days: 0 };
    byType[type].count += 1;
    byType[type].days += days;

    const name = String(r.employee_name || '').trim();
    if (name) {
      employees[name] = true;
      if (!byEmployee[name]) byEmployee[name] = { employee: name, count: 0, days: 0 };
      byEmployee[name].count += 1;
      byEmployee[name].days += days;
    }
  });

  const round = function (b) { return Object.assign(b, { days: round2_(b.days) }); };

  return {
    totalRecords: records.length,
    totalDays: round2_(totalDays),
    employeesOnLeave: Object.keys(employees).length,
    halfDayCount: halfDayCount,
    byType: Object.values(byType).map(round).sort((a, b) => b.days - a.days),
    byEmployee: Object.values(byEmployee).map(round).sort((a, b) => b.days - a.days),
  };
}

function stripRowMeta_(obj) {
  const copy = Object.assign({}, obj);
  delete copy._row;
  return copy;
}
