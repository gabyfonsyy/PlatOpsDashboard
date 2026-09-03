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
import { BACKEND_EXECUTION_ISSUE_TYPES } from "@/lib/tool-assisted";

export type LeadCycleTimeMetric = "lead" | "cycle";

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
  /** Set only on byWorkType rows for a peer-review team viewing "All SE Work" (no workCategory
   * selected) — which work category this issue type belongs to, so the breakdown table can group
   * Backend Changes and Investigations under their own subheaders instead of interleaving them.
   * Null everywhere else (byProduct, byAssignee, a non-split team, or a single category already
   * selected) — mirrors CycleTimeBreakdownRow.category exactly, same reasoning. */
  category: CycleTimeWorkCategory | null;
  /** Set only on byAssignee rows for a peer-review team viewing "All SE Work" — this person's
   * Backend Changes vs. Investigations split (e.g. "78% Backend / 22% Investigations"), so an
   * individual's Lead Time is never read without knowing what kind of work makes it up (brief
   * section 19 — comparing a mostly-Investigations person against a mostly-Backend-Changes person
   * without this context would be misleading). Null everywhere else. */
  categoryMixLabel: string | null;
};

/** Backend Changes vs. Investigations vs. Other, at a glance, over the FULL (unfiltered-by-
 * category) population for the period — mirrors CycleTimeCategorySummary but with Lead Time's own
 * metric set (median/avg/p75/p90/longest, no doer/validator split — that split lives on the Cycle
 * Time page, not here). Only populated when hasWorkCategorySplit && workCategory is unset (the
 * "All SE Work" view) — a single-category view already IS that category's numbers. */
export type LeadTimeCategorySummary = {
  category: CycleTimeWorkCategory | "other";
  label: string;
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  p75Minutes: number | null;
  p90Minutes: number | null;
  longestMinutes: number | null;
};

/**
 * Lead Time's "Active Work" context (brief sections 5/6/12) — the REAL Cycle Time for this same
 * scope (basisFor("cycle", ...), reusing summarizeCycleTimePeriod so this can never disagree with
 * the Cycle Time deep-dive it points to), shown here only as a contextual comparison against Lead
 * Time, never as a second Doer/Validator breakdown (that stays on the Cycle Time page — section 6:
 * "do not duplicate the Cycle Time analysis").
 */
export type LeadTimeActiveWorkContext = {
  /** "doer-validator" (SE, All Work or Backend Changes) / "doer-only" (SE, Investigations) /
   * "single" (a team with no peer-review split at all) — same three-way model getCycleTimeDeepDive
   * uses, so this page's copy can distinguish "Cycle Time" from "Doer Cycle Time" correctly. */
  workflowModel: "doer-validator" | "doer-only" | "single";
  cycleAvgMinutes: number | null;
  cycleMedianMinutes: number | null;
  /** Null unless workflowModel is "doer-validator". */
  doerAvgMinutes: number | null;
  /** Null unless workflowModel is "doer-validator". */
  validatorAvgMinutes: number | null;
  /** cycleAvgMinutes / (this scope's) Lead Time avgMinutes, clamped to [0,1]. Null when either
   * side is missing. The "only ~30% of elapsed time was active work" figure from the brief. */
  activeSharePct: number | null;
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
  /** True for a peer-review team (SE) — the Work Category dimension (Backend Changes vs.
   * Investigations) only exists for these teams. False for DBA/DevOps, same as
   * teamConfig.has_peer_review_tracking. */
  hasWorkCategorySplit: boolean;
  /** The category this report is scoped to, or null for "All SE Work" (every category pooled).
   * Always null for a team without the split. */
  workCategory: CycleTimeWorkCategory | null;
  /** Backend Changes vs. Investigations at a glance — ONLY populated for a peer-review team with
   * workCategory unset (the "All SE Work" view); null otherwise. */
  categoryComparison: LeadTimeCategorySummary[] | null;
  pulse: LeadTimePulse;
  comparison: LeadTimeComparison | null;
  /** Real Cycle Time for this same scope, shown as context next to Lead Time — never a second
   * Doer/Validator breakdown (see LeadTimeActiveWorkContext's doc comment). Null only if the
   * Cycle Time lookup itself failed. */
  activeWork: LeadTimeActiveWorkContext | null;
  /** "Is this a work-time problem or a waiting problem?" (brief section 11) — always computed
   * when activeWork is available, rendered directly under the Lead Time vs. Active Work
   * comparison rather than competing for a slot in the generic insights list below. */
  activeVsWaitingInsight: LeadTimeInsight | null;
  insights: LeadTimeInsight[];
  positiveHighlights: LeadTimePositiveHighlight[];
  trend: LeadTimeTrendPoint[];
  distribution: LeadTimeDistributionBucket[];
  percentiles: LeadTimePercentiles;
  byWorkType: LeadTimeBreakdownRow[];
  byProduct: LeadTimeBreakdownRow[];
  /** Individual (assignee) breakdown — sorted by ticket VOLUME, never by speed, so this can't
   * read as a "who's slowest" leaderboard (brief section 19). Empty when the population has no
   * assignable rows. */
  byAssignee: LeadTimeBreakdownRow[];
  flow: LeadTimeFlow;
  /** Displayed table — capped to the top 20 by duration. */
  longRunning: LeadTimeOutlier[];
  /** True count of tickets above the long-running threshold, uncapped — see longRunning's cap. */
  longRunningTotalCount: number;
  patterns: LeadTimePattern[];
  tickets: LeadTimeTicketRow[];
  ticketsTotalCount: number;
};

