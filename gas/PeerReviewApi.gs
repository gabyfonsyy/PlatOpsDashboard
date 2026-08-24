/**
 * "For Peer Review" wait-time monitoring (ST team). Reads peer_review_cycles_json off
 * RAW_ST_<year> rows (populated at sync time by extractPeerReviewCyclesWithReviewer_ in
 * JiraSync.gs) and rolls completed cycles up by reviewer for the requested period.
 * Cycles are bucketed by when they STARTED (enteredAt), not the ticket's creation date,
 * since a review can start well after the ticket itself was created.
 *
 * Attribution is `reviewerAtEntry` ONLY, never `reviewer`, with no fallback — kept in step with
 * src/lib/peer-review.ts (the live path) and with the Incident Logs validator
 * (buildIncidentValidatorIndex_ in IncidentsApi.gs). See the long note on
 * extractPeerReviewCyclesWithReviewer_ in JiraSync.gs for why the two snapshots differ; in short
 * `reviewer` is the assignee at cycle CLOSE, usually whoever took the ticket at the next stage.
 * A row synced before that field existed reports '(unassigned)' rather than silently naming the
 * wrong person — run runStPeerReviewRebackfill (Backfill.gs) to re-derive the history.
 */
function getPeerReviewWaitReport_(params) {
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);
  const rows = getRawRowsForYears_('ST', startDate, endDate);

  const byReviewer = {};
  const cycles = [];
  const inReview = [];

  rows.forEach((r) => {
    if (!r.peer_review_cycles_json) return;
    let parsedCycles;
    try {
      parsedCycles = JSON.parse(r.peer_review_cycles_json);
    } catch (e) {
      return;
    }

    parsedCycles.forEach((c) => {
      if (!c.enteredAt) return;
      const enteredDate = toIsoDate_(new Date(c.enteredAt));
      if (enteredDate < startDate || enteredDate > endDate) return;

      if (!c.exitedAt) {
        inReview.push({ issueKey: r.issue_key, reviewer: c.reviewerAtEntry || '', enteredAt: c.enteredAt });
        return;
      }

      // Business rule only cares about exits to On Hold / For Checking — cycles that exit
      // some other way (e.g. cancelled) are still recorded by the extractor but excluded here
      // rather than dropped at extraction time, so no data is silently lost upstream.
      const exitedToStatus = (c.exitedToStatus || '').toLowerCase();
      if (exitedToStatus !== 'on hold' && exitedToStatus !== 'for checking') return;

      const waitMinutes = round2_((new Date(c.exitedAt) - new Date(c.enteredAt)) / 60000);
      const reviewer = c.reviewerAtEntry || '(unassigned)';

      cycles.push({
        issueKey: r.issue_key,
        reviewer: reviewer,
        enteredAt: c.enteredAt,
        exitedAt: c.exitedAt,
        exitedToStatus: c.exitedToStatus,
        waitMinutes: waitMinutes,
      });

      if (!byReviewer[reviewer]) {
        byReviewer[reviewer] = { reviewerName: reviewer, cycleCount: 0, sumWaitMinutes: 0, maxWaitMinutes: 0 };
      }
      const b = byReviewer[reviewer];
      b.cycleCount++;
      b.sumWaitMinutes += waitMinutes;
      b.maxWaitMinutes = Math.max(b.maxWaitMinutes, waitMinutes);
    });
  });

  const byReviewerList = Object.keys(byReviewer)
    .map((k) => {
      const b = byReviewer[k];
      return {
        reviewerName: b.reviewerName,
        cycleCount: b.cycleCount,
        avgWaitMinutes: round2_(b.sumWaitMinutes / b.cycleCount),
        maxWaitMinutes: b.maxWaitMinutes,
      };
    })
    .sort((a, b) => b.avgWaitMinutes - a.avgWaitMinutes);

  return {
    team: 'ST',
    range: params.range,
    period: params.period,
    byReviewer: byReviewerList,
    cycles: cycles,
    inReview: inReview,
  };
}
