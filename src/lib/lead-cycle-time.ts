import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, backlogAgingAssignee, backlogAgingAssigneeLabel, excludedIssueTypes, isExcludedIssueType } from "@/lib/teams";
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
};

const SELECT_COLUMNS =
  "issue_key,issue_type,created,first_out_of_backlog_todo,resolved_datetime,cycle_time_start,cycle_time_end,product,labels,assigned_se,assigned_cod,peer_review_cycles_json";

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