function emptyDeepDive(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  workCategory?: CycleTimeWorkCategory
): LeadTimeDeepDiveReport {
  return {
    team, range, period, issueType: issueType ?? null,
    assigneeLabel: "Assignee",
    description: "",
    hasWorkCategorySplit: false,
    workCategory: workCategory ?? null,
    categoryComparison: null,
    pulse: { count: 0, medianMinutes: null, avgMinutes: null, p75Minutes: null, p90Minutes: null },
    comparison: null,
    activeWork: null,
    activeVsWaitingInsight: null,
    insights: [],
    positiveHighlights: [],
    trend: [],
    distribution: [],
    percentiles: { p50: null, p75: null, p90: null, p95: null },
    byWorkType: [],
    byProduct: [],
    byAssignee: [],
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

/** Backend Changes vs. Investigations vs. Other, over an unfiltered-by-category duration set —
 * see LeadTimeCategorySummary's doc comment. Shared by getLeadTimeDeepDive's single call site;
 * pulled out as its own function since the row-shaping logic doesn't belong inline. */
function buildLeadTimeCategoryComparison(rows: { row: TicketRow; minutes: number }[]): LeadTimeCategorySummary[] {
  const groups: Record<"backend" | "investigations" | "other", number[]> = { backend: [], investigations: [], other: [] };
  for (const x of rows) {
    const cat = cycleTimeWorkCategoryFor(x.row.issue_type);
    groups[cat ?? "other"].push(x.minutes);
  }
  const labelFor = (cat: "backend" | "investigations" | "other") =>
    cat === "backend" ? "Backend Changes" : cat === "investigations" ? "Investigations" : "Other";
  return (["backend", "investigations", "other"] as const)
    .map((cat): LeadTimeCategorySummary | null => {
      const values = groups[cat];
      if (!values.length) return null;
      const sorted = values.slice().sort((a, b) => a - b);
      return {
        category: cat,
        label: labelFor(cat),
        count: values.length,
        medianMinutes: medianOf(sorted),
        avgMinutes: round2(values.reduce((s, v) => s + v, 0) / values.length),
        p75Minutes: percentile(sorted, 75),
        p90Minutes: values.length >= 10 ? percentile(sorted, 90) : null,
        longestMinutes: round2(sorted[sorted.length - 1]),
      };
    })
    .filter((s): s is LeadTimeCategorySummary => s !== null);
}

/** Just enough of one period's Lead Time numbers to diff against another — mirrors lib/p1-sla.ts's summarizePeriod. */
async function summarizeLeadTimePeriod(
  team: string,
  range: string,
  period: string,
  issueType: string | undefined,
  teamConfig: TeamConfig,
  workCategory?: CycleTimeWorkCategory
): Promise<{ count: number; medianMinutes: number | null; avgMinutes: number | null; p90Minutes: number | null }> {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const basis = basisFor("lead", teamConfig.has_peer_review_tracking);
  const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);
  const effectiveCategory = teamConfig.has_peer_review_tracking ? workCategory : undefined;
  const minutes = rows
    .filter((r) => !isExcludedIssueType(team, r.issue_type))
    .filter((r) => !effectiveCategory || cycleTimeWorkCategoryFor(r.issue_type) === effectiveCategory)
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
  /** Only for a peer-review team scoped to Backend Changes — brief section 16: "is a Lead Time
   * change associated with active work increasing, waiting increasing, or work mix changing?" */
  categoryTrendDriver?: { currentActiveSharePct: number | null; previousActiveSharePct: number | null };
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

  const driver = report.categoryTrendDriver;
  if (driver && driver.currentActiveSharePct !== null && driver.previousActiveSharePct !== null) {
    const deltaPts = Math.round((driver.currentActiveSharePct - driver.previousActiveSharePct) * 1000) / 10;
    if (Math.abs(deltaPts) >= 8) {
      const activeUp = deltaPts > 0;
      const prevPct = Math.round(driver.previousActiveSharePct * 1000) / 10;
      const currPct = Math.round(driver.currentActiveSharePct * 1000) / 10;
      insights.push({
        text: {
          professional: `Active work's share of Lead Time moved from ${prevPct}% to ${currPct}% vs the previous period — ${
            activeUp ? "active work is taking up more of the elapsed time" : "waiting/other elapsed time is taking up more of it"
          }, which likely explains part of the change.`,
          gaby: activeUp
            ? `**Execution is eating more of the clock this period.** Active work's share of Lead Time went **${prevPct}% → ${currPct}%** — the work itself, not waiting, is what shifted.`
            : `**Waiting is eating more of the clock this period.** Active work's share of Lead Time dropped **${prevPct}% → ${currPct}%** — more of the elapsed time is going to waiting/other, not execution.`,
        },
        tone: "watch",
      });
    }
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
  issueType?: string,
  workCategory?: CycleTimeWorkCategory
): Promise<LeadTimeDeepDiveReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    // Work Category only exists for a peer-review team (SE) — a category param from a team
    // without the split is ignored defensively, same as the Cycle Time deep-dive.
    const hasWorkCategorySplit = teamConfig.has_peer_review_tracking;
    const effectiveWorkCategory = hasWorkCategorySplit ? workCategory : undefined;

    const basis = basisFor("lead", teamConfig.has_peer_review_tracking);
    const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);

    // The FULL period population, before any Work Category filter — kept around only to build
    // categoryComparison (Backend Changes vs. Investigations always reflects the whole team, even
    // when the rest of the page is scoped to one category). Everything else below reads `scoped`.
    const withDuration = rows
      .filter((r) => !isExcludedIssueType(team, r.issue_type))
      .filter((r) => {
        const bucketIso = toManilaDateString(basis.endedAt(r));
        return bucketIso && bucketIso >= startDate && bucketIso <= endDate;
      })
      .map((r) => ({ row: r, minutes: basis.duration(r) }))
      .filter((x): x is { row: TicketRow; minutes: number } => x.minutes !== null && isFinite(x.minutes));

    const categoryComparison =
      hasWorkCategorySplit && !effectiveWorkCategory ? buildLeadTimeCategoryComparison(withDuration) : null;

    const scoped = effectiveWorkCategory
      ? withDuration.filter((x) => cycleTimeWorkCategoryFor(x.row.issue_type) === effectiveWorkCategory)
      : withDuration;

    const count = scoped.length;
    const minutesSorted = scoped.map((x) => x.minutes).sort((a, b) => a - b);

    const medianMinutes = medianOf(minutesSorted);
    const avgMinutes = count ? round2(minutesSorted.reduce((s, v) => s + v, 0) / count) : null;
    const p75Minutes = percentile(minutesSorted, 75);
    const p90Minutes = count >= 10 ? percentile(minutesSorted, 90) : null;
    const p95Minutes = count >= 20 ? percentile(minutesSorted, 95) : null;

    const pulse: LeadTimePulse = { count, medianMinutes, avgMinutes, p75Minutes, p90Minutes };
    const percentiles: LeadTimePercentiles = { p50: medianMinutes, p75: p75Minutes, p90: p90Minutes, p95: p95Minutes };

    const distribution: LeadTimeDistributionBucket[] = DISTRIBUTION_BUCKETS.map((b) => {
      const c = scoped.filter((x) => {
        const days = x.minutes / 1440;
        return days >= b.minDays && (b.maxDays === null || days < b.maxDays);
      }).length;
      return { label: b.label, minDays: b.minDays, maxDays: b.maxDays, count: c, share: count ? round4(c / count) : null };
    });

    // "Long-running": above P90 when the sample supports one, else 2x the median. Threshold is
    // relative to the SCOPED population, so "long-running" for Investigations means long relative
    // to other Investigations, not to the pooled All-SE-Work distribution.
    const longRunningThreshold = p90Minutes ?? (medianMinutes !== null ? medianMinutes * 2 : null);

    const buckets = leadTimeEnumerateBuckets(range, startDate, endDate);
    const byBucket = new Map<string, { count: number; sum: number; values: number[] }>();
    for (const b of buckets) byBucket.set(b, { count: 0, sum: 0, values: [] });
    for (const x of scoped) {
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

    const breakdownBy = (
      keyFn: (r: TicketRow) => string,
      opts?: { withCategory?: boolean; withCategoryMix?: boolean }
    ): LeadTimeBreakdownRow[] => {
      const groups = new Map<string, { values: number[]; rows: TicketRow[] }>();
      for (const x of scoped) {
        const key = keyFn(x.row) || "(none)";
        if (!groups.has(key)) groups.set(key, { values: [], rows: [] });
        const g = groups.get(key)!;
        g.values.push(x.minutes);
        g.rows.push(x.row);
      }
      return Array.from(groups.entries())
        .map(([key, g]) => {
          const sorted = g.values.slice().sort((a, b) => a - b);
          // Backend Changes / Investigations split for this group — only meaningful on the "All
          // SE Work" view (a single category already selected makes this redundant per-row).
          const category = opts?.withCategory ? cycleTimeWorkCategoryFor(key) : null;
          let categoryMixLabel: string | null = null;
          if (opts?.withCategoryMix) {
            const backendCount = g.rows.filter((r) => cycleTimeWorkCategoryFor(r.issue_type) === "backend").length;
            const investigationsCount = g.rows.filter((r) => cycleTimeWorkCategoryFor(r.issue_type) === "investigations").length;
            const classified = backendCount + investigationsCount;
            categoryMixLabel = classified
              ? `${Math.round((backendCount / classified) * 100)}% Backend / ${Math.round((investigationsCount / classified) * 100)}% Investigations`
              : null;
          }
          return {
            key,
            count: g.values.length,
            medianMinutes: medianOf(sorted),
            avgMinutes: round2(g.values.reduce((s, v) => s + v, 0) / g.values.length),
            p75Minutes: percentile(sorted, 75),
            p90Minutes: g.values.length >= 10 ? percentile(sorted, 90) : null,
            longRunningCount: longRunningThreshold !== null ? g.values.filter((v) => v > longRunningThreshold).length : 0,
            category,
            categoryMixLabel,
          };
        })
        .sort((a, b) => b.count - a.count); // impact (volume) first, not just avg
    };

    const byWorkType = breakdownBy((r) => r.issue_type || "(none)", { withCategory: hasWorkCategorySplit && !effectiveWorkCategory });
    const byProduct = breakdownBy((r) => r.product || "(none)");
    // Individual breakdown, sorted by volume (breakdownBy's own convention) not speed — see the
    // LeadTimeBreakdownRow.categoryMixLabel doc comment for why the mix matters here (brief section 19).
    const byAssignee = breakdownBy((r) => backlogAgingAssignee(teamConfig, r) || "(unassigned)", {
      withCategoryMix: hasWorkCategorySplit && !effectiveWorkCategory,
    });

    // Flow: Created -> first_out_of_backlog_todo -> Resolved. Requires the majority of this
    // period's tickets to carry first_out_of_backlog_todo, or the split isn't representative.
    const flowRows = scoped.filter((x) => x.row.first_out_of_backlog_todo);
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

    const holdValues = scoped
      .map((x) => (x.row.total_on_hold_minutes !== null && x.row.total_on_hold_minutes !== undefined ? Number(x.row.total_on_hold_minutes) : null))
      .filter((v): v is number => v !== null && isFinite(v));
    const waitingDataAvailable = holdValues.some((v) => v > 0);
    const waitingAvgMinutes = holdValues.length ? round2(holdValues.reduce((s, v) => s + v, 0) / holdValues.length) : null;
    const waitingMedianMinutes = medianOf(holdValues.slice().sort((a, b) => a - b));
    const waitingShareOfLeadTime = waitingDataAvailable && waitingAvgMinutes !== null && avgMinutes ? round4(waitingAvgMinutes / avgMinutes) : null;
    const activeValues = scoped.map((x) => {
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

    const longRunningAll = longRunningThreshold !== null ? scoped.filter((x) => x.minutes > longRunningThreshold) : [];
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
    // Only meaningful for a peer-review team — see the "categoryTrendDriver" insight rule.
    let previousActiveSharePct: number | null = null;
    try {
      const prevPeriod = shiftPeriod(range as RangeType, period, -1);
      const prev = await summarizeLeadTimePeriod(team, range, prevPeriod, issueType, teamConfig, effectiveWorkCategory);
      comparison = {
        count: { current: count, previous: prev.count, deltaPct: pctDelta(count, prev.count) },
        medianMinutes: { current: medianMinutes, previous: prev.medianMinutes, deltaPct: pctDelta(medianMinutes, prev.medianMinutes) },
        avgMinutes: { current: avgMinutes, previous: prev.avgMinutes, deltaPct: pctDelta(avgMinutes, prev.avgMinutes) },
        p90Minutes: { current: p90Minutes, previous: prev.p90Minutes, deltaPct: pctDelta(p90Minutes, prev.p90Minutes) },
      };
      if (hasWorkCategorySplit) {
        const prevCycle = await summarizeCycleTimePeriod(team, range, prevPeriod, issueType, teamConfig, effectiveWorkCategory);
        previousActiveSharePct =
          prevCycle.totalAvgMinutes !== null && prev.avgMinutes ? round4(Math.min(1, prevCycle.totalAvgMinutes / prev.avgMinutes)) : null;
      }
    } catch {
      comparison = null;
    }

    // Active Work context (brief sections 5/6/12) — the REAL Cycle Time for this same scope,
    // reusing summarizeCycleTimePeriod so this can never disagree with the Cycle Time deep-dive.
    // Shown only as a contextual comparison against Lead Time, never a second Doer/Validator
    // breakdown (section 6: "do not duplicate the Cycle Time analysis").
    let activeWork: LeadTimeActiveWorkContext | null = null;
    let activeVsWaitingInsight: LeadTimeInsight | null = null;
    try {
      const cycleSummary = await summarizeCycleTimePeriod(team, range, period, issueType, teamConfig, effectiveWorkCategory);
      const workflowModel: LeadTimeActiveWorkContext["workflowModel"] = !hasWorkCategorySplit
        ? "single"
        : effectiveWorkCategory === "investigations"
          ? "doer-only"
          : "doer-validator";
      const activeSharePct =
        cycleSummary.totalAvgMinutes !== null && avgMinutes ? round4(Math.min(1, cycleSummary.totalAvgMinutes / avgMinutes)) : null;
      activeWork = {
        workflowModel,
        cycleAvgMinutes: cycleSummary.totalAvgMinutes,
        cycleMedianMinutes: cycleSummary.totalMedianMinutes,
        doerAvgMinutes: cycleSummary.doerAvgMinutes,
        validatorAvgMinutes: cycleSummary.validatorAvgMinutes,
        activeSharePct,
      };

      if (activeSharePct !== null) {
        const pct = Math.round(activeSharePct * 1000) / 10;
        const cycleLabel = workflowModel === "doer-only" ? "Active investigation work" : "Cycle Time (active work)";
        if (pct < 40) {
          activeVsWaitingInsight = {
            text: {
              professional: `${cycleLabel} accounts for only ~${pct}% of Lead Time — most of the elapsed time is happening outside active execution (waiting, queued, or between stages).`,
              gaby: `**🫠 Waiting is driving elapsed time here, not the work itself.** ${cycleLabel} is only **~${pct}%** of Lead Time — the rest is holding pattern, not hands-on-keyboard time.`,
            },
            tone: "watch",
          };
        } else if (pct >= 60) {
          activeVsWaitingInsight = {
            text: {
              professional: `${cycleLabel} accounts for ~${pct}% of Lead Time — active work, not waiting, is the main driver of how long tickets take.`,
              gaby: `**🚀 Active work is what's driving elapsed time here.** ${cycleLabel} makes up **~${pct}%** of Lead Time — this isn't a waiting problem, it's a work-time problem.`,
            },
            tone: "watch",
          };
        } else {
          activeVsWaitingInsight = {
            text: {
              professional: `${cycleLabel} accounts for ~${pct}% of Lead Time — a mix of active work and waiting/other elapsed time, with neither clearly dominant.`,
              gaby: `**Elapsed time is a mixed bag here.** ${cycleLabel} is **~${pct}%** of Lead Time — no single driver stands out.`,
            },
            tone: "watch",
          };
        }
      }
    } catch {
      activeWork = null;
      activeVsWaitingInsight = null;
    }

    const tickets: LeadTimeTicketRow[] = scoped
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
      hasWorkCategorySplit,
      workCategory: effectiveWorkCategory ?? null,
      categoryComparison,
      pulse,
      comparison,
      activeWork,
      activeVsWaitingInsight,
      insights: [],
      positiveHighlights: [],
      trend,
      distribution,
      percentiles,
      byWorkType,
      byProduct,
      byAssignee,
      flow,
      longRunning,
      longRunningTotalCount,
      patterns,
      tickets,
      ticketsTotalCount: scoped.length,
    };

    report.insights = buildLeadTimeInsights({
      ...report,
      categoryTrendDriver: { currentActiveSharePct: activeWork?.activeSharePct ?? null, previousActiveSharePct },
    });
    report.positiveHighlights = buildLeadTimePositiveHighlights(report);

    return report;
  } catch {
    return emptyDeepDive(team, range, period, issueType, workCategory);
  }
}

// ==================================================================================
// Cycle Time deep-dive (metric === "cycle") — same pulse -> trend -> distribution ->
// breakdown -> longest-work -> patterns -> details shape as the Lead Time deep-dive
// above, but for a peer-review team (has_peer_review_tracking, i.e. SE/ST) it also
// decomposes every number into DOER (execution, cycle_time_start -> cycle_time_end)
// vs. VALIDATOR (peer_review_cycles_json) — see basisFor's peer-review branch and
// sumPeerReviewMinutes. DBA/DevOps have no such split; hasDoerValidatorSplit is false
// for them and every doer/validator field is null, never a fabricated zero.
//
// A THIRD dimension sits inside the SE split itself: Backend Changes (Doer -> Validator) vs.
// Investigations (Doer only — no review stage). getCycleTimeDeepDive's optional `workCategory`
// parameter re-scopes the entire report to one of them (see cycleTimeWorkCategoryFor), and
// reuses the exact same split/non-split machinery above — scoped to Investigations, a population
// where nothing ever has a validatorMinutes value trivially produces showSplit=false and every
// "Total" is already exactly "Doer" per-ticket, with no zero-filling required to make it so.
// ==================================================================================

export type CycleTimeWorkCategory = "backend" | "investigations";

/**
 * Ends its review path at For Checking, never at For Peer Review — see
 * BACKEND_EXECUTION_ISSUE_TYPES's doc comment in lib/tool-assisted.ts, which is the source of
 * truth for the OTHER half of this same split and is imported here rather than re-typed so the
 * two pages can never disagree about which issue types get a Validator stage.
 */
const INVESTIGATION_ISSUE_TYPES = ["Investigation", "Data Generation", "External Support Request", "Team Viewer"];

const BACKEND_CATEGORY_LOOKUP = new Set(BACKEND_EXECUTION_ISSUE_TYPES.map((t) => t.toLowerCase()));
const INVESTIGATION_CATEGORY_LOOKUP = new Set(INVESTIGATION_ISSUE_TYPES.map((t) => t.toLowerCase()));

/** Null for an issue type in neither list (e.g. a type introduced after this was written) —
 * excluded from category-specific views/summaries rather than guessed into one. */
export function cycleTimeWorkCategoryFor(issueType: string | null | undefined): CycleTimeWorkCategory | null {
  const normalized = (issueType || "").trim().toLowerCase();
  if (BACKEND_CATEGORY_LOOKUP.has(normalized)) return "backend";
  if (INVESTIGATION_CATEGORY_LOOKUP.has(normalized)) return "investigations";
  return null;
}

export type CycleTimeStat = {
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  p75Minutes: number | null;
  /** Null below a 10-ticket sample. */
  p90Minutes: number | null;
};

function statOf(values: number[]): CycleTimeStat {
  const sorted = values.slice().sort((a, b) => a - b);
  const count = values.length;
  return {
    count,
    medianMinutes: medianOf(sorted),
    avgMinutes: count ? round2(values.reduce((s, v) => s + v, 0) / count) : null,
    p75Minutes: percentile(sorted, 75),
    p90Minutes: count >= 10 ? percentile(sorted, 90) : null,
  };
}

export type CycleTimePulse = {
  count: number;
  /**
   * Every field here is computed from the REAL per-ticket total (doerMinutes + validatorMinutes,
   * treating "never reviewed" as 0) — EXCEPT avgMinutes, which is deliberately overridden to
   * doer.avgMinutes + validator.avgMinutes (see below). That is the same "sum of two group
   * averages" the team-page scorecard already uses (getPeerReviewCycleAverages /
   * getLeadCycleTimeAverages), so this page's headline average can never disagree with the
   * scorecard card it's linked from. Median/P75/P90 don't have that constraint (percentiles of a
   * sum aren't the sum of percentiles regardless of convention), so those come straight off the
   * true per-ticket totals.
   */
  total: CycleTimeStat;
  /** Over every ticket in the population — every ticket in scope has a doer span by definition. */
  doer: CycleTimeStat | null;
  /**
   * Over only the tickets that actually had a closed peer-review cycle (see sumPeerReviewMinutes).
   * Deliberately NOT zero-filled for tickets that skipped review — that would drag the median/P90
   * down and understate how long review takes when it happens. `count` here is therefore the
   * "reviewed" count, not the population count (that's doer.count / pulse.count).
   */
  validator: CycleTimeStat | null;
  /** doer.avgMinutes / total.avgMinutes. Null for teams without the split. */
  doerSharePct: number | null;
  /** (validator.avgMinutes ?? 0) / total.avgMinutes. Null for teams without the split. */
  validatorSharePct: number | null;
};

type CycleTimeMetricDelta = { current: number | null; previous: number | null; deltaPct: number | null };

export type CycleTimeComparison = {
  count: { current: number; previous: number; deltaPct: number | null };
  totalMedianMinutes: CycleTimeMetricDelta;
  totalAvgMinutes: CycleTimeMetricDelta;
  totalP90Minutes: CycleTimeMetricDelta;
  /** Null for teams without the Doer/Validator split. */
  doerMedianMinutes: CycleTimeMetricDelta | null;
  doerAvgMinutes: CycleTimeMetricDelta | null;
  validatorMedianMinutes: CycleTimeMetricDelta | null;
  validatorAvgMinutes: CycleTimeMetricDelta | null;
};

export type CycleTimeTrendPoint = {
  bucket: string;
  count: number;
  medianTotalMinutes: number | null;
  avgTotalMinutes: number | null;
  /** Null for teams without the split. */
  medianDoerMinutes: number | null;
  avgDoerMinutes: number | null;
  medianValidatorMinutes: number | null;
  avgValidatorMinutes: number | null;
};

export type CycleTimeDistributionBucket = { label: string; minDays: number; maxDays: number | null; count: number; share: number | null };

export type CycleTimeDistributions = {
  total: CycleTimeDistributionBucket[];
  /** Null for teams without the split. Doer is over the full population; Validator is over the
   * reviewed-only subset — same reasoning as CycleTimePulse.validator. */
  doer: CycleTimeDistributionBucket[] | null;
  validator: CycleTimeDistributionBucket[] | null;
};

export type CycleTimePercentileSet = { p50: number | null; p75: number | null; p90: number | null; p95: number | null };

export type CycleTimePercentiles = {
  total: CycleTimePercentileSet;
  doer: CycleTimePercentileSet | null;
  validator: CycleTimePercentileSet | null;
};

export type CycleTimeBreakdownRow = {
  key: string;
  count: number;
  /** Null for teams without the split. */
  avgDoerMinutes: number | null;
  /** Null when nothing in this group was ever reviewed (or the team has no split). */
  avgValidatorMinutes: number | null;
  /** avgDoerMinutes + (avgValidatorMinutes ?? 0) — see CycleTimePulse.total's doc comment. */
  avgTotalMinutes: number | null;
  medianTotalMinutes: number | null;
  p90TotalMinutes: number | null;
  /** Tickets in this group above the report's long-running threshold (see longRunningThreshold). */
  longRunningCount: number;
  /** Set only on byTicketType rows for a peer-review team viewing "All SE Work" (no workCategory
   * selected) — which of the two SE work models this issue type belongs to, so the breakdown
   * table can group Backend Changes and Investigations under their own subheaders instead of
   * interleaving a doer-only row among doer+validator ones. Null everywhere else (byProduct,
   * byAssignee, DBA/DevOps, or when a single category is already selected). */
  category: CycleTimeWorkCategory | null;
};

export type CycleTimeCategorySummary = {
  category: CycleTimeWorkCategory | "other";
  label: string;
  count: number;
  avgTotalMinutes: number | null;
  medianTotalMinutes: number | null;
  /** Backend Changes only — null for "investigations" and "other". */
  avgDoerMinutes: number | null;
  avgValidatorMinutes: number | null;
};

export type CycleTimeTicketOutlier = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  labels: string;
  createdAt: string;
  startedAt: string;
  resolvedAt: string;
  doerMinutes: number;
  /** Null when this ticket never had a closed peer-review cycle (or the team has no split). */
  validatorMinutes: number | null;
  totalMinutes: number;
  vsMedianTotalMinutes: number | null;
  vsMedianTotalPct: number | null;
  /** Which side dominates this ticket's own total — null when the team has no split, or the two
   * sides are within 30% of each other (genuinely balanced, not worth naming a "primary" side). */
  dominant: "doer" | "validator" | "balanced" | null;
};

