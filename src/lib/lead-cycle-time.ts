import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import {
  getTeams,
  backlogAgingAssignee,
  backlogAgingAssigneeLabel,
  excludedIssueTypes,
  isExcludedIssueType,
  type TeamConfig,
} from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";
import { BREAKDOWN_TICKET_LIMIT } from "@/lib/ticket-breakdowns";

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
  /**
   * For ST's Cycle Time specifically, this is the ACTUAL-WORK average only (out of To Do ->
   * reached review) — the same span this field has always measured. `combinedAvgMinutes` below
   * is actual + peer review, and IS this same value everywhere else (Lead Time, non-peer-review
   * teams), so a reader who only looks at combinedAvgMinutes gets the right number regardless of
   * team/metric.
   */
  avgMinutes: number | null;
  /** Average time IN For Peer Review (peer_review_cycles_json). Null except ST's Cycle Time. */
  peerReviewAvgMinutes: number | null;
  /** How many tickets contributed to peerReviewAvgMinutes. */
  peerReviewCount: number;
  /**
   * avgMinutes + peerReviewAvgMinutes for ST's Cycle Time — the same number the team-page
   * scorecard shows (see getLeadCycleTimeAverages), so the card and this deep-dive agree by
   * construction. Equals avgMinutes everywhere peer review doesn't apply.
   */
  combinedAvgMinutes: number | null;
  topTickets: LeadCycleTimeTicket[];
  byAssignee: LeadCycleTimeRankRow[];
  byProduct: LeadCycleTimeRankRow[];
  byLabel: LeadCycleTimeRankRow[];
};

const EMPTY_REPORT: LeadCycleTimeReport = {
  team: "", range: "month", period: "", metric: "lead", issueType: null, assigneeLabel: "Assignee",
  description: "", startColumnLabel: "Started", endColumnLabel: "Ended",
  count: 0, avgMinutes: null, peerReviewAvgMinutes: null, peerReviewCount: 0, combinedAvgMinutes: null,
  topTickets: [], byAssignee: [], byProduct: [], byLabel: [],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The only fields the span definitions in `basisFor` actually read.
 *
 * Named separately from TicketRow so another report can compute the SAME lead and cycle spans off
 * its own row shape (see lib/automated-tickets.ts) instead of re-deriving the formulas. TicketRow
 * satisfies it structurally, so every call site in this file is unaffected.
 */
export type SpanFields = {
  created: string;
  resolved_datetime: string | null;
  first_out_of_backlog_todo: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string | null;
};

/** One entry of a ticket's peer_review_cycles_json — see extractPeerReviewCyclesWithReviewer_ in gas/JiraSync.gs. */
type PeerReviewCycleRaw = {
  enteredAt?: string;
  exitedAt?: string;
  exitedToStatus?: string;
};

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
  peer_review_cycles_json?: PeerReviewCycleRaw[] | null;
  /** Lead Time deep-dive only (see getLeadTimeDeepDive) — ignored by the Lead/Cycle Time average
   * and top-tickets paths above. Same column lib/ticket-breakdowns.ts's On Hold report reads. */
  total_on_hold_minutes?: number | string | null;
  /** Lead Time deep-dive only — same shape as lib/p1-sla.ts's holding_reasons_json. */
  holding_reasons_json?: unknown;
};

const SELECT_COLUMNS =
  "issue_key,issue_type,created,first_out_of_backlog_todo,resolved_datetime,cycle_time_start,cycle_time_end,product,labels,assigned_se,assigned_cod,peer_review_cycles_json,total_on_hold_minutes,holding_reasons_json";

/**
 * Sums the qualifying peer-review cycles on one ticket — same business rule as
 * lib/peer-review.ts/lib/tool-assisted.ts's peerReviewFor: only cycles that exited to On Hold or
 * For Checking count (a cycle that exited some other way, e.g. cancelled, is real but out of
 * scope here), and an open cycle (no exitedAt yet) has no duration to contribute. Returns null
 * rather than 0 when there were no qualifying cycles, so "never reviewed" and "reviewed in zero
 * minutes" stay distinguishable — null is excluded from the average instead of dragging it down.
 */
function sumPeerReviewMinutes(cycles: PeerReviewCycleRaw[] | null | undefined): number | null {
  if (!cycles || !cycles.length) return null;
  let total = 0;
  let count = 0;
  for (const c of cycles) {
    if (!c.enteredAt || !c.exitedAt) continue;
    const exitedTo = (c.exitedToStatus || "").toLowerCase();
    if (exitedTo !== "on hold" && exitedTo !== "for checking") continue;
    total += minutesBetween(c.enteredAt, c.exitedAt);
    count++;
  }
  return count ? round2(total) : null;
}

/**
 * Just the columns basisFor's duration()/endedAt() actually read. getLeadCycleTimeAverages runs on
 * every team-page and overview render and only needs an average, so it must not drag the ranking
 * columns (product, labels, assignee, issue_key) across the wire for thousands of rows — doing so
 * cost ~2x on the overview's year range.
 */
const SPAN_ONLY_COLUMNS =
  "issue_key,created,first_out_of_backlog_todo,resolved_datetime,cycle_time_start,cycle_time_end";

/**
 * SPAN_ONLY_COLUMNS plus peer_review_cycles_json, for peer-review teams' Cycle Time decomposition
 * (getPeerReviewCycleAverages) — the one span-average fetch that also needs the review-cycle
 * payload. Kept separate from SPAN_ONLY_COLUMNS rather than added there so Lead Time and every
 * non-peer-review team's fetch stays as small as before.
 */
const PEER_REVIEW_SPAN_COLUMNS = `${SPAN_ONLY_COLUMNS},peer_review_cycles_json`;

/** PostgREST's per-response cap. Mirrors SUPABASE_MAX_ROWS_PER_REQUEST in lib/supabase.ts. */
const PAGE_SIZE = 1000;

/**
 * fetchAllRows walks pages SEQUENTIALLY — it has to, since it discovers the end only by getting a
 * short page. For the scorecard averages that meant ~50 round trips for the overview's year range
 * (three teams x two date columns x ~12k rows each), which measured 9-12s of pure latency.
 *
 * Here the row count is asked for up front, so every page can be requested at once instead. An
 * explicit .order("issue_key") is what makes that safe: PostgREST offsets are only stable under a
 * deterministic sort, and without one concurrent pages can overlap or skip rows outright (the same
 * hazard fetchAllRows' own docstring warns about). issue_key is unique, so the ordering is total.
 */
