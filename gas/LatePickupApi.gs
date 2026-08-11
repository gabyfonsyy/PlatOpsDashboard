/**
 * Late-pickup / 2-day-SLA monitoring for Account Creation tickets (ST team, SE-owned).
 * Reads RAW_ST_<year> directly rather than a precomputed METRICS_* table — Account
 * Creation is a modest subset of ST's volume, sheetToObjectsCached_ already makes a raw
 * read cheap, and the drill-down-to-ticket requirement rules out a rolled-up aggregation
 * table anyway (period buckets would lose per-ticket identity).
 *
 * Day-1 ownership rule (Manila time): created before 11:00 AM on a business day -> Day 1
 * is that same day. Created at/after 11:00 AM, or on a weekend -> Day 1 is the next
 * business day. "Picked up" = first_out_of_backlog_todo (already synced for every ticket
 * via extractCycleTimeStart_ in JiraSync.gs — no new sync work needed for this report).
 * 2-day SLA deadline = end of Day 2 (the next business day after Day 1).
 *
 * Tickets with no pickup timestamp yet are never historically bucketed by period — their
 * lateness would otherwise silently change every time the page is re-viewed. They only ever
 * appear in the always-live `atRisk` list (independent of the requested period) once Day 1 has
 * already passed — bounded to a recent lookback window (ATRISK_LOOKBACK_DAYS), not scanned across
 * every year of ST history: a 2-day-SLA "not yet picked up" ticket is inherently a near-term
 * concern, so there's no reason to re-read years of raw rows on every page load to find it.
 */
const ATRISK_LOOKBACK_DAYS = 30;

function getLatePickupReport_(params) {
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);
  const now = new Date();

  const periodRows = getRawRowsForYears_('ST', startDate, endDate).filter((r) => {
    if (r.issue_type !== 'Account Creation' || !r.created) return false;
    const createdDate = toIsoDate_(new Date(r.created));
    return createdDate >= startDate && createdDate <= endDate;
  });

  const bySe = {};
  const tickets = [];

  periodRows.forEach((r) => {
    const created = new Date(r.created);
    const pickedUpAt = r.first_out_of_backlog_todo ? new Date(r.first_out_of_backlog_todo) : null;
    if (!pickedUpAt) return;

    const day1Date = computeDay1Date_(created);
    const day1End = endOfManilaDay_(day1Date);
    const day2End = endOfManilaDay_(nextBusinessDay_(day1Date));

    const seName = r.assigned_se || '(unassigned)';
    const isLate = pickedUpAt > day1End;
    const isOverdue = r.resolved_datetime ? new Date(r.resolved_datetime) > day2End : now > day2End;

    tickets.push({
      issueKey: r.issue_key,
      seName: seName,
      created: r.created,
      day1End: day1End.toISOString(),
      day2End: day2End.toISOString(),
      pickedUpAt: pickedUpAt.toISOString(),
      isLate: isLate,
      isOverdue: isOverdue,
      resolvedDatetime: r.resolved_datetime || null,
    });

    if (isLate) {
      if (!bySe[seName]) bySe[seName] = { seName: seName, lateCount: 0, lateAndOverdueCount: 0 };
      bySe[seName].lateCount++;
      if (isOverdue) bySe[seName].lateAndOverdueCount++;
    }
  });

  const atRiskWindowStart = toIsoDate_(new Date(now.getTime() - ATRISK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const atRisk = getRawRowsForYears_('ST', atRiskWindowStart, toIsoDate_(now))
    .filter((r) => {
      if (r.issue_type !== 'Account Creation' || !r.created || r.first_out_of_backlog_todo) return false;
      return toIsoDate_(new Date(r.created)) >= atRiskWindowStart;
    })
    .map((r) => {
      const day1End = endOfManilaDay_(computeDay1Date_(new Date(r.created)));
      return { issueKey: r.issue_key, seName: r.assigned_se || '(unassigned)', created: r.created, day1End: day1End };
    })
    .filter((t) => now > t.day1End)
    .map((t) => ({ issueKey: t.issueKey, seName: t.seName, created: t.created, day1End: t.day1End.toISOString() }));

  return {
    team: 'ST',
    range: params.range,
    period: params.period,
    issueType: 'Account Creation',
    bySe: Object.keys(bySe).map((k) => bySe[k]).sort((a, b) => b.lateCount - a.lateCount),
    tickets: tickets,
    atRisk: atRisk,
  };
}

/** Manila calendar date a ticket becomes "Day 1 owned" per the 11 AM / weekend rule. */
function computeDay1Date_(created) {
  const dateOnly = manilaDateOnly_(created);
  return (manilaHour_(created) < 11 && !isWeekend_(created)) ? dateOnly : nextBusinessDay_(dateOnly);
}
