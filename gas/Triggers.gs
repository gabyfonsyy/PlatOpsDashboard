/**
 * Installs the recurring time-driven triggers. Idempotent — clears any existing
 * triggers for these functions first, so re-running never creates duplicates.
 * Run manually from the Apps Script editor once, after Milestones 1-5 are all deployed
 * and at least one backfill (Backfill.gs) has completed for every active team.
 */

function installTriggers() {
  ['syncAllTeams', 'aggregateAllTeams', 'generateInsightsAllTeams'].forEach(deleteTriggersFor_);

  ScriptApp.newTrigger('syncAllTeams').timeBased().everyHours(2).create();

  // A short gap before installing the aggregation trigger so it tends to fire a couple
  // minutes after sync, not concurrently — not required for correctness (aggregation is
  // idempotent and only processes whatever dirty dates exist), just nicer latency.
  Utilities.sleep(2 * 60 * 1000);
  ScriptApp.newTrigger('aggregateAllTeams').timeBased().everyHours(2).create();

  ScriptApp.newTrigger('generateInsightsAllTeams').timeBased().everyDays(1).atHour(6).nearMinute(0).create();

  Logger.log('Triggers installed: syncAllTeams (2h), aggregateAllTeams (2h, staggered), generateInsightsAllTeams (daily ~6am Asia/Manila).');
}

function deleteTriggersFor_(functionName) {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === functionName)
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
