import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, backlogAgingAssignee, backlogAgingAssigneeLabel } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";

export type LeadCycleTimeMetric = "lead" | "cycle";

export type LeadCycleTimeTicket = {
  issueKey: string;
  issueType: string;
  /** The team's configured owner — Assigned COD for DBA/DevOps. */
  assignee: string;
  product: string;
  labels: string;
  minutes: number;
  createdAt: string;
  /** "" for Lead Time (not applicable — Lead Time starts at creation). */
  startedAt: string;
  /** The end of the measured span — resolution, except for ST Cycle Time where it is the review entry. */
  resolvedAt: string;
};

export type LeadCycleTimeRankRow = { key: string; avgMinutes: number; count: number };

export type LeadCycleTimeReport = {
  team: string;
  range: string;
  period: string;
  metric: LeadCycleTimeMetric;
  issueType: string | null;
  /** Column header for ranked-by-assignee — "Assigned COD" or "Assigned SE", per the team's config. */
  assigneeLabel: string;
  /**
   * How this report's span is defined, for the page subtitle and the ticket table's two date
   * columns. Derived here rather than in the page so the prose can never drift from the formula
   * directly above it — ST Cycle Time measures something genuinely different (see basisFor).
   */
  description: string;
  startColumnLabel: string;
  endColumnLabel: string;
  count: number;
  avgMinutes: number | null;
  topTickets: LeadCycleTimeTicket[];
  byAssignee: LeadCycleTimeRankRow[];
  byProduct: LeadCycleTimeRankRow[];
  byLabel: LeadCycleTimeRankRow[];
};

