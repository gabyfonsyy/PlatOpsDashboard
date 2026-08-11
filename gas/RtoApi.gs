/** CRUD for the manager-entered RTO attendance log, plus a computed per-employee compliance summary. */
var RtoApi = {
  list: function (params) {
    const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.team_key === params.team);
    if (params.employee) rows = rows.filter((r) => r.employee_name === params.employee);
    if (params.startDate) rows = rows.filter((r) => toIsoDate_(new Date(r.date)) >= params.startDate);
    if (params.endDate) rows = rows.filter((r) => toIsoDate_(new Date(r.date)) <= params.endDate);
    rows = rows.map(stripRowMeta_).map((r) => {
      r.date = toDisplayDate_(r.date);
      return r;
    });

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

  /**
   * Logs a whole team's attendance for one date in a single call — the "take attendance" grid
   * on the RTO page submits every roster member's pick here at once instead of one manager
   * click-through per person. Upserts by (employee_name, date): re-submitting the same day
   * (e.g. fixing a mistake) updates the existing rows instead of appending duplicates.
   * payload: { date, entries: [{ employee_name, team_key, attendance_type, notes? }], created_by }
   */
  bulkUpsert: function (payload) {
    return withLock_(function () {
      const sheet = getManagerDataSpreadsheet_().getSheetByName('RTO');
      const rows = sheetToObjects_(sheet);
      const now = nowIso_();
      const date = payload.date;

      const results = (payload.entries || []).map((entry) => {
        const existing = rows.find((r) =>
          r.employee_name === entry.employee_name && toIsoDate_(new Date(r.date)) === date);
        const record = Object.assign(
          {
            employee_name: entry.employee_name,
            team_key: entry.team_key,
            date: date,
            attendance_type: entry.attendance_type,
            notes: entry.notes || '',
            created_by: payload.created_by || '',
          },
          existing ? { rto_id: existing.rto_id, created_at: existing.created_at } : { rto_id: uuid_(), created_at: now },
          { updated_at: now }
        );
        if (existing) {
          updateSheetRow_(sheet, existing._row, record);
        } else {
          appendObjectToSheet_(sheet, record);
        }
        const o = stripRowMeta_(record);
        o.date = toDisplayDate_(o.date);
        return o;
      });

      return { date: date, count: results.length, records: results };
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