export type CycleTimePattern = {
  dimension: "Ticket Type" | "Product";
  key: string;
  count: number;
  medianTotalMinutes: number | null;
  p90TotalMinutes: number | null;
};

export type CycleTimeTicketRow = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  labels: string;
  createdAt: string;
  startedAt: string;
  resolvedAt: string;
  doerMinutes: number;
  validatorMinutes: number | null;
  totalMinutes: number;
  vsMedianTotalMinutes: number | null;
};

export type CycleTimeDeepDiveReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  assigneeLabel: string;
  description: string;
  /**
   * True when THIS POPULATION has a Doer/Validator split to show — gates every doer/validator
   * field and section. False for DBA/DevOps (the team has no split at all) AND for SE scoped to
   * Investigations (the team has one, but Investigations don't go through review) — see
   * `workCategory` and `workflowModel` to tell those two cases apart for copy purposes.
   */
  hasDoerValidatorSplit: boolean;
  /**
   * "doer-validator" when this population's Cycle Time decomposes (SE, All Work or Backend
   * Changes) — same as hasDoerValidatorSplit true. "doer-only" when the team has the split but
   * this population structurally doesn't (SE scoped to Investigations) — Doer = Total, and the
   * page should say so rather than rendering a generic single "Cycle Time" as if this were
   * DBA/DevOps. "single" when the team has no split at all (DBA/DevOps).
   */
  workflowModel: "doer-validator" | "doer-only" | "single";
  /** The category this report is scoped to, or null for "All SE Work" (every category pooled).
   * Always null for a team without the split. */
  workCategory: CycleTimeWorkCategory | null;
  /** Backend Changes vs. Investigations (vs. "other" if any issue type falls in neither list) at
   * a glance — ONLY populated for a peer-review team with workCategory unset (the "All SE Work"
   * view); null otherwise, since a single-category view already IS that category's numbers. */
  categoryComparison: CycleTimeCategorySummary[] | null;
  startColumnLabel: string;
  endColumnLabel: string;
  pulse: CycleTimePulse;
  comparison: CycleTimeComparison | null;
  /** "Where is the time going?" dominant-contributor read — always present when hasDoerValidatorSplit,
   * shown directly under the Doer/Validator breakdown bar rather than folded into `insights`. */
  doerValidatorInsight: LeadTimeInsight | null;
  insights: LeadTimeInsight[];
  positiveHighlights: LeadTimePositiveHighlight[];
  trend: CycleTimeTrendPoint[];
  distribution: CycleTimeDistributions;
  percentiles: CycleTimePercentiles;
  byTicketType: CycleTimeBreakdownRow[];
  byProduct: CycleTimeBreakdownRow[];
  /** Individual (Assigned SE) breakdown — empty for teams without the split. Sorted by ticket
   * volume, not by speed, so this can't read as a leaderboard. */
  byAssignee: CycleTimeBreakdownRow[];
  /** Top 20 by Doer minutes. Empty for teams without the split. */
  longestToExecute: CycleTimeTicketOutlier[];
  longestToExecuteTotalCount: number;
  /** Top 20 by Validator minutes, over reviewed tickets only. Empty for teams without the split. */
  longestToValidate: CycleTimeTicketOutlier[];
  longestToValidateTotalCount: number;
  /** Top 20 by Total minutes, ABOVE the period's long-running threshold — merges "longest overall"
   * and "outlier analysis" into one table, same call as the Lead Time deep-dive's longRunning. For
   * a team without the split this is the page's only "longest work" table. */
  longestEndToEnd: CycleTimeTicketOutlier[];
  longestEndToEndTotalCount: number;
  patterns: CycleTimePattern[];
  tickets: CycleTimeTicketRow[];
  ticketsTotalCount: number;
};

