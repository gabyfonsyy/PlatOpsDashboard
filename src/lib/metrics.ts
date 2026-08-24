import { fetchGas } from "@/lib/gas-client";
import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, isExcludedFromBacklogAging } from "@/lib/teams";
import { resolvePeriodToDateRange, monthsInRange } from "@/lib/period-range";
import { getCompletedPeerReviewCycles, aggregateByReviewer } from "@/lib/peer-review";
import { getLeadCycleTimeAverages } from "@/lib/lead-cycle-time";

export type TicketMetrics = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  leadTimeAvgMinutes: number | null;
  cycleTimeAvgMinutes: number | null;
  fcrRate: number | null;
  escalationRate: number | null;
  backlogAgingRate: number | null;
  overdueCount: number;
  /**
   * Denominator behind backlogAgingRate — resolved-in-period MINUS the issue types excluded by
   * isExcludedFromBacklogAging. Differs from ticketsResolvedInPeriod, and the card must print
   * THIS one, or "N of M resolved overdue" would not divide out to the rate shown above it.
   */
  backlogAgingDenominator: number;
  fcrYesCount: number;
  escalationCount: number;
  ticketVolume: number;
  ticketsCreated: number;
  ticketsResolved: number;
  ticketsResolvedInPeriod: number;
  holdingReasonBreakdown: { reason: string; count: number }[];
  rejectionCategoryBreakdown: { category: string; count: number }[];
  cancellationReasonBreakdown: { reason: string; count: number }[];
  onHoldAvgPickupMinutes: number | null;
  peerReviewWaitAvgMinutes: number | null;
  series: { date: string; created: number; resolved: number; leadTimeAvgMinutes: number | null }[];
};

export type AssigneeMetric = {
  name: string;
  ticketsAssigned: number;
  ticketsResolved: number;
  ticketsResolvedInPeriod: number;
  escalationRate: number | null;
  fcrRate: number | null;
  fcrYesCount: number;
  escalationCount: number;
  backlogAgingRate: number | null;
  avgLeadTimeMinutes: number | null;
  avgCycleTimeMinutes: number | null;
  /** Attributed to the reviewer, not the ticket owner — reflects this person's own review throughput. ST only. */
  avgReviewWaitMinutes: number | null;
  flags: string[];
};

export type InsightFlag = { employee: string; metric: string; severity: string; detail: string; code?: string };

export type CachedInsight = {
  scope: string;
  period: string;
  narrative: string;
  flags: InsightFlag[];
  generatedAt: string;
  status: "SUCCESS" | "FAILED";
} | null;

