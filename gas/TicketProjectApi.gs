/**
 * Manual ticket→project assignments (TICKET_PROJECT_MAP tab). A ticket belongs to at most one
 * project; a manual assignment here overrides label-based matching in the frontend. Kept in its
 * own tab so the Jira re-sync (which upserts INITIATIVE_TICKETS by issue_key) never touches it.
 */
var TicketProjectApi = {
  list: function () {
    const sheet = getInitiativesSpreadsheet_().getSheetByName('TICKET_PROJECT_MAP');
    if (!sheet) return [];
    return sheetToObjects_(sheet).map(stripRowMeta_);
  },

  /**
   * Bulk assign: payload { issue_keys: [...], project_id }. One row per key, overwriting any
   * existing row for that key (enforces one project per ticket). An empty/blank project_id
   * UNASSIGNS — the map rows for those keys are removed.
   */
  assign: function (payload) {
    return withLock_(function () {
      const sheet = getInitiativesSpreadsheet_().getSheetByName('TICKET_PROJECT_MAP');
      if (!sheet) throw new Error('TICKET_PROJECT_MAP tab not found — run setupInitiatives.');

      const keys = (payload && payload.issue_keys) || [];
      const projectId = payload && payload.project_id ? String(payload.project_id) : '';
      const assignedBy = (payload && payload.assigned_by) || '';
      if (!keys.length) return { assigned: 0, unassigned: 0 };

      const keySet = {};
      keys.forEach((k) => { keySet[String(k)] = true; });

      // Delete existing rows for these keys first (bottom-up so row indices stay valid).
      const rows = sheetToObjects_(sheet);
      rows.filter((r) => keySet[String(r.issue_key)])
        .sort((a, b) => b._row - a._row)
        .forEach((r) => deleteSheetRow_(sheet, r._row));

      if (!projectId) return { assigned: 0, unassigned: keys.length };

      const now = nowIso_();
      keys.forEach((k) => {
        appendObjectToSheet_(sheet, {
          issue_key: String(k),
          project_id: projectId,
          assigned_by: assignedBy,
          assigned_at: now,
        });
      });
      return { assigned: keys.length, unassigned: 0 };
    });
  },
};