function emptyCycleTimeDeepDive(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  workCategory?: CycleTimeWorkCategory
): CycleTimeDeepDiveReport {
  const emptyStat: CycleTimeStat = { count: 0, medianMinutes: null, avgMinutes: null, p75Minutes: null, p90Minutes: null };
  const emptyPct: CycleTimePercentileSet = { p50: null, p75: null, p90: null, p95: null };
  return {
    team, range, period, issueType: issueType ?? null,
    assigneeLabel: "Assignee",
    description: "",
    hasDoerValidatorSplit: false,
    workflowModel: "single",
    workCategory: workCategory ?? null,
    categoryComparison: null,
    startColumnLabel: "Started",
    endColumnLabel: "Ended",
    pulse: { count: 0, total: emptyStat, doer: null, validator: null, doerSharePct: null, validatorSharePct: null },
    comparison: null,
    doerValidatorInsight: null,
    insights: [],
    positiveHighlights: [],
    trend: [],
    distribution: { total: [], doer: null, validator: null },
    percentiles: { total: emptyPct, doer: null, validator: null },
    byTicketType: [],
    byProduct: [],
    byAssignee: [],
    longestToExecute: [],
    longestToExecuteTotalCount: 0,
    longestToValidate: [],
    longestToValidateTotalCount: 0,
    longestEndToEnd: [],
    longestEndToEndTotalCount: 0,
    patterns: [],
    tickets: [],
    ticketsTotalCount: 0,
  };
}