async function fetchSpanRowsParallel(
  teamKey: string,
  dateColumn: string,
  startDate: string,
  endDate: string,
  issueType?: string,
  columns: string = SPAN_ONLY_COLUMNS
): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  // Excluded types are filtered in SQL rather than in JS: SPAN_ONLY_COLUMNS deliberately omits
  // issue_type, and this path exists to move as few bytes as possible.
  const excluded = excludedIssueTypes(teamKey);

  // `any` is deliberate and contained. Each conditional .eq()/.not() below widens supabase-js's
  // builder generics again, and re-assigning through them trips TS2589 ("type instantiation is
  // excessively deep"). The rows are cast to TicketRow at the end regardless, so the chain's own
  // inferred type buys nothing here.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const build = (head: boolean): any => {
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .eq("team_key", teamKey)
      .not(dateColumn, "is", null)
      .gte(dateColumn, rangeStartUtc.toISOString())
      .lte(dateColumn, rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    return q;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const { count, error } = await build(true);
  if (error) throw new Error(`Supabase count failed: ${error.message}`);
  const total = count ?? 0;
  if (total === 0) return [];

  const pages: { data: unknown; error: { message: string } | null }[] = await Promise.all(
    Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) =>
      build(false).order("issue_key").range(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1)
    )
  );
  const rows: TicketRow[] = [];
  for (const page of pages) {
    if (page.error) throw new Error(`Supabase query failed: ${page.error.message}`);
    rows.push(...((page.data ?? []) as TicketRow[]));
  }
  return rows;
}

/**
 * Cycle Time for a peer-review team (ST), decomposed into actual-work vs. peer-review sums, for
 * getLeadCycleTimeAverages' scorecard. Mirrors the drill-down's own decomposition in
 * getLeadCycleTimeReport exactly — same population (cycle_time_end bucketed into the period), same
 * two per-ticket measures — so the scorecard and the deep-dive it links to can never disagree.
 *
 * Separate from the shared RPC-or-fallback path above because peer_review_cycles_json is a jsonb
 * column: summing it per-ticket is JS-side work, not something the lead_cycle_time_spans RPC (a
 * plain SQL sum/count) does. Only ST pays this extra fetch; every other team/metric still goes
 * through the cheap RPC path untouched.
 */
async function getPeerReviewCycleAverages(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<{ actualSum: number; actualCount: number; peerReviewSum: number; peerReviewCount: number }> {
  const rows = await fetchSpanRowsParallel(
    teamKey,
    "cycle_time_end",
    startDate,
    endDate,
    issueType,
    PEER_REVIEW_SPAN_COLUMNS
  );

  let actualSum = 0;
  let actualCount = 0;
  let peerReviewSum = 0;
  let peerReviewCount = 0;

  for (const r of rows) {
    const bucket = toManilaDateString(r.cycle_time_end);
    if (!bucket || bucket < startDate || bucket > endDate) continue;

    if (r.cycle_time_start && r.cycle_time_end) {
      const minutes = minutesBetween(r.cycle_time_start, r.cycle_time_end);
      if (isFinite(minutes)) {
        actualSum += minutes;
        actualCount++;
      }
    }

    const reviewMinutes = sumPeerReviewMinutes(r.peer_review_cycles_json);
    if (reviewMinutes !== null) {
      peerReviewSum += reviewMinutes;
      peerReviewCount++;
    }
  }

  return { actualSum, actualCount, peerReviewSum, peerReviewCount };
}

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
 *                            differs. The end is the ticket's hand-off into review: For Peer Review
 *                            for backend-change types, or For Checking / For Product Team for
 *                            Investigations — using the MOST RECENT such move, since bouncing back
 *                            for more work and re-entering review is a genuinely later completion.
 *                            Archived and Rejected apply on top for every type, but once a ticket
 *                            reaches either one it's done — a LATER move between them (or back into
 *                            one after already having gone terminal) is a reclassification, not more
 *                            work, so that end uses the FIRST time the ticket went archived/rejected
 *                            instead. Either way it's counted as soon as the ticket reaches that
 *                            stage, independent of resolution.
 *
 * `dateColumn` is therefore also what the period filters on. Lead and non-peer-review cycle bucket
 * by resolution; ST cycle buckets by cycle_time_end, because a span that closed inside the period
 * is what the period is reporting on — filtering those by resolution date would both drop
 * unresolved tickets that were reviewed and pull in spans that closed months earlier.
 */
export function basisFor(metric: LeadCycleTimeMetric, hasPeerReviewTracking: boolean) {
  if (metric === "lead") {
    return {
      dateColumn: "resolved_datetime" as const,
      startColumnLabel: "Created",
      endColumnLabel: "Resolved",
      description: hasPeerReviewTracking
        ? "Time from ticket creation to resolution, across tickets resolved in the period."
        : "Time from ticket creation to when it moved to Ready for Checking or Cancelled.",
      duration: (r: SpanFields) =>
        r.created && r.resolved_datetime ? minutesBetween(r.created, r.resolved_datetime) : null,
      startedAt: () => "",
      endedAt: (r: SpanFields) => r.resolved_datetime || "",
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
        "Time from when a ticket moved out of Backlog/To Do to when it reached review — the most recent move into For Peer Review (For Checking or For Product Team for Investigations), or, once archived or rejected, the first time that happened. Counted as soon as it reaches that stage, independent of resolution.",
      duration: (r: SpanFields) =>
        r.cycle_time_start && r.cycle_time_end ? minutesBetween(r.cycle_time_start, r.cycle_time_end) : null,
      startedAt: (r: SpanFields) => r.cycle_time_start || "",
      endedAt: (r: SpanFields) => r.cycle_time_end || "",
    };
  }
  return {
    dateColumn: "resolved_datetime" as const,
    startColumnLabel: "Moved Out of To Do",
    endColumnLabel: "Resolved",
    description:
      "Time from when a ticket moved out of Backlog/To Do to when it moved to Ready for Checking or Cancelled.",
    duration: (r: SpanFields) =>
      r.first_out_of_backlog_todo && r.resolved_datetime
        ? minutesBetween(r.first_out_of_backlog_todo, r.resolved_datetime)
        : null,
    startedAt: (r: SpanFields) => r.first_out_of_backlog_todo || "",
    endedAt: (r: SpanFields) => r.resolved_datetime || "",
  };
}

