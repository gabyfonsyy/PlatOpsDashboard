/**
 * Installs the recurring time-driven triggers. Idempotent — clears any existing
 * triggers for these functions first, so re-running never creates duplicates.
 * Run manually from the Apps Script editor once, after Milestones 1-5 are all deployed
 * and at least one backfill (Backfill.gs) has completed for every active team.
 */

function installTriggers() {
  ['syncAllTeams', 'aggregateAllTeams', 'generateInsightsAllTeams', 'syncInitiativeTickets'].forEach(deleteTriggersFor_);

  ScriptApp.newTrigger('syncAllTeams').timeBased().everyHours(2).create();

  // Pull cod-initiative tickets (DE/DEV) every 4h — independent of the metrics sync.
  ScriptApp.newTrigger('syncInitiativeTickets').timeBased().everyHours(4).create();

  // A short gap before installing the aggregation trigger so it tends to fire a couple
  // minutes after sync, not concurrently — not required for correctness (aggregation is
  // idempotent and only processes whatever dirty dates exist), just nicer latency.
  Utilities.sleep(2 * 60 * 1000);
  ScriptApp.newTrigger('aggregateAllTeams').timeBased().everyHours(2).create();

  ScriptApp.newTrigger('generateInsightsAllTeams').timeBased().everyDays(1).atHour(6).nearMinute(0).create();

  Logger.log('Triggers installed: syncAllTeams (2h), syncInitiativeTickets (4h), aggregateAllTeams (2h, staggered), generateInsightsAllTeams (daily ~6am Asia/Manila).');
}

function deleteTriggersFor_(functionName) {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === functionName)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Stops the daily Gemini insights trigger without touching sync/aggregation — useful when the
 * Gemini free-tier quota is exhausted and it's just generating failed-run noise (alert emails,
 * wasted Executions) while you're focused on something else. Nothing else depends on this trigger
 * firing: MetricsApi.gs's getCachedInsight_ only ever reads whatever's already in INSIGHTS_CACHE
 * and the frontend already handles a missing/stale cached insight gracefully, so pausing this is
 * safe and fully reversible — run installTriggers again (or just re-add this one trigger) once
 * the quota resets.
 */
function pauseInsightsTrigger() {
  deleteTriggersFor_('generateInsightsAllTeams');
  Logger.log('generateInsightsAllTeams trigger removed — Gemini insights paused. Re-run installTriggers to resume.');
}
