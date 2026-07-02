/**
 * Read-only API layer over METRICS_DAILY / METRICS_BY_ASSIGNEE_MONTHLY / INSIGHTS_CACHE.
 * Rolls precomputed daily buckets up to week/month/quarter/year on request — never
 * scans raw ticket tabs. Period label formats (kept in lockstep with the Next.js
 * lib/date-ranges.ts): week "YYYY-Www", month "YYYY-MM", quarter "YYYY-Qn", year "YYYY".
 */

function getTicketMetrics_(params) {
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);
  const teams = params.team === 'ALL'
    ? getActiveTeamsConfig_()
    : getTeamsConfig_().filter((t) => t.team_key === params.team);

  if (!teams.length) throw new Error(`Unknown team: ${params.team}`);

  const rows = [];
  teams.forEach((team) => {
    rows.push.apply(rows, getMetricsDailyRowsInRange_(team.team_key, startDate, endDate, params.issueType));
  });

  return rollupDailyRows_(rows, params.team, params.range, params.period, params.issueType);
}

function getAssigneeMetrics_(params) {
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);
  const months = monthsInRange_(startDate, endDate);

  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  const rows = sheetToObjects_(sheet).filter((r) =>
    r.team_key === params.team && months.indexOf(String(r.month)) !== -1
  );

  const byAssignee = {};
  rows.forEach((r) => {
    const name = r.assignee_display_name;
    if (!byAssignee[name]) {
      byAssignee[name] = {
        name: name, ticketsAssigned: 0, ticketsResolved: 0, escalated: 0,
        fcrEligible: 0, fcrNotEscalated: 0, resolvedAfterDue: 0,
        leadTimeWeightedSum: 0, leadTimeWeight: 0, cycleTimeWeightedSum: 0, cycleTimeWeight: 0,
      };
    }
    const b = byAssignee[name];
    b.ticketsAssigned += Number(r.tickets_assigned) || 0;
    b.ticketsResolved += Number(r.tickets_resolved) || 0;
    b.escalated += Number(r.escalated_count) || 0;
    b.fcrEligible += Number(r.fcr_eligible_count) || 0;
    b.fcrNotEscalated += Number(r.fcr_not_escalated_count) || 0;
    b.resolvedAfterDue += Number(r.resolved_after_due_count) || 0;
    if (r.avg_lead_time_minutes) {
      b.leadTimeWeightedSum += Number(r.avg_lead_time_minutes) * (Number(r.tickets_resolved) || 0);
      b.leadTimeWeight += Number(r.tickets_resolved) || 0;
    }
    if (r.avg_cycle_time_minutes) {
      b.cycleTimeWeightedSum += Number(r.avg_cycle_time_minutes) * (Number(r.tickets_resolved) || 0);
      b.cycleTimeWeight += Number(r.tickets_resolved) || 0;
    }
  });

  // NOTE: backlogAgingRate here is resolvedAfterDue / ticketsResolved (not a due-date-set
  // denominator like the team-level metric) — METRICS_BY_ASSIGNEE_MONTHLY doesn't carry a
  // separate aging denominator column. Close enough for per-person eval flagging; revisit
  // if the discrepancy from the team-level rate matters in practice.
  const assignees = Object.keys(byAssignee).map((name) => {
    const b = byAssignee[name];
    return {
      name: b.name,
      ticketsAssigned: b.ticketsAssigned,
      ticketsResolved: b.ticketsResolved,
      escalationRate: b.fcrEligible ? round4_(b.escalated / b.fcrEligible) : null,
      fcrRate: b.fcrEligible ? round4_(b.fcrNotEscalated / b.fcrEligible) : null,
      backlogAgingRate: b.ticketsResolved ? round4_(b.resolvedAfterDue / b.ticketsResolved) : null,
      avgLeadTimeMinutes: b.leadTimeWeight ? round2_(b.leadTimeWeightedSum / b.leadTimeWeight) : null,
      avgCycleTimeMinutes: b.cycleTimeWeight ? round2_(b.cycleTimeWeightedSum / b.cycleTimeWeight) : null,
      flags: [], // populated by Insights.gs's detectOutliers_ (Milestone 5)
    };
  });

  return { team: params.team, period: params.period, assignees: assignees };
}

