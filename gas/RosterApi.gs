/**
 * Read-only accessor for the ROSTER tab — the authoritative list of employees per team.
 * Drives the employee dropdowns in the manager-entered forms (Leave, and reusable elsewhere)
 * so names are picked from a controlled list rather than free-typed.
 */
var RosterApi = {
  list: function (params) {
    const sheet = getManagerDataSpreadsheet_().getSheetByName('ROSTER');
    let rows = sheetToObjects_(sheet);
    if (params.team) rows = rows.filter((r) => r.team_key === params.team);
    // Default to active members only; pass includeInactive=true to get everyone.
    if (String(params.includeInactive) !== 'true') {
      rows = rows.filter((r) => String(r.status || '').trim().toLowerCase() !== 'inactive');
    }
    return rows
      .map(stripRowMeta_)
      .sort((a, b) => String(a.employee_name).localeCompare(String(b.employee_name)));
  },
};
