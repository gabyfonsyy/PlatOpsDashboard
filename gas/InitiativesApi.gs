/**
 * Read API for the Jira-pulled initiative tickets, now split across per-team tabs
 * (INITIATIVE_TICKETS_<team>). With a `team` param it reads just that team's tab; otherwise it
 * concatenates every cod-initiative team's tab. Plus a manual `sync` action that triggers
 * syncInitiativeTickets() on demand from the dashboard's "Sync from Jira" button.
 */
var InitiativesApi = {
  list: function (params) {
    const ss = getInitiativesSpreadsheet_();
    const teamKeys = params.team ? [String(params.team)] : COD_INITIATIVE_TEAM_KEYS;

    let rows = [];
    teamKeys.forEach((tk) => {
      const sheet = ss.getSheetByName(initiativeTicketsTabName_(tk));
      if (sheet) rows = rows.concat(sheetToObjects_(sheet));
    });
    if (params.label) {
      rows = rows.filter((r) => String(r.labels || '')
        .split(',').map((s) => s.trim()).indexOf(String(params.label)) !== -1);
    }

    return rows.map((r) => {
      const o = stripRowMeta_(r);
      // Sheets round-trips date-ish cells as Date objects; normalize to plain Manila dates.
      o.created = toDisplayDate_(o.created);
      o.updated = toDisplayDate_(o.updated);
      o.duedate = toDisplayDate_(o.duedate);
      o.resolved_datetime = toDisplayDate_(o.resolved_datetime);
      return o;
    });
  },

  sync: function () {
    return withLock_(function () { return syncInitiativeTickets(); });
  },
};