const EMPTY_METRICS: TicketMetrics = {
  team: "", range: "month", period: "", issueType: null,
  leadTimeAvgMinutes: null, cycleTimeAvgMinutes: null, fcrRate: null,
  escalationRate: null, backlogAgingRate: null, overdueCount: 0, backlogAgingDenominator: 0,
  fcrYesCount: 0, escalationCount: 0,
  ticketVolume: 0,
  ticketsCreated: 0, ticketsResolved: 0, ticketsResolvedInPeriod: 0, holdingReasonBreakdown: [],
  rejectionCategoryBreakdown: [], cancellationReasonBreakdown: [],
  onHoldAvgPickupMinutes: null, peerReviewWaitAvgMinutes: null, series: [],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function mergeJsonCounts(target: Record<string, number>, obj: Record<string, number> | null | undefined) {
  if (!obj) return;
  for (const key of Object.keys(obj)) target[key] = (target[key] || 0) + (Number(obj[key]) || 0);
}

function countsToBreakdown<K extends string>(counts: Record<string, number>, keyName: K) {
  return Object.entries(counts)
    .map(([k, count]) => ({ [keyName]: k, count }) as Record<K, string> & { count: number })
    .sort((a, b) => b.count - a.count);
}

type MetricsDailyRow = {
  date: string;
  issue_type: string | null;
  tickets_created_count: number;
  tickets_resolved_count: number;
  tickets_resolved_on_date: number;
  overdue_resolved_on_date: number;
  fcr_yes_resolved_on_date: number;
  escalation_qualifying_resolved_on_date: number;
  lead_time_sum_minutes: number;
  lead_time_count: number;
  cycle_time_sum_minutes: number;
  cycle_time_count: number;
  fcr_eligible_count: number;
  fcr_not_escalated_count: number;
  escalated_count: number;
  resolved_after_due_count: number;
  total_for_aging_denominator: number;
  assigned_count: number;
  holding_reason_json: Record<string, number> | null;
  rejection_category_json: Record<string, number> | null;
  cancellation_reason_json: Record<string, number> | null;
  on_hold_pickup_sum_minutes: number;
  on_hold_pickup_count: number;
  peer_review_wait_sum_minutes: number;
  peer_review_wait_count: number;
};

async function fetchMetricsDailyRows(
  teamKeys: string[],
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<MetricsDailyRow[]> {
  return fetchAllRows<MetricsDailyRow>((from, to) => {
    let query = getSupabaseClient()
      .from("metrics_daily")
      .select("*")
      .in("team_key", teamKeys)
      .gte("date", startDate)
      .lte("date", endDate);
    if (issueType) query = query.eq("issue_type", issueType);
    return query.range(from, to);
  });
}

/**
 * Daily points for week/month; rolled up to monthly for quarter/year so the axis stays
 * readable. Ported from gas/MetricsApi.gs's buildSeries_.
 */
function buildSeries(
  byDate: Record<string, { created: number; resolved: number; leadTimeSum: number; leadTimeCount: number }>,
  monthly: boolean
) {
  if (!monthly) {
    return Object.keys(byDate).sort().map((d) => ({
      date: d,
      created: byDate[d].created,
      resolved: byDate[d].resolved,
      leadTimeAvgMinutes: byDate[d].leadTimeCount ? round2(byDate[d].leadTimeSum / byDate[d].leadTimeCount) : null,
    }));
  }
  const byMonth: Record<string, { created: number; resolved: number; leadTimeSum: number; leadTimeCount: number }> = {};
  for (const d of Object.keys(byDate)) {
    const m = d.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { created: 0, resolved: 0, leadTimeSum: 0, leadTimeCount: 0 };
    byMonth[m].created += byDate[d].created;
    byMonth[m].resolved += byDate[d].resolved;
    byMonth[m].leadTimeSum += byDate[d].leadTimeSum;
    byMonth[m].leadTimeCount += byDate[d].leadTimeCount;
  }
  return Object.keys(byMonth).sort().map((m) => ({
    date: m,
    created: byMonth[m].created,
    resolved: byMonth[m].resolved,
    leadTimeAvgMinutes: byMonth[m].leadTimeCount ? round2(byMonth[m].leadTimeSum / byMonth[m].leadTimeCount) : null,
  }));
}

/** Ported from gas/MetricsApi.gs's rollupDailyRows_. */
function rollupDailyRows(
  rows: MetricsDailyRow[],
  team: string,
  range: string,
  period: string,
  issueType: string | undefined
): TicketMetrics {
  const totals = {
    ticketsCreated: 0, ticketsResolved: 0, resolvedInPeriod: 0, overdueResolved: 0,
    leadTimeSum: 0, leadTimeCount: 0,
    cycleTimeSum: 0, cycleTimeCount: 0,
    fcrEligible: 0, fcrNotEscalated: 0, escalated: 0,
    fcrYesResolved: 0, escQualifyingResolved: 0,
    resolvedAfterDue: 0, totalForAging: 0,
    agingOverdue: 0, agingDenominator: 0,
    assigned: 0,
    onHoldPickupSum: 0, onHoldPickupCount: 0,
    peerReviewWaitSum: 0, peerReviewWaitCount: 0,
  };
  const holdingReasonTotals: Record<string, number> = {};
  const rejectionCategoryTotals: Record<string, number> = {};
  const cancellationReasonTotals: Record<string, number> = {};
  const byDate: Record<string, { created: number; resolved: number; leadTimeSum: number; leadTimeCount: number }> = {};

  for (const r of rows) {
    totals.ticketsCreated += Number(r.tickets_created_count) || 0;
    totals.ticketsResolved += Number(r.tickets_resolved_count) || 0;
    totals.resolvedInPeriod += Number(r.tickets_resolved_on_date) || 0;
    totals.overdueResolved += Number(r.overdue_resolved_on_date) || 0;
    totals.leadTimeSum += Number(r.lead_time_sum_minutes) || 0;
    totals.leadTimeCount += Number(r.lead_time_count) || 0;
    totals.cycleTimeSum += Number(r.cycle_time_sum_minutes) || 0;
    totals.cycleTimeCount += Number(r.cycle_time_count) || 0;
    totals.fcrEligible += Number(r.fcr_eligible_count) || 0;
    totals.fcrNotEscalated += Number(r.fcr_not_escalated_count) || 0;
    totals.escalated += Number(r.escalated_count) || 0;
    totals.fcrYesResolved += Number(r.fcr_yes_resolved_on_date) || 0;
    totals.escQualifyingResolved += Number(r.escalation_qualifying_resolved_on_date) || 0;
    totals.resolvedAfterDue += Number(r.resolved_after_due_count) || 0;
    totals.totalForAging += Number(r.total_for_aging_denominator) || 0;
    totals.assigned += Number(r.assigned_count) || 0;
    totals.onHoldPickupSum += Number(r.on_hold_pickup_sum_minutes) || 0;
    totals.onHoldPickupCount += Number(r.on_hold_pickup_count) || 0;
    totals.peerReviewWaitSum += Number(r.peer_review_wait_sum_minutes) || 0;
    totals.peerReviewWaitCount += Number(r.peer_review_wait_count) || 0;

    // Backlog Aging alone runs on a narrowed population — metrics_daily is stored per issue type,
    // so the exclusion is a skip here rather than a re-aggregation in GAS. Numerator and
    // denominator must skip together or the rate silently inflates.
    if (!isExcludedFromBacklogAging(r.issue_type)) {
      totals.agingOverdue += Number(r.overdue_resolved_on_date) || 0;
      totals.agingDenominator += Number(r.tickets_resolved_on_date) || 0;
    }

    mergeJsonCounts(holdingReasonTotals, r.holding_reason_json);
    mergeJsonCounts(rejectionCategoryTotals, r.rejection_category_json);
    mergeJsonCounts(cancellationReasonTotals, r.cancellation_reason_json);

    const d = r.date;
    if (!byDate[d]) byDate[d] = { created: 0, resolved: 0, leadTimeSum: 0, leadTimeCount: 0 };
    byDate[d].created += Number(r.tickets_created_count) || 0;
    byDate[d].resolved += Number(r.tickets_resolved_on_date) || 0;
    byDate[d].leadTimeSum += Number(r.lead_time_sum_minutes) || 0;
    byDate[d].leadTimeCount += Number(r.lead_time_count) || 0;
  }

  const series = buildSeries(byDate, range === "year" || range === "quarter");

  return {
    team, range, period, issueType: issueType ?? null,
    // Both are OVERWRITTEN by getTicketMetrics with the live, end-date-bucketed figures — kept
    // here only so this function stays a complete rollup of what metrics_daily actually holds.
    leadTimeAvgMinutes: totals.leadTimeCount ? round2(totals.leadTimeSum / totals.leadTimeCount) : null,
    cycleTimeAvgMinutes: totals.cycleTimeCount ? round2(totals.cycleTimeSum / totals.cycleTimeCount) : null,
    fcrRate: totals.resolvedInPeriod ? round4(totals.fcrYesResolved / totals.resolvedInPeriod) : null,
    escalationRate: totals.resolvedInPeriod ? round4(totals.escQualifyingResolved / totals.resolvedInPeriod) : null,
    backlogAgingRate: totals.agingDenominator ? round4(totals.agingOverdue / totals.agingDenominator) : null,
    overdueCount: totals.agingOverdue,
    backlogAgingDenominator: totals.agingDenominator,
    fcrYesCount: totals.fcrYesResolved,
    escalationCount: totals.escQualifyingResolved,
    ticketVolume: totals.assigned,
    ticketsCreated: totals.ticketsCreated,
    ticketsResolved: totals.ticketsResolved,
    ticketsResolvedInPeriod: totals.resolvedInPeriod,
    holdingReasonBreakdown: countsToBreakdown(holdingReasonTotals, "reason"),
    rejectionCategoryBreakdown: countsToBreakdown(rejectionCategoryTotals, "category"),
    cancellationReasonBreakdown: countsToBreakdown(cancellationReasonTotals, "reason"),
    onHoldAvgPickupMinutes: totals.onHoldPickupCount ? round2(totals.onHoldPickupSum / totals.onHoldPickupCount) : null,
    peerReviewWaitAvgMinutes: totals.peerReviewWaitCount ? round2(totals.peerReviewWaitSum / totals.peerReviewWaitCount) : null,
    series,
  };
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads metrics_daily directly instead of
 * proxying through the GAS `metrics` route. Falls back to empty metrics on any failure
 * (bad period, Supabase hiccup) rather than throwing — matches the old GAS-backed behavior.
 */
export async function getTicketMetrics(team: string, range: string, period: string, issueType?: string): Promise<TicketMetrics> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamKeys = team === "ALL" ? (await getTeams()).map((t) => t.team_key) : [team];
    const [rows, liveAverages] = await Promise.all([
      fetchMetricsDailyRows(teamKeys, startDate, endDate, issueType),
      getLeadCycleTimeAverages(teamKeys, range, period, issueType),
    ]);

    // Lead and Cycle Time come from `tickets` via the drill-down's own basisFor(), NOT from the
    // metrics_daily averages rollupDailyRows computes — those bucket by created date and read high
    // against the very pages these cards link to. See getLeadCycleTimeAverages for the measured
    // gap. Everything else on the card still comes from the precomputed daily rows.
    return { ...rollupDailyRows(rows, team, range, period, issueType), ...liveAverages };
  } catch {
    return { ...EMPTY_METRICS, team, range, period, issueType: issueType ?? null };
  }
}

type AssigneeMonthlyRow = {
  assignee_display_name: string;
  tickets_assigned: number;
  tickets_resolved: number;
  tickets_resolved_in_month: number;
  overdue_resolved_in_month: number;
  escalated_count: number;
  fcr_eligible_count: number;
  fcr_not_escalated_count: number;
  fcr_yes_resolved_in_month: number;
  escalation_qualifying_resolved_in_month: number;
  resolved_after_due_count: number;
  avg_lead_time_minutes: number | null;
  avg_cycle_time_minutes: number | null;
};

async function fetchAssigneeMonthlyRows(team: string, months: string[]): Promise<AssigneeMonthlyRow[]> {
  return fetchAllRows<AssigneeMonthlyRow>((from, to) =>
    getSupabaseClient()
      .from("metrics_by_assignee_monthly")
      .select("*")
      .eq("team_key", team)
      .in("month", months)
      .range(from, to)
  );
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads metrics_by_assignee_monthly directly
 * instead of proxying through the GAS `assignee-metrics` route. Ported from
 * gas/MetricsApi.gs's getAssigneeMetrics_ — avg_in_progress_minutes is deliberately not
 * carried through here, matching the existing AssigneeMetric contract, which never exposed it.
 */
export async function getAssigneeMetrics(team: string, range: string, period: string): Promise<{ team: string; period: string; assignees: AssigneeMetric[] }> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const months = monthsInRange(startDate, endDate);
    const rows = await fetchAssigneeMonthlyRows(team, months);

    type Acc = {
      name: string; ticketsAssigned: number; ticketsResolved: number; resolvedInPeriod: number;
      overdueInPeriod: number; fcrYesResolved: number; escQualifyingResolved: number;
      leadTimeWeightedSum: number; leadTimeWeight: number; cycleTimeWeightedSum: number; cycleTimeWeight: number;
    };
    const byAssignee: Record<string, Acc> = {};

    for (const r of rows) {
      const name = r.assignee_display_name;
      if (!byAssignee[name]) {
        byAssignee[name] = {
          name, ticketsAssigned: 0, ticketsResolved: 0, resolvedInPeriod: 0, overdueInPeriod: 0,
          fcrYesResolved: 0, escQualifyingResolved: 0,
          leadTimeWeightedSum: 0, leadTimeWeight: 0, cycleTimeWeightedSum: 0, cycleTimeWeight: 0,
        };
      }
      const b = byAssignee[name];
      b.ticketsAssigned += Number(r.tickets_assigned) || 0;
      b.ticketsResolved += Number(r.tickets_resolved) || 0;
      b.resolvedInPeriod += Number(r.tickets_resolved_in_month) || 0;
      b.overdueInPeriod += Number(r.overdue_resolved_in_month) || 0;
      b.fcrYesResolved += Number(r.fcr_yes_resolved_in_month) || 0;
      b.escQualifyingResolved += Number(r.escalation_qualifying_resolved_in_month) || 0;
      if (r.avg_lead_time_minutes) {
        b.leadTimeWeightedSum += Number(r.avg_lead_time_minutes) * (Number(r.tickets_resolved) || 0);
        b.leadTimeWeight += Number(r.tickets_resolved) || 0;
      }
      if (r.avg_cycle_time_minutes) {
        b.cycleTimeWeightedSum += Number(r.avg_cycle_time_minutes) * (Number(r.tickets_resolved) || 0);
        b.cycleTimeWeight += Number(r.tickets_resolved) || 0;
      }
    }

    // Attributed to the REVIEWER, not the ticket owner (they're often different people) — see
    // lib/peer-review.ts. A person who only reviews and owns no tickets this period wouldn't
    // otherwise have a row at all, so union them in with zeroed ticket stats rather than
    // silently dropping their review-wait number (same reasoning as gas/Aggregation.gs's
    // resolved-in-month union: "assignees who resolved tickets... even if none were
    // created-assigned to them this month").
    const reviewWaitByReviewer: Record<string, number> = {};
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (teamConfig?.has_peer_review_tracking) {
      const { cycles } = await getCompletedPeerReviewCycles(range, period);
      for (const r of aggregateByReviewer(cycles)) {
        reviewWaitByReviewer[r.reviewerName] = r.avgWaitMinutes;
        if (!byAssignee[r.reviewerName]) {
          byAssignee[r.reviewerName] = {
            name: r.reviewerName, ticketsAssigned: 0, ticketsResolved: 0, resolvedInPeriod: 0, overdueInPeriod: 0,
            fcrYesResolved: 0, escQualifyingResolved: 0,
            leadTimeWeightedSum: 0, leadTimeWeight: 0, cycleTimeWeightedSum: 0, cycleTimeWeight: 0,
          };
        }
      }
    }

    const assignees: AssigneeMetric[] = Object.values(byAssignee).map((b) => ({
      name: b.name,
      ticketsAssigned: b.ticketsAssigned,
      ticketsResolved: b.ticketsResolved,
      ticketsResolvedInPeriod: b.resolvedInPeriod,
      escalationRate: b.resolvedInPeriod ? round4(b.escQualifyingResolved / b.resolvedInPeriod) : null,
      fcrRate: b.resolvedInPeriod ? round4(b.fcrYesResolved / b.resolvedInPeriod) : null,
      fcrYesCount: b.fcrYesResolved,
      escalationCount: b.escQualifyingResolved,
      backlogAgingRate: b.resolvedInPeriod ? round4(b.overdueInPeriod / b.resolvedInPeriod) : null,
      avgLeadTimeMinutes: b.leadTimeWeight ? round2(b.leadTimeWeightedSum / b.leadTimeWeight) : null,
      avgCycleTimeMinutes: b.cycleTimeWeight ? round2(b.cycleTimeWeightedSum / b.cycleTimeWeight) : null,
      avgReviewWaitMinutes: reviewWaitByReviewer[b.name] ?? null,
      flags: [],
    }));

    return { team, period, assignees };
  } catch {
    return { team, period, assignees: [] };
  }
}

/**
 * Still GAS/Sheets-backed: INSIGHTS_CACHE is out of Phase 3's dual-write scope (only
 * tickets/metrics_daily/metrics_by_assignee_monthly are kept live in Supabase), so reading it
 * from Supabase now would just serve an increasingly stale one-time snapshot.
 */
export async function getInsight(scope: string): Promise<CachedInsight> {
  return fetchGas<CachedInsight>("insight", { scope }, { next: { revalidate: 300 } }).catch(() => null);
}
