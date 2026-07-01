/** CRUD for the manager-entered RTO attendance log, plus a computed per-employee compliance summary. */
var RtoApi = {
  list: function (params) {
    const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.team_key === params.team);
    if (params.employee) rows = rows.filter((r) => r.employee_name === params.employee);
    if (params.startDate) rows = rows.filter((r) => toIsoDate_(new Date(r.date)) >= params.startDate);
    if (params.endDate) rows = rows.filter((r) => toIsoDate_(new Date(r.date)) <= params.endDate);
    rows = rows.map(stripRowMeta_);

    if (params.startDate && params.endDate) {
      return { records: rows, summary: computeRtoSummary_(rows) };
    }
    return { records: rows };
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
      const now = nowIso_();
      const record = Object.assign({}, payload, {
        rto_id: uuid_(),
        created_at: now,
        updated_at: now,
      });
      appendObjectToSheet_(sheet, record);
      return stripRowMeta_(record);
    });
  },

  update: function (id, payload) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.rto_id === id);
      if (!existing) throw new Error(`RTO record not found: ${id}`);
      const record = Object.assign({}, existing, payload, { updated_at: nowIso_() });
      updateSheetRow_(sheet, existing._row, record);
      return stripRowMeta_(record);
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.rto_id === id);
      if (!existing) throw new Error(`RTO record not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { rto_id: id, deleted: true };
    });
  },
};

/** {employee -> {daysInOffice, daysRemote, daysAbsent, totalDays, compliancePct}} */
function computeRtoSummary_(records) {
  const byEmployee = {};
  records.forEach((r) => {
    if (!byEmployee[r.employee_name]) {
      byEmployee[r.employee_name] = { employee: r.employee_name, daysInOffice: 0, daysRemote: 0, daysAbsent: 0, totalDays: 0 };
    }
    const bucket = byEmployee[r.employee_name];
    bucket.totalDays += 1;
    if (r.attendance_type === 'In-Office') bucket.daysInOffice += 1;
    else if (r.attendance_type === 'Remote') bucket.daysRemote += 1;
    else if (r.attendance_type === 'Absent') bucket.daysAbsent += 1;
  });
  return Object.values(byEmployee).map((b) => Object.assign(b, {
    compliancePct: b.totalDays > 0 ? b.daysInOffice / b.totalDays : 0,
  }));
}
