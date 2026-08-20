/**
 * Installs the recurring time-driven triggers. Idempotent — clears any existing
 * triggers for these functions first, so re-running never creates duplicates.
 * Run manually from the Apps Script editor once, after Milestones 1-5 are all deployed
 * and at least one backfill (Backfill.gs) has completed for every active team.
 */

function installTriggers() {
  // generateInsightsAllTeams is in the DELETE list but never re-created below — see the note at
  // the bottom of this function. Listing it here means re-running installTriggers actively removes
  // a previously-installed AI trigger rather than leaving it running.
  ['syncAllTeams', 'aggregateAllTeams', 'generateInsightsAllTeams', 'syncInitiativeTickets', 'syncIncidentTickets']
    .forEach(deleteTriggersFor_);

  ScriptApp.newTrigger('syncAllTeams').timeBased().everyHours(2).create();

  // Pull cod-initiative tickets (DE/DEV) every 4h — independent of the metrics sync.
  ScriptApp.newTrigger('syncInitiativeTickets').timeBased().everyHours(4).create();

  // Pull tickets the manager tagged with Report Tagging (customfield_10262) into the incident
  // list. Daily, not hourly: that tag is set by hand hours or days after the ticket closes, so a
  // tighter loop would just re-run the same JQL against an unchanged result set.
  ScriptApp.newTrigger('syncIncidentTickets').timeBased().everyDays(1).atHour(7).nearMinute(0).create();

  // A short gap before installing the aggregation trigger so it tends to fire a couple
  // minutes after sync, not concurrently — not required for correctness (aggregation is
  // idempotent and only processes whatever dirty dates exist), just nicer latency.
  Utilities.sleep(2 * 60 * 1000);
  ScriptApp.newTrigger('aggregateAllTeams').timeBased().everyHours(2).create();

  // NO AI TRIGGER. generateInsightsAllTeams is deliberately NOT scheduled.
  //
  // It used to run daily at 06:00, which cost 4 Groq calls every day (3 teams + rollup) whether
  // anyone opened the dashboard or not — roughly 1,460 requests a year to generate paragraphs that
  // often went unread. On a free tier that is the entire budget spent on nobody's behalf.
  //
  // Insights are now generated ON REQUEST only, from the 'generate-insight' route, and served from
  // INSIGHTS_CACHE on every page load after that. A page view costs zero AI requests.
  //
  // If you ever do want it scheduled, call generateInsightsAllTeams() from a trigger you add by
  // hand — it still works, and its source-version check means a run with unchanged metrics skips
  // the model call anyway.
  Logger.log('Triggers installed: syncAllTeams (2h), syncInitiativeTickets (4h), syncIncidentTickets (daily ~7am), aggregateAllTeams (2h, staggered). No AI trigger — insights are generated on request.');
}

function deleteTriggersFor_(functionName) {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === functionName)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Removes any lingering AI trigger. Kept as a one-liner for an install that predates the
 * no-scheduled-AI policy above: installTriggers already deletes it, but this makes it possible to
 * stop unattended AI spend without touching the sync/aggregation schedule at the same time.
 */
function pauseInsightsTrigger() {
  deleteTriggersFor_('generateInsightsAllTeams');
  Logger.log('generateInsightsAllTeams trigger removed. Insights are generated on request only.');
}