/** One ticket in the Cycle Time deep-dive's working population, with its span already split. */
type CycleTimeRow = {
  row: TicketRow;
  doerMinutes: number;
  /** Null when the team has no split, or this ticket never had a closed peer-review cycle. */
  validatorMinutes: number | null;
  /** doerMinutes + (validatorMinutes ?? 0) — real per-ticket total, always defined. */
  totalMinutes: number;
};

/**
 * Filters `rows` to the period/exclusion rules every other function in this file already applies,
 * then splits each ticket's duration into doer/validator/total. Shared by getCycleTimeDeepDive and
 * summarizeCycleTimePeriod (the previous-period comparison) so both read the exact same population.
 */
function cycleTimeRowsFor(
  rows: TicketRow[],
  team: string,
  hasSplit: boolean,
  basis: ReturnType<typeof basisFor>,
  startDate: string,
  endDate: string
): CycleTimeRow[] {
  const out: CycleTimeRow[] = [];
  for (const r of rows) {
    if (isExcludedIssueType(team, r.issue_type)) continue;
    const bucketIso = toManilaDateString(basis.endedAt(r));
    if (!bucketIso || bucketIso < startDate || bucketIso > endDate) continue;
    const doerMinutes = basis.duration(r);
    if (doerMinutes === null || !isFinite(doerMinutes)) continue;
    const validatorMinutes = hasSplit ? sumPeerReviewMinutes(r.peer_review_cycles_json) : null;
    out.push({
      row: r,
      doerMinutes: round2(doerMinutes),
      validatorMinutes,
      totalMinutes: round2(doerMinutes + (validatorMinutes ?? 0)),
    });
  }
  return out;
}

/** doer.avgMinutes + validator.avgMinutes, the sum-of-group-averages convention — see CycleTimePulse.total. */
function combinedAvg(doerAvg: number | null, validatorAvg: number | null): number | null {
  if (doerAvg !== null && validatorAvg !== null) return round2(doerAvg + validatorAvg);
  return doerAvg ?? validatorAvg;
}

function cycleTimeDistributionOf(values: number[]): CycleTimeDistributionBucket[] {
  const count = values.length;
  return DISTRIBUTION_BUCKETS.map((b) => {
    const c = values.filter((v) => {
      const days = v / 1440;
      return days >= b.minDays && (b.maxDays === null || days < b.maxDays);
    }).length;
    return { label: b.label, minDays: b.minDays, maxDays: b.maxDays, count: c, share: count ? round4(c / count) : null };
  });
}

function cycleTimePercentilesOf(values: number[]): CycleTimePercentileSet {
  const sorted = values.slice().sort((a, b) => a - b);
  const count = values.length;
  return {
    p50: medianOf(sorted),
    p75: percentile(sorted, 75),
    p90: count >= 10 ? percentile(sorted, 90) : null,
    p95: count >= 20 ? percentile(sorted, 95) : null,
  };
}

/** Just enough of one period's Cycle Time numbers to diff against another — mirrors summarizeLeadTimePeriod. */
async function summarizeCycleTimePeriod(
  team: string,
  range: string,
  period: string,
  issueType: string | undefined,
  teamConfig: TeamConfig,
  workCategory?: CycleTimeWorkCategory
): Promise<{
  count: number;
  totalMedianMinutes: number | null;
  totalAvgMinutes: number | null;
  totalP90Minutes: number | null;
  doerMedianMinutes: number | null;
  doerAvgMinutes: number | null;
  validatorMedianMinutes: number | null;
  validatorAvgMinutes: number | null;
}> {
  const hasSplit = teamConfig.has_peer_review_tracking;
  const showSplit = hasSplit && workCategory !== "investigations";
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const basis = basisFor("cycle", hasSplit);
  const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);
  let cRows = cycleTimeRowsFor(rows, team, hasSplit, basis, startDate, endDate);
  if (workCategory) cRows = cRows.filter((x) => cycleTimeWorkCategoryFor(x.row.issue_type) === workCategory);

  const doerStat = statOf(cRows.map((x) => x.doerMinutes));
  const validatorValues = cRows.map((x) => x.validatorMinutes).filter((v): v is number => v !== null);
  const validatorStat = showSplit ? statOf(validatorValues) : null;
  const totalReal = statOf(cRows.map((x) => x.totalMinutes));

  return {
    count: cRows.length,
    totalMedianMinutes: totalReal.medianMinutes,
    totalAvgMinutes: showSplit ? combinedAvg(doerStat.avgMinutes, validatorStat?.avgMinutes ?? null) : totalReal.avgMinutes,
    totalP90Minutes: totalReal.p90Minutes,
    doerMedianMinutes: showSplit ? doerStat.medianMinutes : null,
    doerAvgMinutes: showSplit ? doerStat.avgMinutes : null,
    validatorMedianMinutes: showSplit ? validatorStat?.medianMinutes ?? null : null,
    validatorAvgMinutes: showSplit ? validatorStat?.avgMinutes ?? null : null,
  };
}

/**
 * Backend Changes vs. Investigations at a glance, over the FULL (unfiltered-by-category)
 * population — the "All SE Work" composition summary from the brief (sections 1/5/9/13). Computed
 * once, before the report's own cRows gets narrowed to a single category, so this always reflects
 * the whole team regardless of which category (if any) the rest of the page is scoped to.
 *
 * "other" only appears when an issue type in scope matches neither list — surfaced rather than
 * silently dropped, same "hiding data invites suspicion" rule the Tool-Assisted page follows for
 * its own thin samples.
 */
function buildCategoryComparison(allRows: CycleTimeRow[]): CycleTimeCategorySummary[] {
  const groups: Record<"backend" | "investigations" | "other", CycleTimeRow[]> = { backend: [], investigations: [], other: [] };
  for (const x of allRows) {
    const cat = cycleTimeWorkCategoryFor(x.row.issue_type);
    groups[cat ?? "other"].push(x);
  }

  const summaryFor = (category: CycleTimeWorkCategory | "other", label: string): CycleTimeCategorySummary | null => {
    const groupRows = groups[category];
    if (!groupRows.length) return null;
    const totalStat = statOf(groupRows.map((x) => x.totalMinutes));
    if (category === "investigations" || category === "other") {
      return {
        category, label, count: groupRows.length,
        avgTotalMinutes: totalStat.avgMinutes, medianTotalMinutes: totalStat.medianMinutes,
        avgDoerMinutes: null, avgValidatorMinutes: null,
      };
    }
    const doerAvg = round2(groupRows.reduce((s, x) => s + x.doerMinutes, 0) / groupRows.length);
    const validatorValues = groupRows.map((x) => x.validatorMinutes).filter((v): v is number => v !== null);
    const validatorAvg = validatorValues.length ? round2(validatorValues.reduce((s, v) => s + v, 0) / validatorValues.length) : null;
    return {
      category, label, count: groupRows.length,
      avgTotalMinutes: combinedAvg(doerAvg, validatorAvg), medianTotalMinutes: totalStat.medianMinutes,
      avgDoerMinutes: doerAvg, avgValidatorMinutes: validatorAvg,
    };
  };

  return [
    summaryFor("backend", "Backend Changes"),
    summaryFor("investigations", "Investigations"),
    summaryFor("other", "Other"),
  ].filter((s): s is CycleTimeCategorySummary => s !== null);
}