/** Same coarse-UTC-prefilter + exact-Manila-day-check split as lib/backlog-aging.ts. */
async function fetchTicketsInRange(
  teamKey: string,
  dateColumn: string,
  startDate: string,
  endDate: string,
  issueType?: string,
  columns: string = SELECT_COLUMNS
): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<TicketRow>((from, to) => {
    let query = getSupabaseClient()
      .from("tickets")
      .select(columns)
      .eq("team_key", teamKey)
      .not(dateColumn, "is", null)
      .gte(dateColumn, rangeStartUtc.toISOString())
      .lte(dateColumn, rangeEndUtc.toISOString());
    if (issueType) query = query.eq("issue_type", issueType);
    // supabase-js infers the row shape from a LITERAL select string; `columns` is a parameter, so
    // it falls back to GenericStringError[] and the generic no longer lines up. Both call sites
    // pass one of the two constants above, every field of which is on TicketRow (SPAN_ONLY_COLUMNS
    // is a strict subset), so the cast is asserting something the constants already guarantee.
    return query.range(from, to) as unknown as PromiseLike<{
      data: TicketRow[] | null;
      error: { message: string } | null;
    }>;
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
      .filter((r) => !isExcludedIssueType(team, r.issue_type))
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

    const avgMinutes = withDuration.length
      ? round2(withDuration.reduce((sum, x) => sum + x.minutes, 0) / withDuration.length)
      : null;

    // ST's Cycle Time only: decompose the same span into actual-work vs. time spent IN review,
    // over the SAME ticket population withDuration already selected for the period, so this
    // number and avgMinutes/topTickets/byAssignee etc. can never disagree about which tickets
    // are in scope.
    let peerReviewAvgMinutes: number | null = null;
    let peerReviewCount = 0;
    let combinedAvgMinutes = avgMinutes;
    if (metric === "cycle" && teamConfig.has_peer_review_tracking) {
      const reviewMinutesList = withDuration
        .map((x) => sumPeerReviewMinutes(x.row.peer_review_cycles_json))
        .filter((v): v is number => v !== null);
      peerReviewCount = reviewMinutesList.length;
      peerReviewAvgMinutes = peerReviewCount
        ? round2(reviewMinutesList.reduce((sum, v) => sum + v, 0) / peerReviewCount)
        : null;
      combinedAvgMinutes =
        avgMinutes !== null && peerReviewAvgMinutes !== null
          ? round2(avgMinutes + peerReviewAvgMinutes)
          : avgMinutes ?? peerReviewAvgMinutes;
    }

    return {
      team, range, period, metric, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      description: basis.description,
      startColumnLabel: basis.startColumnLabel,
      endColumnLabel: basis.endColumnLabel,
      count: withDuration.length,
      avgMinutes,
      peerReviewAvgMinutes,
      peerReviewCount,
      combinedAvgMinutes,
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

  // Peer-review teams' Cycle Time is actual-work-average + peer-review-average, not a plain span
  // average (see getPeerReviewCycleAverages) — computed separately below and kept OUT of the RPC/
  // fallback accumulation for these teams so their cycle_sum/cycle_count never gets double-counted.
  const peerReviewTeamKeys = new Set(teams.filter((t) => t.has_peer_review_tracking).map((t) => t.team_key));

  // Populated synchronously before the first await below, so the concurrent map cannot race two
  // identical fetches for the same key.
  const cache = new Map<string, Promise<TicketRow[]>>();
  const rowsFor = (teamKey: string, dateColumn: string) => {
    const key = `${teamKey}|${dateColumn}`;
    if (!cache.has(key)) {
      cache.set(key, fetchSpanRowsParallel(teamKey, dateColumn, startDate, endDate, issueType));
    }
    return cache.get(key)!;
  };

  const totals = { lead: { sum: 0, count: 0 }, cycle: { sum: 0, count: 0 } };

  // Fast path: Postgres does the arithmetic and returns four numbers per team (see
  // supabase/lead-cycle-time-rpc.sql). Falls back to the row-walk below if the function is not
  // installed yet, so the app keeps working — correctly, just slowly — until that migration is run.
  const viaRpc = await Promise.all(
    teams.map(async (teamConfig) => {
      const { data, error } = await getSupabaseClient().rpc("lead_cycle_time_spans", {
        p_team_key: teamConfig.team_key,
        p_start: startDate,
        p_end: endDate,
        p_has_peer_review: teamConfig.has_peer_review_tracking,
        p_issue_type: issueType ?? null,
        p_excluded_issue_types: excludedIssueTypes(teamConfig.team_key),
      });
      if (error || !data) return null;
      return Array.isArray(data) ? data[0] : data;
    })
  );

  if (viaRpc.every((r) => r)) {
    teams.forEach((teamConfig, i) => {
      const r = viaRpc[i] as { lead_sum: number; lead_count: number; cycle_sum: number; cycle_count: number };
      totals.lead.sum += Number(r.lead_sum) || 0;
      totals.lead.count += Number(r.lead_count) || 0;
      if (!peerReviewTeamKeys.has(teamConfig.team_key)) {
        totals.cycle.sum += Number(r.cycle_sum) || 0;
        totals.cycle.count += Number(r.cycle_count) || 0;
      }
    });
  } else {
    await Promise.all(
      teams.flatMap((teamConfig) =>
        (["lead", "cycle"] as const).map(async (metric) => {
          // Peer-review teams' cycle contribution is handled by the dedicated decomposition below.
          if (metric === "cycle" && peerReviewTeamKeys.has(teamConfig.team_key)) return;
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
  }

  // Peer-review teams' Cycle Time: sum of the actual-work average and the peer-review average.
  // Folded into totals.cycle using the actual-work ticket count as the weight (falling back to the
  // peer-review count when a period has review data but no completed actual spans) — the same
  // ticket-count weighting the RPC/fallback path above already uses for every other team.
  await Promise.all(
    teams
      .filter((t) => peerReviewTeamKeys.has(t.team_key))
      .map(async (teamConfig) => {
        const { actualSum, actualCount, peerReviewSum, peerReviewCount } = await getPeerReviewCycleAverages(
          teamConfig.team_key,
          startDate,
          endDate,
          issueType
        );
        const actualAvg = actualCount ? actualSum / actualCount : null;
        const peerReviewAvg = peerReviewCount ? peerReviewSum / peerReviewCount : null;
        const combinedAvg =
          actualAvg !== null && peerReviewAvg !== null ? actualAvg + peerReviewAvg : actualAvg ?? peerReviewAvg;
        const weight = actualCount || peerReviewCount;
        if (weight && combinedAvg !== null) {
          totals.cycle.sum += combinedAvg * weight;
          totals.cycle.count += weight;
        }
      })
  );

  return {
    leadTimeAvgMinutes: totals.lead.count ? round2(totals.lead.sum / totals.lead.count) : null,
    cycleTimeAvgMinutes: totals.cycle.count ? round2(totals.cycle.sum / totals.cycle.count) : null,
  };
}

// ==================================================================================
// Lead Time deep-dive (metric === "lead" only) — pulse, trend, distribution, stage
// breakdown, breakdowns by work type/product, long-running work, and a filterable
// ticket detail table. Cycle Time keeps using getLeadCycleTimeReport above unchanged.
//
// Team-agnostic by construction: every function here takes `team`/`teamConfig` as a
// parameter and the only per-team variation is has_peer_review_tracking (which only
// changes basisFor's description text for "lead", never the calculation) — so this
// applies identically across every team in TEAMS_CONFIG (SE, DBA, DevOps, ST, ...),
// the same way the rest of this file already does.
// ==================================================================================

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round4((current - previous) / previous);
}

/** Linear-interpolation percentile (matches numpy's default) over an ascending-sorted array. */
function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return round2(sortedAsc[0]);
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round2(sortedAsc[lo]);
  return round2(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo));
}

function medianOf(sortedAsc: number[]): number | null {
  return percentile(sortedAsc, 50);
}

/** holding_reasons_json is an array of plain reason strings, same shape lib/p1-sla.ts reads. */
function holdingReasonsOfRow(json: unknown): string[] {
  const entries = Array.isArray(json) ? json : [];
  return entries
    .map((e) => (typeof e === "string" ? e : String((e as { reason?: unknown })?.reason ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Same day-bucketing scheme as lib/p1-sla.ts's bucketKeyFor/enumerateBuckets — duplicated rather
 * than imported per this codebase's convention that each report module owns its own small
 * aggregation helpers (see e.g. every report file's own local round2/round4).
 */
function leadTimeBucketKeyFor(range: string, dateIso: string): string {
  if (range === "year") return dateIso.slice(0, 7);
  if (range === "quarter") {
    const d = new Date(`${dateIso}T00:00:00Z`);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); // back to Monday
    return d.toISOString().slice(0, 10);
  }
  return dateIso; // week/month ranges: daily
}

function leadTimeEnumerateBuckets(range: string, startDate: string, endDate: string): string[] {
  const buckets: string[] = [];
  const end = new Date(`${endDate}T00:00:00Z`);

  if (range === "year") {
    const cursor = new Date(`${startDate}T00:00:00Z`);
    cursor.setUTCDate(1);
    while (cursor <= end) {
      buckets.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return buckets;
  }

  const cursor = new Date(`${startDate}T00:00:00Z`);
  const stepDays = range === "quarter" ? 7 : 1;
  if (range === "quarter") {
    const day = cursor.getUTCDay();
    cursor.setUTCDate(cursor.getUTCDate() - ((day + 6) % 7));
  }
  while (cursor <= end) {
    buckets.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + stepDays);
  }
  return buckets;
}

/** Fixed ranges per the brief: <1, 1-2, 3-5, 6-10, 11-20, >20 days. Half-open in days-elapsed. */
const DISTRIBUTION_BUCKETS: { label: string; minDays: number; maxDays: number | null }[] = [
  { label: "< 1 day", minDays: 0, maxDays: 1 },
  { label: "1–2 days", minDays: 1, maxDays: 3 },
  { label: "3–5 days", minDays: 3, maxDays: 6 },
  { label: "6–10 days", minDays: 6, maxDays: 11 },
  { label: "11–20 days", minDays: 11, maxDays: 21 },
  { label: "> 20 days", minDays: 21, maxDays: null },
];

export type LeadTimePulse = {
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  p75Minutes: number | null;
  /** Null below a 10-ticket sample — not a meaningful long-tail read on a handful of tickets. */
  p90Minutes: number | null;
};

type LeadTimeMetricDelta = { current: number | null; previous: number | null; deltaPct: number | null };

export type LeadTimeComparison = {
  count: { current: number; previous: number; deltaPct: number | null };
  medianMinutes: LeadTimeMetricDelta;
  avgMinutes: LeadTimeMetricDelta;
  p90Minutes: LeadTimeMetricDelta;
};

export type LeadTimeInsight = { text: { professional: string; gaby: string }; tone: "positive" | "watch" | "negative" };
export type LeadTimePositiveHighlight = { label: string; detail: string };

export type LeadTimeTrendPoint = { bucket: string; count: number; medianMinutes: number | null; avgMinutes: number | null };

export type LeadTimeDistributionBucket = { label: string; minDays: number; maxDays: number | null; count: number; share: number | null };

export type LeadTimePercentiles = {
  p50: number | null;
  p75: number | null;
  /** Null below a 10-ticket sample. */
  p90: number | null;
  /** Null below a 20-ticket sample. */
  p95: number | null;
};

export type LeadTimeBreakdownRow = {
  key: string;
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  p75Minutes: number | null;
  p90Minutes: number | null;
  /** Tickets in this group above the report's long-running threshold (see longRunningThreshold). */
  longRunningCount: number;
};

export type LeadTimeFlowStage = {
  key: "backlogWait" | "activeAndReview";
  label: string;
  avgMinutes: number | null;
  medianMinutes: number | null;
  shareOfLeadTime: number | null;
  count: number;
};

export type LeadTimeFlow = {
  /** False when first_out_of_backlog_todo isn't populated for enough of this period's tickets. */
  available: boolean;
  stages: LeadTimeFlowStage[];
  waitingAvgMinutes: number | null;
  waitingMedianMinutes: number | null;
  waitingShareOfLeadTime: number | null;
  activeAvgMinutes: number | null;
  activeMedianMinutes: number | null;
  /** False when total_on_hold_minutes is never populated (all null/zero) for this population. */
  waitingDataAvailable: boolean;
};

export type LeadTimeOutlier = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  labels: string;
  createdAt: string;
  resolvedAt: string;
  minutes: number;
  vsMedianMinutes: number | null;
  vsMedianPct: number | null;
  holdingReasons: string[];
};

export type LeadTimePattern = {
  dimension: "Work Type" | "Product";
  key: string;
  count: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
};

export type LeadTimeTicketRow = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  labels: string;
  createdAt: string;
  resolvedAt: string;
  minutes: number;
  /** Null when total_on_hold_minutes isn't populated for this ticket. */
  waitingMinutes: number | null;
  activeMinutes: number | null;
  vsMedianMinutes: number | null;
};

export type LeadTimeDeepDiveReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  assigneeLabel: string;
  description: string;
  pulse: LeadTimePulse;
  comparison: LeadTimeComparison | null;
  insights: LeadTimeInsight[];
  positiveHighlights: LeadTimePositiveHighlight[];
  trend: LeadTimeTrendPoint[];
  distribution: LeadTimeDistributionBucket[];
  percentiles: LeadTimePercentiles;
  byWorkType: LeadTimeBreakdownRow[];
  byProduct: LeadTimeBreakdownRow[];
  flow: LeadTimeFlow;
  /** Displayed table — capped to the top 20 by duration. */
  longRunning: LeadTimeOutlier[];
  /** True count of tickets above the long-running threshold, uncapped — see longRunning's cap. */
  longRunningTotalCount: number;
  patterns: LeadTimePattern[];
  tickets: LeadTimeTicketRow[];
  ticketsTotalCount: number;
};

function emptyDeepDive(team: string, range: string, period: string, issueType?: string): LeadTimeDeepDiveReport {
  return {
    team, range, period, issueType: issueType ?? null,
    assigneeLabel: "Assignee",
    description: "",
    pulse: { count: 0, medianMinutes: null, avgMinutes: null, p75Minutes: null, p90Minutes: null },
    comparison: null,
    insights: [],
    positiveHighlights: [],
    trend: [],
    distribution: [],
    percentiles: { p50: null, p75: null, p90: null, p95: null },
    byWorkType: [],
    byProduct: [],
    flow: {
      available: false, stages: [], waitingAvgMinutes: null, waitingMedianMinutes: null,
      waitingShareOfLeadTime: null, activeAvgMinutes: null, activeMedianMinutes: null, waitingDataAvailable: false,
    },
    longRunning: [],
    longRunningTotalCount: 0,
    patterns: [],
    tickets: [],
    ticketsTotalCount: 0,
  };
}

/** Just enough of one period's Lead Time numbers to diff against another — mirrors lib/p1-sla.ts's summarizePeriod. */
async function summarizeLeadTimePeriod(
  team: string,
  range: string,
  period: string,
  issueType: string | undefined,
  teamConfig: TeamConfig
): Promise<{ count: number; medianMinutes: number | null; avgMinutes: number | null; p90Minutes: number | null }> {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const basis = basisFor("lead", teamConfig.has_peer_review_tracking);
  const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);
  const minutes = rows
    .filter((r) => !isExcludedIssueType(team, r.issue_type))
    .filter((r) => {
      const bucketIso = toManilaDateString(basis.endedAt(r));
      return bucketIso && bucketIso >= startDate && bucketIso <= endDate;
    })
    .map((r) => basis.duration(r))
    .filter((v): v is number => v !== null && isFinite(v));
  const sorted = minutes.slice().sort((a, b) => a - b);
  return {
    count: minutes.length,
    medianMinutes: medianOf(sorted),
    avgMinutes: minutes.length ? round2(minutes.reduce((s, v) => s + v, 0) / minutes.length) : null,
    p90Minutes: minutes.length >= 10 ? percentile(sorted, 90) : null,
  };
}

function fmtDaysShort(minutes: number): string {
  return `${(minutes / 1440).toFixed(1)}d`;
}

/**
 * Rules-based, over the report's own already-computed numbers — same pattern as lib/p1-sla.ts's
 * buildInsights: never free-text/LLM-generated, and a rule only fires when its specific data
 * condition is true. Ordered: direction, long tail, concentration, waiting/flow, volume
 * relationship, recurring pattern — capped at 5.
 */
/**
 * Text for each insight condition, in both registers. Professional stays exactly as it always
 * has; Gaby is the "Gaby voice" tone spec (2026-09-02) — headline first, plain-English "so what",
 * hedged rather than causal language, light/sparing personality. Both are always computed (it's a
 * pure string template over numbers already in hand, not a second data fetch) so InsightsPanel
 * can pick between them on the client with no round trip — see its doc comment for why that
 * replaced picking the register here. This only ever restyles a condition that already fired — it
 * does not lower any threshold or add a condition, so "say nothing when nothing stands out" holds
 * in both registers identically.
 */
function buildLeadTimeInsights(report: {
  pulse: LeadTimePulse;
  comparison: LeadTimeComparison | null;
  trend: LeadTimeTrendPoint[];
  byWorkType: LeadTimeBreakdownRow[];
  flow: LeadTimeFlow;
  patterns: LeadTimePattern[];
  longRunningTotalCount: number;
}): LeadTimeInsight[] {
  const insights: LeadTimeInsight[] = [];
  const c = report.comparison;

  if (c && c.medianMinutes.current !== null && c.medianMinutes.previous !== null && c.medianMinutes.deltaPct !== null && Math.abs(c.medianMinutes.deltaPct) >= 0.05) {
    const improved = c.medianMinutes.deltaPct < 0; // Lead Time: lower is always the improvement
    const pct = Math.round(Math.abs(c.medianMinutes.deltaPct) * 1000) / 10;
    const prev = fmtDaysShort(c.medianMinutes.previous);
    const curr = fmtDaysShort(c.medianMinutes.current);
    insights.push({
      text: {
        professional: `Median Lead Time ${improved ? "improved" : "increased"} from ${prev} to ${curr} (${improved ? "-" : "+"}${pct}%) vs the previous period.`,
        gaby: improved
          ? `**Lead Time is getting better 👀** Median dropped from **${prev} → ${curr}** (${pct}% faster), so the typical ticket is moving quicker than last period.`
          : `**Lead Time slowed down this period.** Median went from **${prev} → ${curr}** (${pct}% slower) — worth a look at what changed.`,
      },
      tone: improved ? "positive" : "negative",
    });
  }

  if (report.pulse.medianMinutes !== null && report.pulse.p90Minutes !== null && report.pulse.p90Minutes > report.pulse.medianMinutes * 2) {
    const p90 = fmtDaysShort(report.pulse.p90Minutes);
    const median = fmtDaysShort(report.pulse.medianMinutes);
    insights.push({
      text: {
        professional: `P90 Lead Time is ${p90} despite a ${median} median — a long tail of slow-moving work is pulling the average up.`,
        gaby: `**👀 Most tickets are quick, but a few are dragging things out.** P90 sits at **${p90}** against a **${median}** median — a small group of slow-moving tickets is pulling the tail long.`,
      },
      tone: "watch",
    });
  }

  const topLongRunning = report.byWorkType.filter((r) => r.longRunningCount > 0).sort((a, b) => b.longRunningCount - a.longRunningCount)[0];
  // The TRUE count above the long-running threshold, not report.longRunning.length (that array is
  // capped to the top 20 for the outliers table — using it here could make a work type's own count
  // exceed the "total" it's being compared against, e.g. "28 of the 20 long-running tickets").
  const totalLongRunning = report.longRunningTotalCount;
  if (topLongRunning && totalLongRunning >= 3 && topLongRunning.longRunningCount / totalLongRunning >= 0.4) {
    insights.push({
      text: {
        professional: `"${topLongRunning.key}" accounts for ${topLongRunning.longRunningCount} of the ${totalLongRunning} unusually long-running tickets this period.`,
        gaby: `**🚩 "${topLongRunning.key}" is doing more than its share of the damage.** It accounts for **${topLongRunning.longRunningCount} of the ${totalLongRunning}** unusually long-running tickets this period — that's the group I'd dig into first.`,
      },
      tone: "watch",
    });
  }

  if (report.flow.waitingDataAvailable && report.flow.waitingShareOfLeadTime !== null && report.flow.waitingShareOfLeadTime >= 0.25) {
    const pct = Math.round(report.flow.waitingShareOfLeadTime * 1000) / 10;
    insights.push({
      text: {
        professional: `Waiting/on-hold time accounts for ${pct}% of total Lead Time on average — a high-waiting ticket isn't necessarily slow to work on.`,
        gaby: `**🫠 A big chunk of Lead Time is just waiting.** Waiting/on-hold makes up **${pct}%** of it on average — translation: a ticket that "took days" might only have had someone actively working it for a fraction of that.`,
      },
      tone: "watch",
    });
  } else {
    const backlogStage = report.flow.stages.find((s) => s.key === "backlogWait");
    if (backlogStage && backlogStage.shareOfLeadTime !== null && backlogStage.shareOfLeadTime >= 0.4) {
      const pct = Math.round(backlogStage.shareOfLeadTime * 1000) / 10;
      insights.push({
        text: {
          professional: `Backlog/queue time accounts for ${pct}% of total Lead Time — tickets spend meaningful time waiting before work starts.`,
          gaby: `**⏸️ Tickets are sitting before anyone even starts.** Backlog/queue time is **${pct}%** of Lead Time — that's time spent waiting to be picked up, not being worked.`,
        },
        tone: "watch",
      });
    }
  }

  const busiest = report.trend.length > 2 ? report.trend.slice().sort((a, b) => b.count - a.count)[0] : null;
  if (busiest && busiest.count > 0 && report.pulse.medianMinutes !== null && busiest.medianMinutes !== null && busiest.medianMinutes > report.pulse.medianMinutes * 1.3) {
    const median = fmtDaysShort(busiest.medianMinutes);
    insights.push({
      text: {
        professional: `Lead Time ran higher during the highest-volume period in this range (${busiest.count} completed, ${median} median) — a possible volume/throughput pattern, not necessarily causal.`,
        gaby: `**Busier period, slower tickets — could be related.** The highest-volume stretch (**${busiest.count}** completed) also ran a **${median}** median, above the overall pace. Possible volume/throughput effect — not enough here to call it causal, but worth watching.`,
      },
      tone: "watch",
    });
  }

  if (report.patterns.length) {
    const p = report.patterns[0];
    const dimensionLabel = p.dimension === "Work Type" ? "Work type" : "Product";
    const median = fmtDaysShort(p.medianMinutes ?? 0);
    const smallSample = p.count < 10;
    insights.push({
      text: {
        professional: `Recurring pattern: ${p.dimension === "Work Type" ? "work type" : "product"} "${p.key}" (${p.count} tickets) runs a ${median} median Lead Time, notably above the overall median.`,
        gaby: `**A pattern worth knowing about.** ${dimensionLabel} "${p.key}" (**${p.count}** tickets) consistently runs a **${median}** median — notably above the overall pace.${
          smallSample ? " Small sample, so treat this as a signal rather than a conclusion," : " Worth investigating —"
        } this is the kind of thing worth digging into if it keeps showing up.`,
      },
      tone: "watch",
    });
  }

  if (!insights.length && report.pulse.count > 0) {
    insights.push({
      text: {
        professional: "Lead Time is stable and consistent this period — no significant shifts or long-tail concentration detected.",
        gaby: "**Nothing jumping out this period.** Lead Time's steady — no long tail, no volume spike, no recurring slow pattern. Good news, not much to report.",
      },
      tone: "positive",
    });
  }

  return insights.slice(0, 5);
}

function buildLeadTimePositiveHighlights(report: {
  comparison: LeadTimeComparison | null;
  byWorkType: LeadTimeBreakdownRow[];
  byProduct: LeadTimeBreakdownRow[];
  flow: LeadTimeFlow;
}): LeadTimePositiveHighlight[] {
  const highlights: LeadTimePositiveHighlight[] = [];
  const c = report.comparison;

  if (c && c.medianMinutes.deltaPct !== null && c.medianMinutes.deltaPct <= -0.05) {
    highlights.push({
      label: "Faster delivery",
      detail: `Median Lead Time down ${Math.round(Math.abs(c.medianMinutes.deltaPct) * 1000) / 10}% vs the previous period.`,
    });
  }

  const consistent = [...report.byWorkType, ...report.byProduct]
    .filter((r) => r.count >= 5 && r.medianMinutes !== null && r.medianMinutes > 0 && r.p90Minutes !== null)
    .sort((a, b) => a.p90Minutes! / a.medianMinutes! - b.p90Minutes! / b.medianMinutes!)[0];
  if (consistent) {
    highlights.push({ label: "Most consistent", detail: `${consistent.key} — ${consistent.count} tickets, tight spread between median and P90 Lead Time.` });
  }

  if (report.flow.waitingDataAvailable && report.flow.waitingShareOfLeadTime !== null && report.flow.waitingShareOfLeadTime < 0.15) {
    highlights.push({ label: "Low waiting time", detail: `Waiting/on-hold time is only ${Math.round(report.flow.waitingShareOfLeadTime * 1000) / 10}% of total Lead Time.` });
  }

  return highlights.slice(0, 3);
}

/**
 * The Lead Time drill-down's full pulse-to-details report — median/avg/P75/P90, trend, a
 * distribution histogram, breakdowns by work type and product (median/P75/P90, not just avg),
 * a Created->backlog-exit->resolved stage split, waiting-vs-active time (from
 * total_on_hold_minutes), long-running/outlier tickets, recurring patterns, and a filterable
 * per-ticket table. Same population as getLeadCycleTimeReport's "lead" metric (basisFor("lead",
 * ...), gated on resolved_datetime falling in the period) so this reconciles with the scorecard
 * and with Cycle Time's own drill-down by construction.
 */
export async function getLeadTimeDeepDive(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<LeadTimeDeepDiveReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    const basis = basisFor("lead", teamConfig.has_peer_review_tracking);
    const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);

    const withDuration = rows
      .filter((r) => !isExcludedIssueType(team, r.issue_type))
      .filter((r) => {
        const bucketIso = toManilaDateString(basis.endedAt(r));
        return bucketIso && bucketIso >= startDate && bucketIso <= endDate;
      })
      .map((r) => ({ row: r, minutes: basis.duration(r) }))
      .filter((x): x is { row: TicketRow; minutes: number } => x.minutes !== null && isFinite(x.minutes));

    const count = withDuration.length;
    const minutesSorted = withDuration.map((x) => x.minutes).sort((a, b) => a - b);

    const medianMinutes = medianOf(minutesSorted);
    const avgMinutes = count ? round2(minutesSorted.reduce((s, v) => s + v, 0) / count) : null;
    const p75Minutes = percentile(minutesSorted, 75);
    const p90Minutes = count >= 10 ? percentile(minutesSorted, 90) : null;
    const p95Minutes = count >= 20 ? percentile(minutesSorted, 95) : null;

    const pulse: LeadTimePulse = { count, medianMinutes, avgMinutes, p75Minutes, p90Minutes };
    const percentiles: LeadTimePercentiles = { p50: medianMinutes, p75: p75Minutes, p90: p90Minutes, p95: p95Minutes };

    const distribution: LeadTimeDistributionBucket[] = DISTRIBUTION_BUCKETS.map((b) => {
      const c = withDuration.filter((x) => {
        const days = x.minutes / 1440;
        return days >= b.minDays && (b.maxDays === null || days < b.maxDays);
      }).length;
      return { label: b.label, minDays: b.minDays, maxDays: b.maxDays, count: c, share: count ? round4(c / count) : null };
    });

    // "Long-running": above P90 when the sample supports one, else 2x the median.
    const longRunningThreshold = p90Minutes ?? (medianMinutes !== null ? medianMinutes * 2 : null);

    const buckets = leadTimeEnumerateBuckets(range, startDate, endDate);
    const byBucket = new Map<string, { count: number; sum: number; values: number[] }>();
    for (const b of buckets) byBucket.set(b, { count: 0, sum: 0, values: [] });
    for (const x of withDuration) {
      const iso = toManilaDateString(basis.endedAt(x.row));
      if (!iso) continue;
      const b = byBucket.get(leadTimeBucketKeyFor(range, iso));
      if (!b) continue;
      b.count++;
      b.sum += x.minutes;
      b.values.push(x.minutes);
    }
    const trend: LeadTimeTrendPoint[] = buckets.map((key) => {
      const b = byBucket.get(key)!;
      return {
        bucket: key,
        count: b.count,
        medianMinutes: medianOf(b.values.slice().sort((a, c) => a - c)),
        avgMinutes: b.count ? round2(b.sum / b.count) : null,
      };
    });

    const breakdownBy = (keyFn: (r: TicketRow) => string): LeadTimeBreakdownRow[] => {
      const groups = new Map<string, number[]>();
      for (const x of withDuration) {
        const key = keyFn(x.row) || "(none)";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(x.minutes);
      }
      return Array.from(groups.entries())
        .map(([key, values]) => {
          const sorted = values.slice().sort((a, b) => a - b);
          return {
            key,
            count: values.length,
            medianMinutes: medianOf(sorted),
            avgMinutes: round2(values.reduce((s, v) => s + v, 0) / values.length),
            p75Minutes: percentile(sorted, 75),
            p90Minutes: values.length >= 10 ? percentile(sorted, 90) : null,
            longRunningCount: longRunningThreshold !== null ? values.filter((v) => v > longRunningThreshold).length : 0,
          };
        })
        .sort((a, b) => b.count - a.count); // impact (volume) first, not just avg
    };

    const byWorkType = breakdownBy((r) => r.issue_type || "(none)");
    const byProduct = breakdownBy((r) => r.product || "(none)");

    // Flow: Created -> first_out_of_backlog_todo -> Resolved. Requires the majority of this
    // period's tickets to carry first_out_of_backlog_todo, or the split isn't representative.
    const flowRows = withDuration.filter((x) => x.row.first_out_of_backlog_todo);
    const flowAvailable = flowRows.length > 0 && flowRows.length >= count * 0.5;
    const backlogWaitValues = flowAvailable
      ? flowRows.map((x) => minutesBetween(x.row.created, x.row.first_out_of_backlog_todo!)).filter((v) => isFinite(v) && v >= 0)
      : [];
    const activeReviewValues = flowAvailable
      ? flowRows.map((x) => minutesBetween(x.row.first_out_of_backlog_todo!, x.row.resolved_datetime!)).filter((v) => isFinite(v) && v >= 0)
      : [];
    const backlogWaitAvg = backlogWaitValues.length ? round2(backlogWaitValues.reduce((s, v) => s + v, 0) / backlogWaitValues.length) : null;
    const activeReviewAvg = activeReviewValues.length ? round2(activeReviewValues.reduce((s, v) => s + v, 0) / activeReviewValues.length) : null;
    const totalFlowAvg = (backlogWaitAvg ?? 0) + (activeReviewAvg ?? 0);

    const stages: LeadTimeFlowStage[] = flowAvailable
      ? [
          {
            key: "backlogWait",
            label: "Backlog / Queue Time — Created to Moved Out of To Do",
            avgMinutes: backlogWaitAvg,
            medianMinutes: medianOf(backlogWaitValues.slice().sort((a, b) => a - b)),
            shareOfLeadTime: totalFlowAvg ? round4((backlogWaitAvg ?? 0) / totalFlowAvg) : null,
            count: backlogWaitValues.length,
          },
          {
            key: "activeAndReview",
            label: "Active + Review Time — Moved Out of To Do to Resolved",
            avgMinutes: activeReviewAvg,
            medianMinutes: medianOf(activeReviewValues.slice().sort((a, b) => a - b)),
            shareOfLeadTime: totalFlowAvg ? round4((activeReviewAvg ?? 0) / totalFlowAvg) : null,
            count: activeReviewValues.length,
          },
        ]
      : [];

    const holdValues = withDuration
      .map((x) => (x.row.total_on_hold_minutes !== null && x.row.total_on_hold_minutes !== undefined ? Number(x.row.total_on_hold_minutes) : null))
      .filter((v): v is number => v !== null && isFinite(v));
    const waitingDataAvailable = holdValues.some((v) => v > 0);
    const waitingAvgMinutes = holdValues.length ? round2(holdValues.reduce((s, v) => s + v, 0) / holdValues.length) : null;
    const waitingMedianMinutes = medianOf(holdValues.slice().sort((a, b) => a - b));
    const waitingShareOfLeadTime = waitingDataAvailable && waitingAvgMinutes !== null && avgMinutes ? round4(waitingAvgMinutes / avgMinutes) : null;
    const activeValues = withDuration.map((x) => {
      const hold = x.row.total_on_hold_minutes !== null && x.row.total_on_hold_minutes !== undefined ? Number(x.row.total_on_hold_minutes) : 0;
      return Math.max(0, x.minutes - (isFinite(hold) ? hold : 0));
    });
    const activeAvgMinutes = waitingDataAvailable && activeValues.length ? round2(activeValues.reduce((s, v) => s + v, 0) / activeValues.length) : null;
    const activeMedianMinutes = waitingDataAvailable ? medianOf(activeValues.slice().sort((a, b) => a - b)) : null;

    const flow: LeadTimeFlow = {
      available: flowAvailable,
      stages,
      waitingAvgMinutes: waitingDataAvailable ? waitingAvgMinutes : null,
      waitingMedianMinutes: waitingDataAvailable ? waitingMedianMinutes : null,
      waitingShareOfLeadTime,
      activeAvgMinutes,
      activeMedianMinutes,
      waitingDataAvailable,
    };

    const longRunningAll = longRunningThreshold !== null ? withDuration.filter((x) => x.minutes > longRunningThreshold) : [];
    const longRunningTotalCount = longRunningAll.length;
    const longRunning: LeadTimeOutlier[] =
      longRunningThreshold !== null
        ? longRunningAll
            .slice()
            .sort((a, b) => b.minutes - a.minutes)
            .slice(0, 20)
            .map((x) => ({
              issueKey: x.row.issue_key,
              issueType: x.row.issue_type || "",
              assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
              product: x.row.product || "(none)",
              labels: x.row.labels || "",
              createdAt: x.row.created,
              resolvedAt: x.row.resolved_datetime || "",
              minutes: round2(x.minutes),
              vsMedianMinutes: medianMinutes !== null ? round2(x.minutes - medianMinutes) : null,
              vsMedianPct: medianMinutes ? round4((x.minutes - medianMinutes) / medianMinutes) : null,
              holdingReasons: holdingReasonsOfRow(x.row.holding_reasons_json),
            }))
        : [];

    const patterns: LeadTimePattern[] = [
      ...byWorkType
        .filter((r) => r.count >= 3 && medianMinutes !== null && (r.medianMinutes ?? 0) > medianMinutes * 1.25)
        .map((r) => ({ dimension: "Work Type" as const, key: r.key, count: r.count, medianMinutes: r.medianMinutes, p90Minutes: r.p90Minutes })),
      ...byProduct
        .filter((r) => r.count >= 3 && medianMinutes !== null && (r.medianMinutes ?? 0) > medianMinutes * 1.25)
        .map((r) => ({ dimension: "Product" as const, key: r.key, count: r.count, medianMinutes: r.medianMinutes, p90Minutes: r.p90Minutes })),
    ]
      .sort((a, b) => (b.medianMinutes ?? 0) - (a.medianMinutes ?? 0))
      .slice(0, 8);

    let comparison: LeadTimeComparison | null = null;
    try {
      const prevPeriod = shiftPeriod(range as RangeType, period, -1);
      const prev = await summarizeLeadTimePeriod(team, range, prevPeriod, issueType, teamConfig);
      comparison = {
        count: { current: count, previous: prev.count, deltaPct: pctDelta(count, prev.count) },
        medianMinutes: { current: medianMinutes, previous: prev.medianMinutes, deltaPct: pctDelta(medianMinutes, prev.medianMinutes) },
        avgMinutes: { current: avgMinutes, previous: prev.avgMinutes, deltaPct: pctDelta(avgMinutes, prev.avgMinutes) },
        p90Minutes: { current: p90Minutes, previous: prev.p90Minutes, deltaPct: pctDelta(p90Minutes, prev.p90Minutes) },
      };
    } catch {
      comparison = null;
    }

    const tickets: LeadTimeTicketRow[] = withDuration
      .slice()
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, BREAKDOWN_TICKET_LIMIT)
      .map((x) => {
        const hold = x.row.total_on_hold_minutes !== null && x.row.total_on_hold_minutes !== undefined ? Number(x.row.total_on_hold_minutes) : null;
        const holdMinutes = hold !== null && isFinite(hold) ? hold : null;
        return {
          issueKey: x.row.issue_key,
          issueType: x.row.issue_type || "",
          assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
          product: x.row.product || "(none)",
          labels: x.row.labels || "",
          createdAt: x.row.created,
          resolvedAt: x.row.resolved_datetime || "",
          minutes: round2(x.minutes),
          waitingMinutes: holdMinutes !== null ? round2(holdMinutes) : null,
          activeMinutes: holdMinutes !== null ? round2(Math.max(0, x.minutes - holdMinutes)) : null,
          vsMedianMinutes: medianMinutes !== null ? round2(x.minutes - medianMinutes) : null,
        };
      });

    const report: LeadTimeDeepDiveReport = {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      description: basis.description,
      pulse,
      comparison,
      insights: [],
      positiveHighlights: [],
      trend,
      distribution,
      percentiles,
      byWorkType,
      byProduct,
      flow,
      longRunning,
      longRunningTotalCount,
      patterns,
      tickets,
      ticketsTotalCount: withDuration.length,
    };

    report.insights = buildLeadTimeInsights(report);
    report.positiveHighlights = buildLeadTimePositiveHighlights(report);

    return report;
  } catch {
    return emptyDeepDive(team, range, period, issueType);
  }
}