const EMPTY_REPORT: LeadCycleTimeReport = {
  team: "", range: "month", period: "", metric: "lead", issueType: null, assigneeLabel: "Assignee",
  description: "", startColumnLabel: "Started", endColumnLabel: "Ended",
  count: 0, avgMinutes: null, topTickets: [], byAssignee: [], byProduct: [], byLabel: [],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type TicketRow = {
  issue_key: string;
  issue_type: string | null;
  created: string;
  first_out_of_backlog_todo: string | null;
  resolved_datetime: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
};

const SELECT_COLUMNS =
  "issue_key,issue_type,created,first_out_of_backlog_todo,resolved_datetime,cycle_time_start,cycle_time_end,product,labels,assigned_se,assigned_cod";

/**
 * The three numbers this drill-down can be asked for, each defined exactly as gas/Aggregation.gs's
 * computeDailyBucket_ defines the scorecard it hangs off — so clicking a card opens a page that
 * measures the same thing, rather than a same-named number computed a different way.
 *
 *   lead (every team)        created -> resolved_datetime, gated on resolution.
 *   cycle (no peer review)   first_out_of_backlog_todo -> resolved_datetime, gated on resolution.
 *   cycle (peer-review team) cycle_time_start -> cycle_time_end, NOT gated on resolution.
 *                            The START is the same moment as the line above — cycle_time_start is
 *                            populated FROM first_out_of_backlog_todo (extractReviewCycleTimeRange_
 *                            in gas/JiraSync.gs takes it as backlogExitFallback), so only the END
 *                            differs. The end is the most recent transition into the ticket's
 *                            hand-off statuses: For Peer Review for backend-change types, or For
 *                            Checking / For Product Team for Investigations, plus Archived and
 *                            Rejected for every type. That completes the moment the ticket reaches
 *                            the stage, whether or not it is ever resolved.
 *
 * `dateColumn` is therefore also what the period filters on. Lead and non-peer-review cycle bucket
 * by resolution; ST cycle buckets by cycle_time_end, because a span that closed inside the period
 * is what the period is reporting on — filtering those by resolution date would both drop
 * unresolved tickets that were reviewed and pull in spans that closed months earlier.
 */
function basisFor(metric: LeadCycleTimeMetric, hasPeerReviewTracking: boolean) {
  if (metric === "lead") {
    return {
      dateColumn: "resolved_datetime" as const,
      startColumnLabel: "Created",
      endColumnLabel: "Resolved",
      description: hasPeerReviewTracking
        ? "Time from ticket creation to resolution, across tickets resolved in the period."
        : "Time from ticket creation to when it moved to Ready for Checking or Cancelled.",
      duration: (r: TicketRow) =>
        r.created && r.resolved_datetime ? minutesBetween(r.created, r.resolved_datetime) : null,
      startedAt: () => "",
      endedAt: (r: TicketRow) => r.resolved_datetime || "",
    };
  }
  if (hasPeerReviewTracking) {
    return {
      dateColumn: "cycle_time_end" as const,
      // Same start column as every other team — cycle_time_start IS first_out_of_backlog_todo
      // (extractReviewCycleTimeRange_ takes it as backlogExitFallback). Only the END differs.
      startColumnLabel: "Moved Out of To Do",
      endColumnLabel: "Reached Review",
      description:
        "Time from when a ticket moved out of Backlog/To Do to the most recent time it reached For Peer Review (For Checking or For Product Team for Investigations), Archived, or Rejected. Counted as soon as it reaches that stage, independent of resolution.",
      duration: (r: TicketRow) =>
        r.cycle_time_start && r.cycle_time_end ? minutesBetween(r.cycle_time_start, r.cycle_time_end) : null,
      startedAt: (r: TicketRow) => r.cycle_time_start || "",
      endedAt: (r: TicketRow) => r.cycle_time_end || "",
    };
  }
  return {
    dateColumn: "resolved_datetime" as const,
    startColumnLabel: "Moved Out of To Do",
    endColumnLabel: "Resolved",
    description:
      "Time from when a ticket moved out of Backlog/To Do to when it moved to Ready for Checking or Cancelled.",
    duration: (r: TicketRow) =>
      r.first_out_of_backlog_todo && r.resolved_datetime
        ? minutesBetween(r.first_out_of_backlog_todo, r.resolved_datetime)
        : null,
    startedAt: (r: TicketRow) => r.first_out_of_backlog_todo || "",
    endedAt: (r: TicketRow) => r.resolved_datetime || "",
  };
}

/** Same coarse-UTC-prefilter + exact-Manila-day-check split as lib/backlog-aging.ts. */
async function fetchTicketsInRange(
  teamKey: string,
  dateColumn: string,
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<TicketRow>((from, to) => {
    let query = getSupabaseClient()
      .from("tickets")
      .select(SELECT_COLUMNS)
      .eq("team_key", teamKey)
      .not(dateColumn, "is", null)
      .gte(dateColumn, rangeStartUtc.toISOString())
      .lte(dateColumn, rangeEndUtc.toISOString());
    if (issueType) query = query.eq("issue_type", issueType);
    return query.range(from, to);
  });
}

function rankBy(withDuration: { row: TicketRow; minutes: number }[], keyFn: (r: TicketRow) => string): LeadCycleTimeRankRow[] {
  const buckets: Record<string, { sum: number; count: number }> = {};
  for (const x of withDuration) {
    const key = keyFn(x.row);
    if (!key) continue;
    if (!buckets[key]) buckets[key] = { sum: 0, count: 0 };
    buckets[key].sum += x.minutes;
    buckets[key].count++;
  }
  return Object.entries(buckets)
    .map(([key, b]) => ({ key, avgMinutes: round2(b.sum / b.count), count: b.count }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes);
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `lead-cycle-time-report` route. Ported from
 * gas/LeadCycleTimeApi.gs's getLeadCycleTimeDrilldownReport_.
 */
export async function getLeadCycleTimeReport(
  team: string,
  range: string,
  period: string,
  metric: LeadCycleTimeMetric,
  issueType?: string
): Promise<LeadCycleTimeReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    const basis = basisFor(metric, teamConfig.has_peer_review_tracking);
    const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);

    const withDuration = rows
      .filter((r) => {
        const bucketIso = toManilaDateString(basis.endedAt(r));
        return bucketIso && bucketIso >= startDate && bucketIso <= endDate;
      })
      .map((r) => ({ row: r, minutes: basis.duration(r) }))
      .filter((x): x is { row: TicketRow; minutes: number } => x.minutes !== null && isFinite(x.minutes));

    const topTickets: LeadCycleTimeTicket[] = withDuration
      .slice()
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)
      .map((x) => ({
        issueKey: x.row.issue_key,
        issueType: x.row.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
        product: x.row.product || "(none)",
        labels: x.row.labels || "",
        minutes: round2(x.minutes),
        createdAt: x.row.created,
        startedAt: basis.startedAt(x.row),
        resolvedAt: basis.endedAt(x.row),
      }));

    const byAssignee = rankBy(withDuration, (r) => backlogAgingAssignee(teamConfig, r) || "(unassigned)");
    const byProduct = rankBy(withDuration, (r) => r.product || "(none)");

    // Labels: a ticket's labels are a CSV of tags — expand to individual tokens and attribute
    // this ticket's duration to each one, excluding department/team tags like se-ops, hr-ops,
    // payroll-ops (anything containing "-ops") since those aren't a meaningful task classification.
    const labelBuckets: Record<string, { sum: number; count: number }> = {};
    for (const x of withDuration) {
      const labels = (x.row.labels || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const label of labels) {
        if (label.toLowerCase().includes("-ops")) continue;
        if (!labelBuckets[label]) labelBuckets[label] = { sum: 0, count: 0 };
        labelBuckets[label].sum += x.minutes;
        labelBuckets[label].count++;
      }
    }
    const byLabel = Object.entries(labelBuckets)
      .map(([key, b]) => ({ key, avgMinutes: round2(b.sum / b.count), count: b.count }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes);

    return {
      team, range, period, metric, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      description: basis.description,
      startColumnLabel: basis.startColumnLabel,
      endColumnLabel: basis.endColumnLabel,
      count: withDuration.length,
      avgMinutes: withDuration.length
        ? round2(withDuration.reduce((sum, x) => sum + x.minutes, 0) / withDuration.length)
        : null,
      topTickets,
      byAssignee,
      byProduct,
      byLabel,
    };
  } catch {
    return { ...EMPTY_REPORT, team, range, period, metric, issueType: issueType ?? null };
  }
}