/**
 * Rules-based, mirroring buildLeadTimeInsights exactly in spirit: never free-text/LLM-generated,
 * each rule fires only when its own numeric condition is true, capped at 5. Ordered: overall
 * direction, long tail, doer-vs-validator trend driver (split teams only), concentration in a
 * ticket type, recurring pattern.
 */
function buildCycleTimeInsights(report: {
  hasDoerValidatorSplit: boolean;
  pulse: CycleTimePulse;
  comparison: CycleTimeComparison | null;
  byTicketType: CycleTimeBreakdownRow[];
  patterns: CycleTimePattern[];
  longestEndToEndTotalCount: number;
}): LeadTimeInsight[] {
  const insights: LeadTimeInsight[] = [];
  const c = report.comparison;

  if (
    c &&
    c.totalMedianMinutes.current !== null &&
    c.totalMedianMinutes.previous !== null &&
    c.totalMedianMinutes.deltaPct !== null &&
    Math.abs(c.totalMedianMinutes.deltaPct) >= 0.05
  ) {
    const improved = c.totalMedianMinutes.deltaPct < 0;
    const pct = Math.round(Math.abs(c.totalMedianMinutes.deltaPct) * 1000) / 10;
    const prev = fmtDaysShort(c.totalMedianMinutes.previous);
    const curr = fmtDaysShort(c.totalMedianMinutes.current);
    insights.push({
      text: {
        professional: `Median Cycle Time ${improved ? "improved" : "increased"} from ${prev} to ${curr} (${improved ? "-" : "+"}${pct}%) vs the previous period.`,
        gaby: improved
          ? `**📈 Mission trajectory looks good.** Median Cycle Time dropped from **${prev} → ${curr}** (${pct}% faster) compared with the previous period.`
          : `**⚠️ We're drifting off course.** Median Cycle Time went from **${prev} → ${curr}** (${pct}% slower) vs the previous period.`,
      },
      tone: improved ? "positive" : "negative",
    });
  }

  if (
    report.pulse.total.medianMinutes !== null &&
    report.pulse.total.p90Minutes !== null &&
    report.pulse.total.p90Minutes > report.pulse.total.medianMinutes * 2
  ) {
    const p90 = fmtDaysShort(report.pulse.total.p90Minutes);
    const median = fmtDaysShort(report.pulse.total.medianMinutes);
    insights.push({
      text: {
        professional: `P90 Cycle Time is ${p90} despite a ${median} median — a long tail of slow-moving work is pulling the average up.`,
        gaby: `**👀 Most tickets move fast, but a few are dragging things out.** P90 sits at **${p90}** against a **${median}** median.`,
      },
      tone: "watch",
    });
  }

  if (
    report.hasDoerValidatorSplit &&
    c?.doerMedianMinutes &&
    c?.validatorMedianMinutes &&
    c.doerMedianMinutes.deltaPct !== null &&
    c.validatorMedianMinutes.deltaPct !== null &&
    (Math.abs(c.doerMedianMinutes.deltaPct) >= 0.1 || Math.abs(c.validatorMedianMinutes.deltaPct) >= 0.1)
  ) {
    const doerMoved = Math.abs(c.doerMedianMinutes.deltaPct) >= 0.1;
    const validatorMoved = Math.abs(c.validatorMedianMinutes.deltaPct) >= 0.1;
    const doerDominant = Math.abs(c.doerMedianMinutes.deltaPct) > Math.abs(c.validatorMedianMinutes.deltaPct);
    if (doerMoved && !validatorMoved) {
      const pct = Math.round(Math.abs(c.doerMedianMinutes.deltaPct) * 1000) / 10;
      const dir = c.doerMedianMinutes.deltaPct > 0 ? "increased" : "decreased";
      insights.push({
        text: {
          professional: `Doer (execution) time ${dir} ${pct}% vs the previous period while Validator (review) time stayed roughly flat — execution is driving the change in Cycle Time.`,
          gaby: `**🚀 Execution is what moved this period.** Doer time ${dir} **${pct}%** while Validation stayed roughly flat.`,
        },
        tone: c.doerMedianMinutes.deltaPct > 0 ? "negative" : "positive",
      });
    } else if (validatorMoved && !doerMoved) {
      const pct = Math.round(Math.abs(c.validatorMedianMinutes.deltaPct) * 1000) / 10;
      const dir = c.validatorMedianMinutes.deltaPct > 0 ? "increased" : "decreased";
      insights.push({
        text: {
          professional: `Validator (review) time ${dir} ${pct}% vs the previous period while Doer (execution) time stayed roughly flat — validation is driving the change in Cycle Time.`,
          gaby: `**🛰️ Validation is what moved this period.** Review time ${dir} **${pct}%** while execution stayed roughly flat.`,
        },
        tone: c.validatorMedianMinutes.deltaPct > 0 ? "negative" : "positive",
      });
    } else if (doerMoved && validatorMoved) {
      const bigger = doerDominant ? "Doer (execution)" : "Validator (review)";
      insights.push({
        text: {
          professional: `Both Doer and Validator time shifted this period, with ${bigger} moving more — the larger driver of the change in Cycle Time.`,
          gaby: `**Both sides shifted this period** — ${bigger.toLowerCase()} moved the most, so that's the bigger driver of the change.`,
        },
        tone: "watch",
      });
    }
  }

  const topLongRunning = report.byTicketType.filter((r) => r.longRunningCount > 0).sort((a, b) => b.longRunningCount - a.longRunningCount)[0];
  const totalLongRunning = report.longestEndToEndTotalCount;
  if (topLongRunning && totalLongRunning >= 3 && topLongRunning.longRunningCount / totalLongRunning >= 0.4) {
    insights.push({
      text: {
        professional: `"${topLongRunning.key}" accounts for ${topLongRunning.longRunningCount} of the ${totalLongRunning} unusually long-running tickets this period.`,
        gaby: `**🚩 "${topLongRunning.key}" is doing more than its share.** It accounts for **${topLongRunning.longRunningCount} of ${totalLongRunning}** unusually long-running tickets this period.`,
      },
      tone: "watch",
    });
  }

  if (report.patterns.length) {
    const p = report.patterns[0];
    const median = fmtDaysShort(p.medianTotalMinutes ?? 0);
    const smallSample = p.count < 10;
    insights.push({
      text: {
        professional: `Recurring pattern: ${p.dimension === "Ticket Type" ? "ticket type" : "product"} "${p.key}" (${p.count} tickets) runs a ${median} median Cycle Time, notably above the overall median.`,
        gaby: `**A pattern worth knowing about.** "${p.key}" (**${p.count}** tickets) consistently runs a **${median}** median Cycle Time.${
          smallSample ? " Small sample — a signal, not a conclusion yet." : ""
        }`,
      },
      tone: "watch",
    });
  }

  if (!insights.length && report.pulse.count > 0) {
    insights.push({
      text: {
        professional: "Cycle Time is stable and consistent this period — no significant shifts or long-tail concentration detected.",
        gaby: "**Nothing jumping out this period.** Cycle Time's steady — no long tail, no volume spike, no recurring slow pattern.",
      },
      tone: "positive",
    });
  }

  return insights.slice(0, 5);
}

/**
 * The one insight the brief asks to always answer — "where is the time going?" — separate from
 * buildCycleTimeInsights above so it can sit directly under the Doer/Validator breakdown bar
 * rather than compete for a slot in the general "What Should I Know?" list. Always present for a
 * split team with data (not gated on a magnitude threshold, unlike the rules above), because the
 * page's whole point is answering this specific question.
 */