/** Never triggers generation — returns whatever Insights.gs (Milestone 5) last cached, or null before that. */
function getCachedInsight_(scope) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  const rows = sheetToObjects_(sheet).filter((r) => r.scope_key === scope);
  if (!rows.length) return null;

  rows.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));
  const latest = rows[0];
  return {
    scope: latest.scope_key,
    period: latest.period_label,
    narrative: latest.narrative_text,
    flags: latest.flags_json ? JSON.parse(latest.flags_json) : [],
    generatedAt: latest.generated_at,
    status: latest.generation_status,
  };
}

function getMetricsDailyRowsInRange_(teamKey, startDate, endDate, issueType) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY');
  return sheetToObjects_(sheet).filter((r) => {
    if (r.team_key !== teamKey) return false;
    const d = formatDateCell_(r.date);
    if (d < startDate || d > endDate) return false;
    if (issueType && r.issue_type !== issueType) return false;
    return true;
  });
}

function rollupDailyRows_(rows, team, range, period, issueType) {
  const totals = {
    ticketsCreated: 0, ticketsResolved: 0,
    leadTimeSum: 0, leadTimeCount: 0,
    cycleTimeSum: 0, cycleTimeCount: 0,
    fcrEligible: 0, fcrNotEscalated: 0, escalated: 0,
    resolvedAfterDue: 0, totalForAging: 0,
    assigned: 0,
    onHoldPickupSum: 0, onHoldPickupCount: 0,
  };
  const holdingReasonTotals = {};
  const rejectionCategoryTotals = {};
  const cancellationReasonTotals = {};
  const byDate = {};

  rows.forEach((r) => {
    totals.ticketsCreated += Number(r.tickets_created_count) || 0;
    totals.ticketsResolved += Number(r.tickets_resolved_count) || 0;
    totals.leadTimeSum += Number(r.lead_time_sum_minutes) || 0;
    totals.leadTimeCount += Number(r.lead_time_count) || 0;
    totals.cycleTimeSum += Number(r.cycle_time_sum_minutes) || 0;
    totals.cycleTimeCount += Number(r.cycle_time_count) || 0;
    totals.fcrEligible += Number(r.fcr_eligible_count) || 0;
    totals.fcrNotEscalated += Number(r.fcr_not_escalated_count) || 0;
    totals.escalated += Number(r.escalated_count) || 0;
    totals.resolvedAfterDue += Number(r.resolved_after_due_count) || 0;
    totals.totalForAging += Number(r.total_for_aging_denominator) || 0;
    totals.assigned += Number(r.assigned_count) || 0;
    totals.onHoldPickupSum += Number(r.on_hold_pickup_sum_minutes) || 0;
    totals.onHoldPickupCount += Number(r.on_hold_pickup_count) || 0;

    mergeJsonCounts_(holdingReasonTotals, r.holding_reason_json);
    mergeJsonCounts_(rejectionCategoryTotals, r.rejection_category_json);
    mergeJsonCounts_(cancellationReasonTotals, r.cancellation_reason_json);

    const d = formatDateCell_(r.date);
    if (!byDate[d]) byDate[d] = { created: 0, resolved: 0, leadTimeSum: 0, leadTimeCount: 0 };
    byDate[d].created += Number(r.tickets_created_count) || 0;
    byDate[d].resolved += Number(r.tickets_resolved_count) || 0;
    byDate[d].leadTimeSum += Number(r.lead_time_sum_minutes) || 0;
    byDate[d].leadTimeCount += Number(r.lead_time_count) || 0;
  });

  const series = Object.keys(byDate).sort().map((d) => ({
    date: d,
    created: byDate[d].created,
    resolved: byDate[d].resolved,
    leadTimeAvgMinutes: byDate[d].leadTimeCount ? round2_(byDate[d].leadTimeSum / byDate[d].leadTimeCount) : null,
  }));

  return {
    team: team, range: range, period: period, issueType: issueType || null,
    leadTimeAvgMinutes: totals.leadTimeCount ? round2_(totals.leadTimeSum / totals.leadTimeCount) : null,
    cycleTimeAvgMinutes: totals.cycleTimeCount ? round2_(totals.cycleTimeSum / totals.cycleTimeCount) : null,
    fcrRate: totals.fcrEligible ? round4_(totals.fcrNotEscalated / totals.fcrEligible) : null,
    escalationRate: totals.fcrEligible ? round4_(totals.escalated / totals.fcrEligible) : null,
    backlogAgingRate: totals.totalForAging ? round4_(totals.resolvedAfterDue / totals.totalForAging) : null,
    ticketVolume: totals.assigned,
    ticketsCreated: totals.ticketsCreated,
    ticketsResolved: totals.ticketsResolved,
    holdingReasonBreakdown: countsToBreakdown_(holdingReasonTotals, 'reason'),
    rejectionCategoryBreakdown: countsToBreakdown_(rejectionCategoryTotals, 'category'),
    cancellationReasonBreakdown: countsToBreakdown_(cancellationReasonTotals, 'reason'),
    onHoldAvgPickupMinutes: totals.onHoldPickupCount ? round2_(totals.onHoldPickupSum / totals.onHoldPickupCount) : null,
    series: series,
  };
}

