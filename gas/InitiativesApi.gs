/**
 * Manual Jira pull trigger for the initiative-ticket sync. Used to also have a `list` action
 * reading the per-team INITIATIVE_TICKETS_<team> Sheets tabs — removed 2026-09-22 once Records ->
 * Project Tracking moved onto Supabase (src/lib/project-tracking-store.ts's getInitiativeTickets
 * reads the initiative_tickets table directly now, no GAS round-trip needed for reads). `sync` is
 * still needed: GAS is the only thing in this app that talks to Jira.
 */
var InitiativesApi = {
  sync: function () {
    return withLock_(function () { return syncInitiativeTickets(); });
  },
};