function buildDoerValidatorInsight(pulse: CycleTimePulse): LeadTimeInsight | null {
  if (pulse.doerSharePct === null || pulse.validatorSharePct === null) return null;
  const doerPct = Math.round(pulse.doerSharePct * 1000) / 10;
  const validatorPct = Math.round(pulse.validatorSharePct * 1000) / 10;
  const balanced = Math.abs(doerPct - validatorPct) <= 10;

  if (balanced) {
    return {
      text: {
        professional: `Execution and validation contribute almost equally to total Cycle Time (${doerPct}% vs ${validatorPct}%).`,
        gaby: `**⚖️ Pretty balanced mission.** Execution and validation are contributing almost equally to total Cycle Time.`,
      },
      tone: "watch",
    };
  }
  if (doerPct > validatorPct) {
    return {
      text: {
        professional: `Execution is the larger contributor to Cycle Time. Doer time accounts for ${doerPct}% of total Cycle Time.`,
        gaby: `**🚀 Execution is eating most of the mission time.** Doer work accounts for **${doerPct}%** of total Cycle Time.`,
      },
      tone: "watch",
    };
  }
  return {
    text: {
      professional: `Validation is the larger contributor to Cycle Time. Validator time accounts for ${validatorPct}% of total Cycle Time.`,
      gaby: `**🛰️ Validation is holding us in orbit.** ${validatorPct}% of total Cycle Time is being spent in review.`,
    },
    tone: "watch",
  };
}

function buildCycleTimePositiveHighlights(report: {
  comparison: CycleTimeComparison | null;
  byTicketType: CycleTimeBreakdownRow[];
  byProduct: CycleTimeBreakdownRow[];
}): LeadTimePositiveHighlight[] {
  const highlights: LeadTimePositiveHighlight[] = [];
  const c = report.comparison;

  if (c && c.totalMedianMinutes.deltaPct !== null && c.totalMedianMinutes.deltaPct <= -0.05) {
    highlights.push({
      label: "Faster delivery",
      detail: `Median Cycle Time down ${Math.round(Math.abs(c.totalMedianMinutes.deltaPct) * 1000) / 10}% vs the previous period.`,
    });
  }

  const consistent = [...report.byTicketType, ...report.byProduct]
    .filter((r) => r.count >= 5 && r.medianTotalMinutes !== null && r.medianTotalMinutes > 0 && r.p90TotalMinutes !== null)
    .sort((a, b) => a.p90TotalMinutes! / a.medianTotalMinutes! - b.p90TotalMinutes! / b.medianTotalMinutes!)[0];
  if (consistent) {
    highlights.push({ label: "Most consistent", detail: `${consistent.key} — ${consistent.count} tickets, tight spread between median and P90 Cycle Time.` });
  }

  return highlights.slice(0, 3);
}

/**
 * The Cycle Time drill-down's full deep-dive — pulse (with Doer/Validator decomposition for a
 * peer-review team), trend, distribution, breakdown by ticket type/product/assignee, three
 * "longest work" rankings (Execute/Validate/End-to-End, the last merged with outlier analysis),
 * recurring patterns, and a filterable per-ticket table. Same population as basisFor("cycle", ...)
 * — cycle_time_start -> cycle_time_end for a peer-review team, first_out_of_backlog_todo ->
 * resolved_datetime otherwise — so this reconciles with the team-page scorecard and with Lead
 * Time's own drill-down by construction.
 */