function mergeJsonCounts_(target, jsonStr) {
  if (!jsonStr) return;
  let obj;
  try { obj = JSON.parse(jsonStr); } catch (e) { return; }
  Object.keys(obj).forEach((k) => { target[k] = (target[k] || 0) + obj[k]; });
}

function countsToBreakdown_(counts, keyName) {
  return Object.keys(counts)
    .map((k) => { const item = {}; item[keyName] = k; item.count = counts[k]; return item; })
    .sort((a, b) => b.count - a.count);
}

// round2_/round4_ live in Utils.gs — shared with Aggregation.gs.

function resolvePeriodToDateRange_(range, period, startParam, endParam) {
  if (startParam && endParam) return { startDate: startParam, endDate: endParam };

  if (range === 'week') {
    const match = String(period).match(/^(\d{4})-W(\d{2})$/);
    if (!match) throw new Error(`Invalid week period: ${period}`);
    return isoWeekToDateRange_(Number(match[1]), Number(match[2]));
  }

  if (range === 'month') {
    const match = String(period).match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error(`Invalid month period: ${period}`);
    const year = Number(match[1]), month = Number(match[2]);
    return {
      startDate: toIsoDate_(new Date(year, month - 1, 1)),
      endDate: toIsoDate_(new Date(year, month, 0)),
    };
  }

  if (range === 'quarter') {
    const match = String(period).match(/^(\d{4})-Q([1-4])$/);
    if (!match) throw new Error(`Invalid quarter period: ${period}`);
    const year = Number(match[1]), q = Number(match[2]);
    const startMonth = (q - 1) * 3;
    return {
      startDate: toIsoDate_(new Date(year, startMonth, 1)),
      endDate: toIsoDate_(new Date(year, startMonth + 3, 0)),
    };
  }

  if (range === 'year') {
    const year = Number(period);
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }

  throw new Error(`Unsupported range: ${range}`);
}

function isoWeekToDateRange_(year, week) {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7; // Mon=0..Sun=6
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  const start = new Date(week1Monday);
  start.setDate(week1Monday.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startDate: toIsoDate_(start), endDate: toIsoDate_(end) };
}

function monthsInRange_(startDate, endDate) {
  const months = [];
  const cursor = new Date(startDate);
  cursor.setDate(1);
  const end = new Date(endDate);
  while (cursor <= end) {
    const label = monthLabel_(cursor);
    if (months.indexOf(label) === -1) months.push(label);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}