/**
 * The Team Stats / overview scorecard's Lead Time and Cycle Time, computed from `tickets` through
 * the SAME basisFor() the drill-down uses — so the card and the page it links to agree by
 * construction rather than by two implementations being kept in sync by hand.
 *
 * Replaces reading avg_lead_time_minutes / avg_cycle_time_minutes off metrics_daily. Those are
 * bucketed by the ticket's CREATED date (aggregateTeam_ keys its rowsByDate on `created`), which
 * averaged the spans of tickets *created* in the period instead of those that *finished* in it.
 * That inflated every card against its own drill-down — measured 2026-08-24 on Jul 2026: ST +5.0%,
 * DE +12.2%, DEV +30.1% — because a ticket created in-period but still open contributes nothing
 * while an older ticket that finished in-period is excluded. Everything else on the scorecard
 * still comes from metrics_daily; only these two numbers are live.
 *
 * Cost is one Supabase query per (team, date column). For a team without peer-review tracking both
 * metrics end at resolution, so the cache collapses them into a single query; ST needs two, since
 * its cycle ends at cycle_time_end rather than at resolution.
 */
export async function getLeadCycleTimeAverages(
  teamKeys: string[],
  range: string,
  period: string,
  issueType?: string
): Promise<{ leadTimeAvgMinutes: number | null; cycleTimeAvgMinutes: number | null }> {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const teams = (await getTeams()).filter((t) => teamKeys.includes(t.team_key));

  // Populated synchronously before the first await below, so the concurrent map cannot race two
  // identical fetches for the same key.
  const cache = new Map<string, Promise<TicketRow[]>>();
  const rowsFor = (teamKey: string, dateColumn: string) => {
    const key = `${teamKey}|${dateColumn}`;
    if (!cache.has(key)) {
      cache.set(key, fetchTicketsInRange(teamKey, dateColumn, startDate, endDate, issueType));
    }
    return cache.get(key)!;
  };

  const totals = { lead: { sum: 0, count: 0 }, cycle: { sum: 0, count: 0 } };

  await Promise.all(
    teams.flatMap((teamConfig) =>
      (["lead", "cycle"] as const).map(async (metric) => {
        const basis = basisFor(metric, teamConfig.has_peer_review_tracking);
        const rows = await rowsFor(teamConfig.team_key, basis.dateColumn);
        for (const r of rows) {
          const bucket = toManilaDateString(basis.endedAt(r));
          if (!bucket || bucket < startDate || bucket > endDate) continue;
          const minutes = basis.duration(r);
          if (minutes === null || !isFinite(minutes)) continue;
          totals[metric].sum += minutes;
          totals[metric].count++;
        }
      })
    )
  );

  return {
    leadTimeAvgMinutes: totals.lead.count ? round2(totals.lead.sum / totals.lead.count) : null,
    cycleTimeAvgMinutes: totals.cycle.count ? round2(totals.cycle.sum / totals.cycle.count) : null,
  };
}