export async function getCycleTimeDeepDive(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  workCategory?: CycleTimeWorkCategory
): Promise<CycleTimeDeepDiveReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    // hasSplit: does the TEAM have peer-review tracking at all (SE/ST) — gates cycleTimeRowsFor's
    // attempt to read peer_review_cycles_json, and whether the category comparison/toggle apply.
    // showSplit: does THIS population (after any category scoping) have a split to DISPLAY — false
    // for DBA/DevOps and for SE narrowed to Investigations, which structurally never has a
    // Validator. Every doer/validator computation below gates on showSplit, not hasSplit.
    const hasSplit = teamConfig.has_peer_review_tracking;
    const showSplit = hasSplit && workCategory !== "investigations";
    const basis = basisFor("cycle", hasSplit);
    const rows = await fetchTicketsInRange(team, basis.dateColumn, startDate, endDate, issueType);
    const allTeamRows = cycleTimeRowsFor(rows, team, hasSplit, basis, startDate, endDate);

    // Computed from the FULL team population, before any category filter narrows cRows below —
    // this is what makes "All SE Work" able to say what it's composed of.
    const categoryComparison = hasSplit && !workCategory ? buildCategoryComparison(allTeamRows) : null;

    const cRows = workCategory ? allTeamRows.filter((x) => cycleTimeWorkCategoryFor(x.row.issue_type) === workCategory) : allTeamRows;

    const count = cRows.length;
    const totalValues = cRows.map((x) => x.totalMinutes);
    const doerValues = cRows.map((x) => x.doerMinutes);
    const validatorMeasured = cRows.map((x) => x.validatorMinutes).filter((v): v is number => v !== null);

    const doerStat = showSplit ? statOf(doerValues) : null;
    const validatorStat = showSplit ? statOf(validatorMeasured) : null;
    const totalStatReal = statOf(totalValues);
    const totalAvg = showSplit ? combinedAvg(doerStat!.avgMinutes, validatorStat!.avgMinutes) : totalStatReal.avgMinutes;
    const totalStat: CycleTimeStat = { ...totalStatReal, avgMinutes: totalAvg };

    const doerSharePct = showSplit && doerStat!.avgMinutes !== null && totalAvg ? round4(doerStat!.avgMinutes / totalAvg) : null;
    const validatorSharePct = showSplit && totalAvg ? round4((validatorStat!.avgMinutes ?? 0) / totalAvg) : null;

    const pulse: CycleTimePulse = { count, total: totalStat, doer: doerStat, validator: validatorStat, doerSharePct, validatorSharePct };

    const percentiles: CycleTimePercentiles = {
      total: cycleTimePercentilesOf(totalValues),
      doer: showSplit ? cycleTimePercentilesOf(doerValues) : null,
      validator: showSplit ? cycleTimePercentilesOf(validatorMeasured) : null,
    };
    const distribution: CycleTimeDistributions = {
      total: cycleTimeDistributionOf(totalValues),
      doer: showSplit ? cycleTimeDistributionOf(doerValues) : null,
      validator: showSplit ? cycleTimeDistributionOf(validatorMeasured) : null,
    };

    // "Long-running": above P90 when the sample supports one, else 2x the median — same rule as
    // the Lead Time deep-dive, applied to the real per-ticket TOTAL.
    const longRunningThreshold = totalStatReal.p90Minutes ?? (totalStatReal.medianMinutes !== null ? totalStatReal.medianMinutes * 2 : null);

    const buckets = leadTimeEnumerateBuckets(range, startDate, endDate);
    const byBucket = new Map<string, { count: number; total: number[]; doer: number[]; validator: number[] }>();
    for (const b of buckets) byBucket.set(b, { count: 0, total: [], doer: [], validator: [] });
    for (const x of cRows) {
      const iso = toManilaDateString(basis.endedAt(x.row));
      if (!iso) continue;
      const b = byBucket.get(leadTimeBucketKeyFor(range, iso));
      if (!b) continue;
      b.count++;
      b.total.push(x.totalMinutes);
      b.doer.push(x.doerMinutes);
      if (x.validatorMinutes !== null) b.validator.push(x.validatorMinutes);
    }
    const trend: CycleTimeTrendPoint[] = buckets.map((key) => {
      const b = byBucket.get(key)!;
      const doerStatB = showSplit ? statOf(b.doer) : null;
      const validatorStatB = showSplit ? statOf(b.validator) : null;
      return {
        bucket: key,
        count: b.count,
        medianTotalMinutes: medianOf(b.total.slice().sort((a, c) => a - c)),
        avgTotalMinutes: showSplit ? combinedAvg(doerStatB!.avgMinutes, validatorStatB!.avgMinutes) : b.count ? round2(b.total.reduce((s, v) => s + v, 0) / b.count) : null,
        medianDoerMinutes: showSplit ? doerStatB!.medianMinutes : null,
        avgDoerMinutes: showSplit ? doerStatB!.avgMinutes : null,
        medianValidatorMinutes: showSplit ? validatorStatB!.medianMinutes : null,
        avgValidatorMinutes: showSplit ? validatorStatB!.avgMinutes : null,
      };
    });

    const breakdownBy = (keyFn: (r: TicketRow) => string): CycleTimeBreakdownRow[] => {
      const groups = new Map<string, CycleTimeRow[]>();
      for (const x of cRows) {
        const key = keyFn(x.row) || "(none)";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(x);
      }
      return Array.from(groups.entries())
        .map(([key, groupRows]) => {
          const groupTotals = groupRows.map((x) => x.totalMinutes);
          const sortedTotals = groupTotals.slice().sort((a, b) => a - b);
          const groupDoerAvg = showSplit ? round2(groupRows.reduce((s, x) => s + x.doerMinutes, 0) / groupRows.length) : null;
          const groupValidatorValues = groupRows.map((x) => x.validatorMinutes).filter((v): v is number => v !== null);
          const groupValidatorAvg = showSplit && groupValidatorValues.length ? round2(groupValidatorValues.reduce((s, v) => s + v, 0) / groupValidatorValues.length) : null;
          return {
            key,
            count: groupRows.length,
            avgDoerMinutes: groupDoerAvg,
            avgValidatorMinutes: groupValidatorAvg,
            avgTotalMinutes: showSplit ? combinedAvg(groupDoerAvg, groupValidatorAvg) : round2(groupTotals.reduce((s, v) => s + v, 0) / groupTotals.length),
            medianTotalMinutes: medianOf(sortedTotals),
            p90TotalMinutes: groupTotals.length >= 10 ? percentile(sortedTotals, 90) : null,
            longRunningCount: longRunningThreshold !== null ? groupTotals.filter((v) => v > longRunningThreshold).length : 0,
            category: null as CycleTimeWorkCategory | null,
          };
        })
        .sort((a, b) => b.count - a.count); // impact (volume) first, not just avg
    };

    // Category tag only makes sense keyed on issue type — set here rather than inside the generic
    // breakdownBy above, which byProduct/byAssignee also call with a key that isn't an issue type.
    const byTicketType = breakdownBy((r) => r.issue_type || "(none)").map((row) => ({ ...row, category: cycleTimeWorkCategoryFor(row.key) }));
    const byProduct = breakdownBy((r) => r.product || "(none)");
    const byAssignee = showSplit ? breakdownBy((r) => backlogAgingAssignee(teamConfig, r) || "(unassigned)") : [];

    const toOutlier = (x: CycleTimeRow): CycleTimeTicketOutlier => {
      const validator = x.validatorMinutes;
      let dominant: CycleTimeTicketOutlier["dominant"] = null;
      if (showSplit) {
        const v = validator ?? 0;
        if (x.doerMinutes > v * 1.3) dominant = "doer";
        else if (v > x.doerMinutes * 1.3) dominant = "validator";
        else dominant = "balanced";
      }
      return {
        issueKey: x.row.issue_key,
        issueType: x.row.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
        product: x.row.product || "(none)",
        labels: x.row.labels || "",
        createdAt: x.row.created,
        startedAt: basis.startedAt(x.row),
        resolvedAt: basis.endedAt(x.row),
        doerMinutes: x.doerMinutes,
        validatorMinutes: validator,
        totalMinutes: x.totalMinutes,
        vsMedianTotalMinutes: totalStatReal.medianMinutes !== null ? round2(x.totalMinutes - totalStatReal.medianMinutes) : null,
        vsMedianTotalPct: totalStatReal.medianMinutes ? round4((x.totalMinutes - totalStatReal.medianMinutes) / totalStatReal.medianMinutes) : null,
        dominant,
      };
    };

    const longestToExecute = showSplit
      ? cRows.slice().sort((a, b) => b.doerMinutes - a.doerMinutes).slice(0, 20).map(toOutlier)
      : [];
    const reviewedRows = cRows.filter((x) => x.validatorMinutes !== null);
    const longestToValidate = showSplit
      ? reviewedRows.slice().sort((a, b) => (b.validatorMinutes ?? 0) - (a.validatorMinutes ?? 0)).slice(0, 20).map(toOutlier)
      : [];
    const longRunningAll = longRunningThreshold !== null ? cRows.filter((x) => x.totalMinutes > longRunningThreshold) : [];
    const longestEndToEnd = longRunningAll.slice().sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 20).map(toOutlier);

    const overallMedianTotal = totalStatReal.medianMinutes;
    const patterns: CycleTimePattern[] = [
      ...byTicketType
        .filter((r) => r.count >= 3 && overallMedianTotal !== null && (r.medianTotalMinutes ?? 0) > overallMedianTotal * 1.25)
        .map((r) => ({ dimension: "Ticket Type" as const, key: r.key, count: r.count, medianTotalMinutes: r.medianTotalMinutes, p90TotalMinutes: r.p90TotalMinutes })),
      ...byProduct
        .filter((r) => r.count >= 3 && overallMedianTotal !== null && (r.medianTotalMinutes ?? 0) > overallMedianTotal * 1.25)
        .map((r) => ({ dimension: "Product" as const, key: r.key, count: r.count, medianTotalMinutes: r.medianTotalMinutes, p90TotalMinutes: r.p90TotalMinutes })),
    ]
      .sort((a, b) => (b.medianTotalMinutes ?? 0) - (a.medianTotalMinutes ?? 0))
      .slice(0, 8);

    let comparison: CycleTimeComparison | null = null;
    try {
      const prevPeriod = shiftPeriod(range as RangeType, period, -1);
      const prev = await summarizeCycleTimePeriod(team, range, prevPeriod, issueType, teamConfig, workCategory);
      comparison = {
        count: { current: count, previous: prev.count, deltaPct: pctDelta(count, prev.count) },
        totalMedianMinutes: { current: totalStat.medianMinutes, previous: prev.totalMedianMinutes, deltaPct: pctDelta(totalStat.medianMinutes, prev.totalMedianMinutes) },
        totalAvgMinutes: { current: totalAvg, previous: prev.totalAvgMinutes, deltaPct: pctDelta(totalAvg, prev.totalAvgMinutes) },
        totalP90Minutes: { current: totalStat.p90Minutes, previous: prev.totalP90Minutes, deltaPct: pctDelta(totalStat.p90Minutes, prev.totalP90Minutes) },
        doerMedianMinutes: showSplit ? { current: doerStat!.medianMinutes, previous: prev.doerMedianMinutes, deltaPct: pctDelta(doerStat!.medianMinutes, prev.doerMedianMinutes) } : null,
        doerAvgMinutes: showSplit ? { current: doerStat!.avgMinutes, previous: prev.doerAvgMinutes, deltaPct: pctDelta(doerStat!.avgMinutes, prev.doerAvgMinutes) } : null,
        validatorMedianMinutes: showSplit
          ? { current: validatorStat!.medianMinutes, previous: prev.validatorMedianMinutes, deltaPct: pctDelta(validatorStat!.medianMinutes, prev.validatorMedianMinutes) }
          : null,
        validatorAvgMinutes: showSplit
          ? { current: validatorStat!.avgMinutes, previous: prev.validatorAvgMinutes, deltaPct: pctDelta(validatorStat!.avgMinutes, prev.validatorAvgMinutes) }
          : null,
      };
    } catch {
      comparison = null;
    }

    const tickets: CycleTimeTicketRow[] = cRows
      .slice()
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, BREAKDOWN_TICKET_LIMIT)
      .map((x) => ({
        issueKey: x.row.issue_key,
        issueType: x.row.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
        product: x.row.product || "(none)",
        labels: x.row.labels || "",
        createdAt: x.row.created,
        startedAt: basis.startedAt(x.row),
        resolvedAt: basis.endedAt(x.row),
        doerMinutes: x.doerMinutes,
        validatorMinutes: x.validatorMinutes,
        totalMinutes: x.totalMinutes,
        vsMedianTotalMinutes: totalStatReal.medianMinutes !== null ? round2(x.totalMinutes - totalStatReal.medianMinutes) : null,
      }));

    const report: CycleTimeDeepDiveReport = {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      description: basis.description,
      hasDoerValidatorSplit: showSplit,
      workflowModel: showSplit ? "doer-validator" : hasSplit ? "doer-only" : "single",
      workCategory: hasSplit ? (workCategory ?? null) : null,
      categoryComparison,
      startColumnLabel: basis.startColumnLabel,
      endColumnLabel: basis.endColumnLabel,
      pulse,
      comparison,
      doerValidatorInsight: showSplit ? buildDoerValidatorInsight(pulse) : null,
      insights: [],
      positiveHighlights: [],
      trend,
      distribution,
      percentiles,
      byTicketType,
      byProduct,
      byAssignee,
      longestToExecute,
      longestToExecuteTotalCount: showSplit ? cRows.length : 0,
      longestToValidate,
      longestToValidateTotalCount: showSplit ? reviewedRows.length : 0,
      longestEndToEnd,
      longestEndToEndTotalCount: longRunningAll.length,
      patterns,
      tickets,
      ticketsTotalCount: cRows.length,
    };

    report.insights = buildCycleTimeInsights(report);
    report.positiveHighlights = buildCycleTimePositiveHighlights(report);

    return report;
  } catch {
    return emptyCycleTimeDeepDive(team, range, period, issueType, workCategory);
  }
}
