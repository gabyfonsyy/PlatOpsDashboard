import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { getTeams, backlogAgingAssignee, isExcludedIssueType, type TeamConfig } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";
import { meaningfulLabels } from "@/lib/ticket-breakdowns";
import { automationLabelSet } from "@/lib/automation-labels";
import { P1_PRIORITY_VALUE } from "@/lib/p1-sla";
import { median } from "@/lib/stats";
import type { KpiBaselineRow } from "@/lib/kpi-baselines";

/**
 * Review Wait Time deep-dive (SE). One review cycle = one stay in "For Peer Review", from the
 * status change INTO it to the status change OUT of it, read from peer_review_cycles_json (see
 * gas/JiraSync.gs's extractPeerReviewCyclesWithReviewer_).
 *
 * Time basis is CALENDAR time (minutesBetween), deliberately — that's what SE Cycle Time uses
 * (lib/lead-cycle-time.ts, lib/business-review-cycle-time.ts), and the brief asks for the two to
 * stay comparable. This app has no business-hours calendar anywhere.
 *
 * Period membership is by the Manila date the cycle ENTERED review, same as the original
 * lib/peer-review.ts report. That's what makes Review Completion Rate ("of the reviews that
 * started this period, how many finished") well-defined.
 *
 * Every number on the page is computed from one fetch: all SE tickets that have ever been in
 * review (~5k rows). That's small enough to load whole, which is what lets the previous-period
 * comparison, the Q1+Q2 baseline, full-history rework counts, and the queue-depth-over-time line
 * all read the exact same population without extra round trips — and fixes the old report's
 * `created`-year bound, which silently dropped any ticket created in an earlier year than the one
 * its review happened in (e.g. ST-66311: created 2025-03, reviewed 2026-07).
 */

// ------------------------------------------------------------------------------ Cycle rules

/**
 * Exits that close a review for this metric, per the brief: On Hold, For Checking, Archived,
 * Rejected. Other real exits exist in the data (For Execution — handed back to the doer; For
 * Product Team) and are neither dropped nor called invalid: they're reported under Data Quality
 * as "other exits" so the counts reconcile.
 */
export const REVIEW_EXIT_STATUSES = ["on hold", "for checking", "archived", "rejected"] as const;

const REVIEW_EXIT_SET = new Set<string>(REVIEW_EXIT_STATUSES);

export type ReviewCycleKind = "completed" | "skipped" | "open" | "otherExit" | "invalid";

/**
 * A cycle that left For Peer Review in under this many minutes is a pass-through, not a review:
 * the status was clicked straight through (often by whoever held the ticket, or on an
 * automation-created Task), so nobody actually reviewed it. Confirmed with the user 2026-09-30 —
 * these are NOT counted anywhere: not in wait times, reviewer attribution, or review-cycle counts.
 * They're listed under Data Quality as "Skipped review" instead. Counting them had credited
 * reviews to the ticket's holder (e.g. the Assigned SE themselves, or "(unassigned)") and pulled
 * the median down (Sept 2026: 3.08h -> 3.49h once excluded).
 */
export const SKIPPED_REVIEW_MINUTES = 1;

export type PeerReviewCycleRaw = {
  enteredAt?: string | null;
  exitedAt?: string | null;
  exitedToStatus?: string | null;
  reviewer?: string | null;
  reviewerAtEntry?: string | null;
};

/**
 * The single classifier every Review Wait consumer uses (this module, lib/peer-review.ts, and
 * through it the Performance page's per-reviewer column), so no two views of this data can
 * disagree about which cycles count.
 */
export function classifyReviewCycle(c: PeerReviewCycleRaw): { kind: ReviewCycleKind; waitMinutes: number | null } {
  if (!c.enteredAt || isNaN(new Date(c.enteredAt).getTime())) return { kind: "invalid", waitMinutes: null };
  if (!c.exitedAt) return { kind: "open", waitMinutes: null };
  if (isNaN(new Date(c.exitedAt).getTime())) return { kind: "invalid", waitMinutes: null };
  const wait = minutesBetween(c.enteredAt, c.exitedAt);
  if (wait < 0) return { kind: "invalid", waitMinutes: null };
  if (!REVIEW_EXIT_SET.has((c.exitedToStatus || "").trim().toLowerCase())) return { kind: "otherExit", waitMinutes: round2(wait) };
  if (wait < SKIPPED_REVIEW_MINUTES) return { kind: "skipped", waitMinutes: round2(wait) };
  return { kind: "completed", waitMinutes: round2(wait) };
}

/** Same attribution rule as lib/peer-review.ts: reviewerAtEntry only, never `reviewer`. */
export const UNASSIGNED_REVIEWER = "(unassigned)";

// ------------------------------------------------------------------------------ Small helpers

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round4((current - previous) / previous);
}

/** Linear-interpolation percentile, same as lib/lead-cycle-time.ts's. */
function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return round2(sortedAsc[0]);
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round2(sortedAsc[lo]);
  return round2(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo));
}

function avgOf(values: number[]): number | null {
  return values.length ? round2(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

function medianOf(values: number[]): number | null {
  const m = median(values);
  return m === null ? null : round2(m);
}

function inRange(iso: string | null, startDate: string, endDate: string): boolean {
  return !!iso && iso >= startDate && iso <= endDate;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Manila wall-clock parts of a timestamp — for day-of-week / time-of-day segmentation. */
function manilaParts(iso: string): { dow: number; hour: number } {
  const d = new Date(new Date(iso).getTime() + MANILA_OFFSET_MS);
  return { dow: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() }; // dow: Mon=0..Sun=6
}

/** End of a Manila calendar day as a UTC instant. */
function manilaEndOfDay(isoDate: string): number {
  return new Date(`${isoDate}T23:59:59.999Z`).getTime() - MANILA_OFFSET_MS;
}

/** P90 needs a real sample to mean anything; below this it's reported as null (shown as "—"). */
export const P90_MIN_SAMPLE = 10;
/** Below this, rows are flagged "small sample" so a 2-review average can't pass for a trend. */
export const SMALL_SAMPLE = 5;

// ------------------------------------------------------------------------------ Data fetch

type TicketRow = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  priority: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
  reporter_display_name: string | null;
  due_date: string | null;
  resolved_datetime: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string | null;
  last_synced_at: string | null;
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

const SELECT =
  "issue_key,issue_type,status,priority,product,labels,assigned_se,assigned_cod,reporter_display_name,due_date,resolved_datetime,cycle_time_start,cycle_time_end,last_synced_at,peer_review_cycles_json";

/**
 * Every ticket of `team` that has ever been in review. The `neq '[]'` matters: the column is
 * non-null on ~86k ST rows but a real array on only ~5k, and without it the fetch is 16x bigger.
 * Ordered by issue_key (the primary key) — mandatory for fetchAllRowsParallel's page offsets.
 */
async function fetchReviewTickets(team: string): Promise<TicketRow[]> {
  return fetchAllRowsParallel<TicketRow>(
    (head) =>
      getSupabaseClient()
        .from("tickets")
        .select(SELECT, head ? { count: "exact", head: true } : undefined)
        .eq("team_key", team)
        .not("peer_review_cycles_json", "is", null)
        .neq("peer_review_cycles_json", "[]"),
    "issue_key"
  );
}

// ------------------------------------------------------------------------------ Types

export type ReviewWaitGrain = "day" | "week" | "month";

export type ReviewSlaFlag = {
  /** Resolved on a later calendar day than due, or still open and past due. Null = no due date. */
  overdue: boolean | null;
  /** Overdue AND priority is P1 — the P1 SLA Compliance report's breach rule. */
  p1Breach: boolean;
  /** Still open (so "overdue" means past due, not a final outcome). */
  open: boolean;
  label: string;
};

export type ReviewCycleDetail = {
  cycleIndex: number;
  reviewer: string;
  enteredAt: string;
  exitedAt: string | null;
  exitedToStatus: string;
  waitMinutes: number | null;
  kind: ReviewCycleKind;
};

type Cycle = ReviewCycleDetail & {
  ticket: TicketMeta;
  enteredDate: string;
  reviewerMissing: boolean;
};

type TicketMeta = {
  issueKey: string;
  issueType: string;
  status: string;
  priority: string;
  product: string;
  labels: string[];
  assignedSe: string;
  requester: string;
  dueDate: string | null;
  resolvedAt: string | null;
  doerMinutes: number | null;
  sla: ReviewSlaFlag;
  cycles: Cycle[];
};

export type ReviewWaitStats = {
  count: number;
  ticketCount: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p75Minutes: number | null;
  /** Null below P90_MIN_SAMPLE. */
  p90Minutes: number | null;
  withinTargetCount: number;
  /** 0-1. Null when there's no target or no reviews. */
  withinTargetPct: number | null;
};

type Delta = { current: number | null; previous: number | null; deltaPct: number | null };

export type ReviewWaitComparison = {
  previousPeriod: string;
  count: Delta;
  avgMinutes: Delta;
  medianMinutes: Delta;
  p90Minutes: Delta;
  withinTargetPct: Delta;
};

export type ReviewWaitTarget = {
  /** The threshold actually in use for "% within target" and "over target" counts. */
  minutes: number | null;
  source: "override" | "baseline" | "live-baseline" | "none";
  /** The Q1+Q2 2026 average, whichever way it was obtained (stored row or computed live). */
  baselineMinutes: number | null;
  baselineSampleCount: number;
  baselinePeriodLabel: string;
};

export type ReviewerRow = {
  name: string;
  reviews: number;
  tickets: number;
  /** 0-1 share of the team's completed reviews in the period. */
  volumeShare: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  longestMinutes: number | null;
  overTargetCount: number;
  overTargetPct: number | null;
  /** Context, not verdict: how many OTHER reviews were open at the moment each of theirs arrived, on average. */
  avgQueueDepthAtEntry: number | null;
  /** Context: share of their reviews on P1/P2 tickets. */
  urgentShare: number | null;
  /** Context: distinct SEs whose tickets they reviewed. */
  distinctSes: number;
  smallSample: boolean;
};

export type QueueTicket = {
  issueKey: string;
  reviewer: string;
  assignedSe: string;
  issueType: string;
  priority: string;
  enteredAt: string;
  ageMinutes: number;
  overTarget: boolean;
  cycleIndex: number;
};

export type ReviewQueueHealth = {
  /** Data freshness: the newest sync timestamp among queued tickets (the queue is as-of this). */
  asOf: string | null;
  count: number;
  avgAgeMinutes: number | null;
  medianAgeMinutes: number | null;
  oldest: QueueTicket | null;
  overTargetCount: number;
  tickets: QueueTicket[];
};

export type LongestReviewRow = {
  issueKey: string;
  issueType: string;
  product: string;
  labels: string[];
  requester: string;
  assignedSe: string;
  reviewer: string;
  enteredAt: string;
  exitedAt: string;
  waitMinutes: number;
  exitedToStatus: string;
  currentStatus: string;
  priority: string;
  sla: ReviewSlaFlag;
  cycleIndex: number;
  cycleCount: number;
  /** Sum of every completed review on this ticket, across its whole history. */
  totalReviewMinutes: number;
  /** waitMinutes / target — 2.0 means twice the target. Null without a target. */
  vsTarget: number | null;
  /** Every review cycle on the ticket, for the drill-down. */
  history: ReviewCycleDetail[];
};

export type SegmentDimension =
  | "reviewer"
  | "assignedSe"
  | "issueType"
  | "category"
  | "label"
  | "priority"
  | "requester"
  | "dayOfWeek"
  | "timeOfDay"
  | "month"
  | "quarter"
  | "outcome";

export type SegmentRow = {
  key: string;
  count: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  overTargetPct: number | null;
  smallSample: boolean;
};

export type ReviewInsight = { text: { professional: string; gaby: string }; tone: "positive" | "watch" | "negative" };

export type ReviewEfficiency = {
  /** Cycles that started in the period and exited (any exit) by its end, over cycles that started. */
  completion: { numerator: number; denominator: number; rate: number | null };
  /** Of tickets that reached For Checking: first review went straight to For Checking. */
  firstPass: { numerator: number; denominator: number; rate: number | null };
  /** Of tickets reviewed this period: needed more than one review cycle (whole history). */
  rework: { numerator: number; denominator: number; rate: number | null };
  /** Of tickets that reached For Checking: review cycles up to and including that one. */
  avgCyclesToForChecking: number | null;
  /** Sum of all completed reviews per ticket (whole history), over tickets reviewed this period. */
  totalReviewPerTicket: { avgMinutes: number | null; medianMinutes: number | null; count: number };
  singleCycle: { tickets: number; avgTotalMinutes: number | null };
  multiCycle: { tickets: number; avgTotalMinutes: number | null };
  /** Review time as a share of SE Cycle Time (execution span + review), over tickets that have both. */
  reviewShareOfCycleTime: { share: number | null; tickets: number; avgReviewMinutes: number | null; avgExecutionMinutes: number | null };
};

export type ReviewTrendPoint = {
  bucket: string;
  completed: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  entered: number;
  /** Reviews sitting in the queue at the end of this bucket. Null for a bucket still in the future. */
  queueAtEnd: number | null;
};

export type DataQualityIssue = { issueKey: string; reason: string; detail: string };

export type ReviewDataQuality = {
  otherExits: { status: string; count: number }[];
  otherExitCount: number;
  invalidCount: number;
  missingReviewerCount: number;
  /** An open cycle on a ticket whose current status is no longer For Peer Review — a missed sync. */
  staleOpenCount: number;
  /** Cycles that left For Peer Review in under a minute — pass-throughs, not counted as reviews. */
  skippedCount: number;
  /** Who held the ticket on those pass-throughs — i.e. who WOULD have been credited as reviewer. */
  skippedBy: { name: string; count: number }[];
  samples: DataQualityIssue[];
};

export type ReviewWaitReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  grain: ReviewWaitGrain;
  assigneeLabel: string;
  target: ReviewWaitTarget;
  pulse: ReviewWaitStats;
  comparison: ReviewWaitComparison | null;
  reviewers: ReviewerRow[];
  queue: ReviewQueueHealth;
  outlier: { thresholdMinutes: number | null; basis: "p90" | "2x-median" | "none"; count: number };
  longest: LongestReviewRow[];
  segments: Record<SegmentDimension, SegmentRow[]>;
  patterns: ReviewInsight[];
  insights: ReviewInsight[];
  efficiency: ReviewEfficiency;
  trend: ReviewTrendPoint[];
  dataQuality: ReviewDataQuality;
};

// ------------------------------------------------------------------------------ Build population

function slaFor(r: TicketRow, todayIso: string): ReviewSlaFlag {
  const isP1 = (r.priority || "").trim().toLowerCase() === P1_PRIORITY_VALUE.toLowerCase();
  const open = !r.resolved_datetime;
  const due = r.due_date ? r.due_date.slice(0, 10) : null;
  if (!due) return { overdue: null, p1Breach: false, open, label: "No due date" };
  const endIso = open ? todayIso : toManilaDateString(r.resolved_datetime);
  const overdue = !!endIso && endIso > due;
  const p1Breach = overdue && isP1;
  let label: string;
  if (!overdue) label = open ? "Due " + due : "On time";
  else if (p1Breach) label = open ? "Past due · P1 at risk" : "Overdue · P1 SLA breach";
  else label = open ? "Past due (open)" : "Overdue";
  return { overdue, p1Breach, open, label };
}

function buildPopulation(
  rows: TicketRow[],
  team: TeamConfig,
  issueType: string | undefined,
  labelExclusions: { extraExcluded: readonly string[]; automation: Set<string> },
  todayIso: string
): TicketMeta[] {
  const out: TicketMeta[] = [];
  for (const r of rows) {
    if (isExcludedIssueType(team.team_key, r.issue_type)) continue;
    if (issueType && r.issue_type !== issueType) continue;
    const raw = Array.isArray(r.peer_review_cycles_json) ? r.peer_review_cycles_json : [];
    if (!raw.length) continue;

    // Execution span for the "share of Cycle Time" read. Capped at the FIRST time the ticket
    // entered review: for most types cycle_time_end is the hand-off into review, but for some
    // (Investigation, Data Generation) it's a later status, so the raw span already contains the
    // review time and adding review on top would count it twice.
    const firstEntered = raw
      .map((c) => (c.enteredAt ? new Date(c.enteredAt).getTime() : NaN))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.min(m, n), Infinity);
    let doerMinutes: number | null = null;
    if (r.cycle_time_start && r.cycle_time_end) {
      const startMs = new Date(r.cycle_time_start).getTime();
      const endMs = Math.min(new Date(r.cycle_time_end).getTime(), firstEntered);
      doerMinutes = endMs > startMs ? (endMs - startMs) / 60000 : 0;
    }

    const meta: TicketMeta = {
      issueKey: r.issue_key,
      issueType: r.issue_type || "(none)",
      status: r.status || "",
      priority: r.priority || "(none)",
      product: r.product || "(none)",
      labels: meaningfulLabels(r.labels, labelExclusions.extraExcluded).filter((l) => !labelExclusions.automation.has(l.toLowerCase())),
      assignedSe: backlogAgingAssignee(team, r) || "(unassigned)",
      requester: r.reporter_display_name || "(unknown)",
      dueDate: r.due_date,
      resolvedAt: r.resolved_datetime,
      doerMinutes,
      sla: slaFor(r, todayIso),
      cycles: [],
    };

    const sorted = raw
      .slice()
      .sort((a, b) => new Date(a.enteredAt || 0).getTime() - new Date(b.enteredAt || 0).getTime());
    sorted.forEach((c, i) => {
      const { kind, waitMinutes } = classifyReviewCycle(c);
      meta.cycles.push({
        ticket: meta,
        cycleIndex: i + 1,
        reviewer: (c.reviewerAtEntry || "").trim() || UNASSIGNED_REVIEWER,
        reviewerMissing: !(c.reviewerAtEntry || "").trim(),
        enteredAt: c.enteredAt || "",
        enteredDate: toManilaDateString(c.enteredAt) || "",
        exitedAt: c.exitedAt || null,
        exitedToStatus: c.exitedToStatus || "",
        waitMinutes,
        kind,
      });
    });
    out.push(meta);
  }
  return out;
}

function statsOf(waits: number[], ticketCount: number, targetMinutes: number | null): ReviewWaitStats {
  const sorted = waits.slice().sort((a, b) => a - b);
  const withinTargetCount = targetMinutes === null ? 0 : waits.filter((w) => w <= targetMinutes).length;
  return {
    count: waits.length,
    ticketCount,
    avgMinutes: avgOf(waits),
    medianMinutes: medianOf(waits),
    p75Minutes: percentile(sorted, 75),
    p90Minutes: waits.length >= P90_MIN_SAMPLE ? percentile(sorted, 90) : null,
    withinTargetCount,
    withinTargetPct: targetMinutes !== null && waits.length ? round4(withinTargetCount / waits.length) : null,
  };
}

function completedIn(pop: TicketMeta[], startDate: string, endDate: string): Cycle[] {
  const out: Cycle[] = [];
  for (const t of pop) for (const c of t.cycles) if (c.kind === "completed" && inRange(c.enteredDate, startDate, endDate)) out.push(c);
  return out;
}

function periodStats(pop: TicketMeta[], range: string, period: string, targetMinutes: number | null): ReviewWaitStats {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const cycles = completedIn(pop, startDate, endDate);
  return statsOf(cycles.map((c) => c.waitMinutes!), new Set(cycles.map((c) => c.ticket.issueKey)).size, targetMinutes);
}

// ------------------------------------------------------------------------------ Baseline

/** Same window kpi_baselines locks in (lib/kpi-baselines.ts's BASELINE_QUARTERS). */
const BASELINE_START = "2026-01-01";
const BASELINE_END = "2026-06-30";
export const REVIEW_WAIT_BASELINE_LABEL = "2026-Q1+Q2";

/** Average completed review wait over Q1+Q2 2026 — per-cycle, so no quarter-weighting is needed. */
function baselineOf(pop: TicketMeta[]): { value: number | null; sampleCount: number } {
  const waits = completedIn(pop, BASELINE_START, BASELINE_END).map((c) => c.waitMinutes!);
  return { value: avgOf(waits), sampleCount: waits.length };
}

/** For lib/kpi-baselines.ts's recompute, so the stored row and the live fallback are the same number. */
export async function computeReviewWaitBaseline(teamKey: string): Promise<{ value: number | null; sampleCount: number }> {
  const team = (await getTeams()).find((t) => t.team_key === teamKey);
  if (!team) return { value: null, sampleCount: 0 };
  const rows = await fetchReviewTickets(teamKey);
  const pop = buildPopulation(rows, team, undefined, { extraExcluded: [], automation: new Set() }, toManilaDateString(new Date().toISOString())!);
  return baselineOf(pop);
}

function resolveTarget(
  pop: TicketMeta[],
  stored: KpiBaselineRow | undefined,
  overrideMinutes: number | null
): ReviewWaitTarget {
  let baselineMinutes: number | null;
  let baselineSampleCount: number;
  let fromStore = false;
  if (stored && stored.value !== null) {
    baselineMinutes = Number(stored.value);
    baselineSampleCount = stored.sample_count;
    fromStore = true;
  } else {
    const live = baselineOf(pop);
    baselineMinutes = live.value;
    baselineSampleCount = live.sampleCount;
  }
  const base = { baselineMinutes, baselineSampleCount, baselinePeriodLabel: stored?.period_label ?? REVIEW_WAIT_BASELINE_LABEL };
  if (overrideMinutes !== null && overrideMinutes > 0) return { minutes: overrideMinutes, source: "override", ...base };
  if (baselineMinutes !== null) return { minutes: baselineMinutes, source: fromStore ? "baseline" : "live-baseline", ...base };
  return { minutes: null, source: "none", ...base };
}

// ------------------------------------------------------------------------------ Trend buckets

export function defaultGrainFor(range: string): ReviewWaitGrain {
  if (range === "year") return "month";
  if (range === "quarter") return "week";
  return "day";
}

function bucketKey(grain: ReviewWaitGrain, isoDate: string): string {
  if (grain === "month") return isoDate.slice(0, 7);
  if (grain === "week") {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return isoDate;
}

/** Buckets covering [startDate, endDate], each with its last calendar day (clamped to the range). */
function enumerateBuckets(grain: ReviewWaitGrain, startDate: string, endDate: string): { key: string; firstDay: string; lastDay: string }[] {
  const out: { key: string; firstDay: string; lastDay: string }[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const seen = new Map<string, number>();
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const key = bucketKey(grain, iso);
    if (!seen.has(key)) {
      seen.set(key, out.length);
      out.push({ key, firstDay: iso, lastDay: iso });
    } else {
      out[seen.get(key)!].lastDay = iso;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// ------------------------------------------------------------------------------ Segments

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function timeOfDayBand(hour: number): string {
  if (hour < 8) return "1 · Before 8am";
  if (hour < 12) return "2 · Morning (8am–12nn)";
  if (hour < 17) return "3 · Afternoon (12nn–5pm)";
  return "4 · After 5pm";
}

function quarterOf(isoDate: string): string {
  return `${isoDate.slice(0, 4)}-Q${Math.floor((Number(isoDate.slice(5, 7)) - 1) / 3) + 1}`;
}

function segmentKeys(dim: SegmentDimension, c: Cycle): string[] {
  const t = c.ticket;
  switch (dim) {
    case "reviewer": return [c.reviewer];
    case "assignedSe": return [t.assignedSe];
    case "issueType": return [t.issueType];
    case "category": return [`${t.issueType} · ${t.product}`];
    case "label": return t.labels.length ? t.labels : ["(no label)"];
    case "priority": return [t.priority];
    case "requester": return [t.requester];
    case "dayOfWeek": { const { dow } = manilaParts(c.enteredAt); return [`${dow + 1} · ${DOW[dow]}`]; }
    case "timeOfDay": return [timeOfDayBand(manilaParts(c.enteredAt).hour)];
    case "month": return [c.enteredDate.slice(0, 7)];
    case "quarter": return [quarterOf(c.enteredDate)];
    case "outcome": return [c.exitedToStatus || "(none)"];
  }
}

/** Dimensions with an inherent order (days, bands, months) are sorted by key, not by volume. */
const ORDERED_DIMENSIONS = new Set<SegmentDimension>(["dayOfWeek", "timeOfDay", "month", "quarter"]);

function segmentBy(dim: SegmentDimension, cycles: Cycle[], targetMinutes: number | null): SegmentRow[] {
  const groups = new Map<string, number[]>();
  for (const c of cycles) {
    for (const key of segmentKeys(dim, c)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c.waitMinutes!);
    }
  }
  const rows = Array.from(groups.entries()).map(([key, waits]) => {
    const sorted = waits.slice().sort((a, b) => a - b);
    return {
      key,
      count: waits.length,
      avgMinutes: avgOf(waits),
      medianMinutes: medianOf(waits),
      p90Minutes: waits.length >= P90_MIN_SAMPLE ? percentile(sorted, 90) : null,
      overTargetPct: targetMinutes !== null ? round4(waits.filter((w) => w > targetMinutes).length / waits.length) : null,
      smallSample: waits.length < SMALL_SAMPLE,
    };
  });
  if (ORDERED_DIMENSIONS.has(dim)) return rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows.sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------------------------ Insights & patterns

function fmtDur(minutes: number | null): string {
  if (minutes === null) return "—";
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

const SEGMENT_PATTERN_LABELS: Partial<Record<SegmentDimension, string>> = {
  category: "category",
  issueType: "ticket type",
  priority: "priority",
  assignedSe: "SE",
  requester: "requester",
  label: "label",
};

function buildPatterns(report: Pick<ReviewWaitReport, "pulse" | "segments" | "reviewers">): ReviewInsight[] {
  const out: ReviewInsight[] = [];
  const overallMedian = report.pulse.medianMinutes;
  if (overallMedian === null || report.pulse.count < SMALL_SAMPLE) return out;

  // Process-shaped reads first — they explain the queue rather than point at a slice of it.
  // Outcome split: do reviews that end On Hold take longer than ones that move to For Checking?
  const outcome = new Map(report.segments.outcome.map((r) => [r.key.toLowerCase(), r]));
  const onHold = outcome.get("on hold");
  const forChecking = outcome.get("for checking");
  if (onHold && forChecking && onHold.count >= 3 && onHold.medianMinutes !== null && forChecking.medianMinutes !== null) {
    const longer = onHold.medianMinutes > forChecking.medianMinutes;
    out.push({
      tone: longer ? "watch" : "positive",
      text: {
        professional: `Reviews ending On Hold took a median ${fmtDur(onHold.medianMinutes)} (${onHold.count}) vs ${fmtDur(forChecking.medianMinutes)} for those moving to For Checking (${forChecking.count}).`,
        gaby: `**On Hold vs For Checking:** ${fmtDur(onHold.medianMinutes)} median when a review ends On Hold (${onHold.count}), ${fmtDur(forChecking.medianMinutes)} when it moves on to For Checking (${forChecking.count}).`,
      },
    });
  }

  // Queue accumulation by day of week — which weekday receives the most reviews.
  const dows = report.segments.dayOfWeek;
  const totalDow = dows.reduce((s, r) => s + r.count, 0);
  const busiestDay = dows.slice().sort((a, b) => b.count - a.count)[0];
  if (busiestDay && totalDow >= 20 && busiestDay.count / totalDow > 0.28) {
    out.push({
      tone: "watch",
      text: {
        professional: `${pct(busiestDay.count / totalDow)} of reviews arrived on ${busiestDay.key.slice(4)} — the queue tends to build that day.`,
        gaby: `**${busiestDay.key.slice(4)} is rush hour.** ${pct(busiestDay.count / totalDow)} of reviews land that day.`,
      },
    });
  }

  // Reviewer concentration — workload, not speed.
  const top = report.reviewers[0];
  if (top && top.reviews >= 10 && top.volumeShare > 0.35 && top.name !== UNASSIGNED_REVIEWER) {
    out.push({
      tone: "watch",
      text: {
        professional: `${top.name} handled ${pct(top.volumeShare)} of reviews (${top.reviews}) — review load is concentrated on one person.`,
        gaby: `**Heavy review load on ${top.name}.** ${pct(top.volumeShare)} of all reviews (${top.reviews}) went through them.`,
      },
    });
  }

  // Then segments whose typical (median) review runs well above the team's — needs a real
  // sample, and at most one per dimension so no single breakdown crowds out the rest.
  for (const dim of Object.keys(SEGMENT_PATTERN_LABELS) as SegmentDimension[]) {
    const noun = SEGMENT_PATTERN_LABELS[dim]!;
    const slow = report.segments[dim]
      .filter((r) => r.count >= SMALL_SAMPLE && r.medianMinutes !== null && r.medianMinutes > overallMedian * 1.5 && !r.key.startsWith("("))
      .sort((a, b) => (b.medianMinutes ?? 0) - (a.medianMinutes ?? 0))
      .slice(0, 1);
    for (const r of slow) {
      const ratio = Math.round(((r.medianMinutes ?? 0) / overallMedian) * 10) / 10;
      out.push({
        tone: "watch",
        text: {
          professional: `Reviews for ${noun} "${r.key}" run a median ${fmtDur(r.medianMinutes)} — ${ratio}x the team's ${fmtDur(overallMedian)} (${r.count} reviews).`,
          gaby: `**${r.key} waits longer.** Median ${fmtDur(r.medianMinutes)} vs the team's ${fmtDur(overallMedian)} — ${ratio}x, across ${r.count} reviews.`,
        },
      });
    }
  }

  return out.slice(0, 8);
}

function buildInsights(report: Omit<ReviewWaitReport, "insights" | "patterns">): ReviewInsight[] {
  const out: ReviewInsight[] = [];
  const p = report.pulse;
  const c = report.comparison;
  if (!p.count) return out;

  if (c && c.medianMinutes.deltaPct !== null && Math.abs(c.medianMinutes.deltaPct) >= 0.1 && (c.count.previous ?? 0) >= SMALL_SAMPLE) {
    const faster = c.medianMinutes.deltaPct < 0;
    out.push({
      tone: faster ? "positive" : "negative",
      text: {
        professional: `Median review wait is ${faster ? "down" : "up"} ${pct(Math.abs(c.medianMinutes.deltaPct))} vs the previous period (${fmtDur(c.medianMinutes.previous)} → ${fmtDur(c.medianMinutes.current)}).`,
        gaby: faster
          ? `**Reviews are getting faster.** Median down ${pct(Math.abs(c.medianMinutes.deltaPct))}: ${fmtDur(c.medianMinutes.previous)} → ${fmtDur(c.medianMinutes.current)}.`
          : `**Reviews are slowing down.** Median up ${pct(c.medianMinutes.deltaPct)}: ${fmtDur(c.medianMinutes.previous)} → ${fmtDur(c.medianMinutes.current)}.`,
      },
    });
  }

  if (p.avgMinutes !== null && p.medianMinutes && p.avgMinutes > p.medianMinutes * 1.5) {
    out.push({
      tone: "watch",
      text: {
        professional: `The average (${fmtDur(p.avgMinutes)}) is well above the median (${fmtDur(p.medianMinutes)}) — a handful of long reviews is pulling it up, not a slow queue across the board.`,
        gaby: `**A few outliers, not a systemic slowdown.** Average ${fmtDur(p.avgMinutes)} vs median ${fmtDur(p.medianMinutes)} — check What's getting stuck.`,
      },
    });
  }

  if (p.withinTargetPct !== null && report.target.minutes !== null) {
    const good = p.withinTargetPct >= 0.75;
    out.push({
      tone: good ? "positive" : p.withinTargetPct >= 0.5 ? "watch" : "negative",
      text: {
        professional: `${pct(p.withinTargetPct)} of reviews finished within the ${fmtDur(report.target.minutes)} target (${p.withinTargetCount} of ${p.count}).`,
        gaby: `**${pct(p.withinTargetPct)} on target.** ${p.withinTargetCount} of ${p.count} reviews finished inside ${fmtDur(report.target.minutes)}.`,
      },
    });
  }

  if (report.queue.overTargetCount > 0) {
    out.push({
      tone: "negative",
      text: {
        professional: `${report.queue.overTargetCount} ticket${report.queue.overTargetCount === 1 ? " is" : "s are"} waiting in review right now past the target — oldest ${report.queue.oldest ? `${report.queue.oldest.issueKey} at ${fmtDur(report.queue.oldest.ageMinutes)}` : ""}.`,
        gaby: `**${report.queue.overTargetCount} waiting past target right now.** Oldest: ${report.queue.oldest ? `${report.queue.oldest.issueKey} (${fmtDur(report.queue.oldest.ageMinutes)})` : "—"}.`,
      },
    });
  }

  const rw = report.efficiency.rework;
  if (rw.rate !== null && rw.denominator >= 10 && rw.rate >= 0.1) {
    out.push({
      tone: "watch",
      text: {
        professional: `${pct(rw.rate)} of reviewed tickets needed more than one review cycle (${rw.numerator} of ${rw.denominator}).`,
        gaby: `**${pct(rw.rate)} came back for another review.** ${rw.numerator} of ${rw.denominator} tickets went through review more than once.`,
      },
    });
  }

  const share = report.efficiency.reviewShareOfCycleTime;
  if (share.share !== null && share.tickets >= SMALL_SAMPLE) {
    out.push({
      tone: share.share >= 0.4 ? "watch" : "positive",
      text: {
        professional: `Peer review accounts for ${pct(share.share)} of SE Cycle Time on reviewed tickets (${share.tickets} tickets).`,
        gaby: `**Review is ${pct(share.share)} of Cycle Time.** The rest is execution (${share.tickets} tickets).`,
      },
    });
  }

  return out.slice(0, 6);
}

// ------------------------------------------------------------------------------ Main report

export type ReviewWaitOptions = {
  issueType?: string;
  grain?: ReviewWaitGrain;
  /** Cookie override for the target, in minutes. Null/absent = use the Q1+Q2 baseline. */
  targetOverrideMinutes?: number | null;
  baseline?: KpiBaselineRow;
  extraExcludedLabels?: readonly string[];
  automationLabels?: readonly string[];
};

const LONGEST_LIMIT = 50;
const DQ_SAMPLE_LIMIT = 25;

export async function getReviewWaitReport(teamKey: string, range: string, period: string, opts: ReviewWaitOptions = {}): Promise<ReviewWaitReport> {
  const team = (await getTeams()).find((t) => t.team_key === teamKey);
  if (!team) throw new Error(`Unknown team: ${teamKey}`);
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const nowMs = Date.now();
  const todayIso = toManilaDateString(new Date(nowMs).toISOString())!;
  const grain = opts.grain ?? defaultGrainFor(range);

  const rows = await fetchReviewTickets(teamKey);
  const pop = buildPopulation(
    rows,
    team,
    opts.issueType,
    { extraExcluded: opts.extraExcludedLabels ?? [], automation: automationLabelSet(opts.automationLabels ?? []) },
    todayIso
  );
  const allCycles = pop.flatMap((t) => t.cycles);

  const target = resolveTarget(pop, opts.baseline, opts.targetOverrideMinutes ?? null);
  const tgt = target.minutes;

  // ---- Headline
  const completed = completedIn(pop, startDate, endDate);
  const waits = completed.map((c) => c.waitMinutes!);
  const pulse = statsOf(waits, new Set(completed.map((c) => c.ticket.issueKey)).size, tgt);

  // ---- Previous period (same population, same target)
  let comparison: ReviewWaitComparison | null = null;
  try {
    const prevPeriod = shiftPeriod(range as RangeType, period, -1);
    const prev = periodStats(pop, range, prevPeriod, tgt);
    const d = (cur: number | null, prv: number | null): Delta => ({ current: cur, previous: prv, deltaPct: pctDelta(cur, prv) });
    comparison = {
      previousPeriod: prevPeriod,
      count: d(pulse.count, prev.count),
      avgMinutes: d(pulse.avgMinutes, prev.avgMinutes),
      medianMinutes: d(pulse.medianMinutes, prev.medianMinutes),
      p90Minutes: d(pulse.p90Minutes, prev.p90Minutes),
      withinTargetPct: d(pulse.withinTargetPct, prev.withinTargetPct),
    };
  } catch (err) {
    console.error("[getReviewWaitReport] comparison failed:", err);
  }

  // ---- Queue depth at an instant: cycles entered by t and not yet exited at t.
  const spans = allCycles
    .filter((c) => c.kind !== "invalid" && c.kind !== "skipped" && c.enteredAt)
    .map((c) => ({ c, start: new Date(c.enteredAt).getTime(), end: c.exitedAt ? new Date(c.exitedAt).getTime() : Infinity }));
  const depthAt = (t: number, exclude?: Cycle) => spans.reduce((n, s) => (s.c !== exclude && s.start <= t && s.end > t ? n + 1 : n), 0);

  // ---- Reviewers (context, not verdict)
  const byReviewer = new Map<string, Cycle[]>();
  for (const c of completed) {
    if (!byReviewer.has(c.reviewer)) byReviewer.set(c.reviewer, []);
    byReviewer.get(c.reviewer)!.push(c);
  }
  const reviewers: ReviewerRow[] = Array.from(byReviewer.entries())
    .map(([name, cs]) => {
      const w = cs.map((c) => c.waitMinutes!);
      const sorted = w.slice().sort((a, b) => a - b);
      const over = tgt !== null ? w.filter((x) => x > tgt).length : 0;
      const urgent = cs.filter((c) => /^p[12]\b/i.test(c.ticket.priority)).length;
      return {
        name,
        reviews: cs.length,
        tickets: new Set(cs.map((c) => c.ticket.issueKey)).size,
        volumeShare: completed.length ? round4(cs.length / completed.length) : 0,
        avgMinutes: avgOf(w),
        medianMinutes: medianOf(w),
        p90Minutes: w.length >= P90_MIN_SAMPLE ? percentile(sorted, 90) : null,
        longestMinutes: sorted.length ? sorted[sorted.length - 1] : null,
        overTargetCount: over,
        overTargetPct: tgt !== null ? round4(over / cs.length) : null,
        avgQueueDepthAtEntry: round2(cs.reduce((s, c) => s + depthAt(new Date(c.enteredAt).getTime(), c), 0) / cs.length),
        urgentShare: round4(urgent / cs.length),
        distinctSes: new Set(cs.map((c) => c.ticket.assignedSe)).size,
        smallSample: cs.length < SMALL_SAMPLE,
      };
    })
    .sort((a, b) => b.reviews - a.reviews);

  // ---- Current queue: open cycles on tickets whose status is STILL For Peer Review.
  const queueTickets: QueueTicket[] = [];
  let staleOpenCount = 0;
  let asOf: string | null = null;
  const lastSynced = new Map(rows.map((r) => [r.issue_key, r.last_synced_at]));
  for (const t of pop) {
    for (const c of t.cycles) {
      if (c.kind !== "open") continue;
      if (t.status.trim().toLowerCase() !== "for peer review") {
        staleOpenCount++;
        continue;
      }
      const ageMinutes = round2(minutesBetween(c.enteredAt, new Date(nowMs).toISOString()));
      queueTickets.push({
        issueKey: t.issueKey,
        reviewer: c.reviewer,
        assignedSe: t.assignedSe,
        issueType: t.issueType,
        priority: t.priority,
        enteredAt: c.enteredAt,
        ageMinutes,
        overTarget: tgt !== null && ageMinutes > tgt,
        cycleIndex: c.cycleIndex,
      });
      const synced = lastSynced.get(t.issueKey);
      if (synced && (!asOf || synced > asOf)) asOf = synced;
    }
  }
  queueTickets.sort((a, b) => b.ageMinutes - a.ageMinutes);
  const ages = queueTickets.map((q) => q.ageMinutes);
  const queue: ReviewQueueHealth = {
    asOf,
    count: queueTickets.length,
    avgAgeMinutes: avgOf(ages),
    medianAgeMinutes: medianOf(ages),
    oldest: queueTickets[0] ?? null,
    overTargetCount: queueTickets.filter((q) => q.overTarget).length,
    tickets: queueTickets,
  };

  // ---- Outliers / longest reviews
  const threshold = pulse.p90Minutes ?? (pulse.medianMinutes !== null ? pulse.medianMinutes * 2 : null);
  const outlierBasis: ReviewWaitReport["outlier"]["basis"] = pulse.p90Minutes !== null ? "p90" : pulse.medianMinutes !== null ? "2x-median" : "none";
  const totalReviewOf = (t: TicketMeta) => round2(t.cycles.reduce((s, c) => s + (c.kind === "completed" ? c.waitMinutes! : 0), 0));
  const detail = (c: Cycle): ReviewCycleDetail => ({
    cycleIndex: c.cycleIndex, reviewer: c.reviewer, enteredAt: c.enteredAt, exitedAt: c.exitedAt,
    exitedToStatus: c.exitedToStatus, waitMinutes: c.waitMinutes, kind: c.kind,
  });
  const outliers = threshold !== null ? completed.filter((c) => c.waitMinutes! >= threshold) : [];
  const longest: LongestReviewRow[] = completed
    .slice()
    .sort((a, b) => b.waitMinutes! - a.waitMinutes!)
    .slice(0, LONGEST_LIMIT)
    .map((c) => ({
      issueKey: c.ticket.issueKey,
      issueType: c.ticket.issueType,
      product: c.ticket.product,
      labels: c.ticket.labels,
      requester: c.ticket.requester,
      assignedSe: c.ticket.assignedSe,
      reviewer: c.reviewer,
      enteredAt: c.enteredAt,
      exitedAt: c.exitedAt!,
      waitMinutes: c.waitMinutes!,
      exitedToStatus: c.exitedToStatus,
      currentStatus: c.ticket.status,
      priority: c.ticket.priority,
      sla: c.ticket.sla,
      cycleIndex: c.cycleIndex,
      cycleCount: c.ticket.cycles.filter((x) => x.kind !== "invalid" && x.kind !== "skipped").length,
      totalReviewMinutes: totalReviewOf(c.ticket),
      vsTarget: tgt ? round2(c.waitMinutes! / tgt) : null,
      history: c.ticket.cycles.map(detail),
    }));

  // ---- Segments
  const dims: SegmentDimension[] = ["reviewer", "assignedSe", "issueType", "category", "label", "priority", "requester", "dayOfWeek", "timeOfDay", "month", "quarter", "outcome"];
  const segments = Object.fromEntries(dims.map((d) => [d, segmentBy(d, completed, tgt)])) as Record<SegmentDimension, SegmentRow[]>;

  // ---- Efficiency (ticket-level; each ticket counted once)
  // Skipped pass-throughs aren't reviews, so they're not review cycles either: a ticket that only
  // skipped through isn't "reviewed", and a skipped second pass isn't rework.
  const isReal = (c: Cycle) => c.kind !== "invalid" && c.kind !== "skipped";
  const periodCyclesAll = allCycles.filter((c) => isReal(c) && inRange(c.enteredDate, startDate, endDate));
  const endInstant = manilaEndOfDay(endDate);
  const exitedByEnd = periodCyclesAll.filter((c) => c.exitedAt && new Date(c.exitedAt).getTime() <= endInstant).length;
  const reviewedTickets = Array.from(new Set(periodCyclesAll.map((c) => c.ticket))) as TicketMeta[];
  const reachedForChecking = reviewedTickets
    .map((t) => ({ t, idx: t.cycles.filter(isReal).findIndex((c) => c.exitedToStatus.trim().toLowerCase() === "for checking") }))
    .filter((x) => x.idx >= 0);
  const firstPass = reachedForChecking.filter((x) => x.idx === 0).length;
  const realCycleCount = (t: TicketMeta) => t.cycles.filter(isReal).length;
  const reworked = reviewedTickets.filter((t) => realCycleCount(t) > 1).length;
  const totals = reviewedTickets.map((t) => ({ t, total: totalReviewOf(t) })).filter((x) => x.t.cycles.some((c) => c.kind === "completed"));
  const single = totals.filter((x) => realCycleCount(x.t) === 1);
  const multi = totals.filter((x) => realCycleCount(x.t) > 1);
  const withDoer = totals.filter((x) => x.t.doerMinutes !== null);
  const sumReview = withDoer.reduce((s, x) => s + x.total, 0);
  const sumDoer = withDoer.reduce((s, x) => s + (x.t.doerMinutes ?? 0), 0);
  const rate = (n: number, d: number) => ({ numerator: n, denominator: d, rate: d ? round4(n / d) : null });

  const efficiency: ReviewEfficiency = {
    completion: rate(exitedByEnd, periodCyclesAll.length),
    firstPass: rate(firstPass, reachedForChecking.length),
    rework: rate(reworked, reviewedTickets.length),
    avgCyclesToForChecking: reachedForChecking.length ? round2(reachedForChecking.reduce((s, x) => s + x.idx + 1, 0) / reachedForChecking.length) : null,
    totalReviewPerTicket: { avgMinutes: avgOf(totals.map((x) => x.total)), medianMinutes: medianOf(totals.map((x) => x.total)), count: totals.length },
    singleCycle: { tickets: single.length, avgTotalMinutes: avgOf(single.map((x) => x.total)) },
    multiCycle: { tickets: multi.length, avgTotalMinutes: avgOf(multi.map((x) => x.total)) },
    reviewShareOfCycleTime: {
      share: sumReview + sumDoer > 0 ? round4(sumReview / (sumReview + sumDoer)) : null,
      tickets: withDoer.length,
      avgReviewMinutes: withDoer.length ? round2(sumReview / withDoer.length) : null,
      avgExecutionMinutes: withDoer.length ? round2(sumDoer / withDoer.length) : null,
    },
  };

  // ---- Trend
  const buckets = enumerateBuckets(grain, startDate, endDate);
  const byBucket = new Map<string, { waits: number[]; entered: number }>(buckets.map((b) => [b.key, { waits: [], entered: 0 }]));
  for (const c of completed) byBucket.get(bucketKey(grain, c.enteredDate))?.waits.push(c.waitMinutes!);
  for (const c of periodCyclesAll) {
    const b = byBucket.get(bucketKey(grain, c.enteredDate));
    if (b) b.entered++;
  }
  const trend: ReviewTrendPoint[] = buckets.map((b) => {
    const { waits: w, entered } = byBucket.get(b.key)!;
    const sorted = w.slice().sort((a, c) => a - c);
    // A bucket that hasn't started yet has no queue to report (null, drawn as a gap), and the
    // current bucket reads the queue as of now rather than at a future end-of-day.
    const future = b.firstDay > todayIso;
    const endMs = Math.min(manilaEndOfDay(b.lastDay), nowMs);
    return {
      bucket: b.key,
      completed: w.length,
      avgMinutes: avgOf(w),
      medianMinutes: medianOf(w),
      p90Minutes: w.length >= P90_MIN_SAMPLE ? percentile(sorted, 90) : null,
      entered,
      queueAtEnd: future ? null : depthAt(endMs),
    };
  });

  // ---- Data quality (whole period, not just completed)
  const dqCycles = allCycles.filter((c) => inRange(c.enteredDate, startDate, endDate) || c.kind === "invalid");
  const otherExitMap = new Map<string, number>();
  const samples: DataQualityIssue[] = [];
  let invalidCount = 0;
  let missingReviewerCount = 0;
  let skippedCount = 0;
  const skippedByMap = new Map<string, number>();
  for (const c of dqCycles) {
    if (c.kind === "skipped") {
      skippedCount++;
      skippedByMap.set(c.reviewer, (skippedByMap.get(c.reviewer) ?? 0) + 1);
      if (samples.length < DQ_SAMPLE_LIMIT) samples.push({ issueKey: c.ticket.issueKey, reason: "Skipped review", detail: `Passed through For Peer Review to ${c.exitedToStatus} in under a minute while held by ${c.reviewer} — not counted as a review.` });
    } else if (c.kind === "otherExit") {
      otherExitMap.set(c.exitedToStatus || "(blank)", (otherExitMap.get(c.exitedToStatus || "(blank)") ?? 0) + 1);
      if (samples.length < DQ_SAMPLE_LIMIT) samples.push({ issueKey: c.ticket.issueKey, reason: "Other exit", detail: `Left review to ${c.exitedToStatus || "(blank)"} after ${fmtDur(c.waitMinutes)} — not counted in Review Wait Time.` });
    } else if (c.kind === "invalid") {
      invalidCount++;
      if (samples.length < DQ_SAMPLE_LIMIT) samples.push({ issueKey: c.ticket.issueKey, reason: "Invalid timestamps", detail: `Entered ${c.enteredAt || "(missing)"}, exited ${c.exitedAt || "(missing)"} — excluded.` });
    }
    if (c.kind === "completed" && c.reviewerMissing) {
      missingReviewerCount++;
      if (samples.length < DQ_SAMPLE_LIMIT) samples.push({ issueKey: c.ticket.issueKey, reason: "No reviewer at entry", detail: `Counted in team totals as "${UNASSIGNED_REVIEWER}". Re-running runStPeerReviewRebackfill fills this in.` });
    }
  }
  for (const t of pop) {
    if (t.status.trim().toLowerCase() === "for peer review") continue;
    for (const c of t.cycles) {
      if (c.kind === "open" && samples.length < DQ_SAMPLE_LIMIT) {
        samples.push({ issueKey: t.issueKey, reason: "Open review, ticket moved on", detail: `Review cycle has no exit but the ticket is now "${t.status}" — likely a missed sync. Not counted in the queue.` });
      }
    }
  }
  const dataQuality: ReviewDataQuality = {
    otherExits: Array.from(otherExitMap.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    otherExitCount: Array.from(otherExitMap.values()).reduce((s, n) => s + n, 0),
    invalidCount,
    missingReviewerCount,
    staleOpenCount,
    skippedCount,
    skippedBy: Array.from(skippedByMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    samples,
  };

  const partial: Omit<ReviewWaitReport, "insights" | "patterns"> = {
    team: teamKey, range, period, issueType: opts.issueType ?? null, grain,
    assigneeLabel: team.assignee_field_id === "customfield_10189" ? "Assigned SE" : "Assigned COD",
    target, pulse, comparison, reviewers, queue,
    outlier: { thresholdMinutes: threshold, basis: outlierBasis, count: outliers.length },
    longest, segments, efficiency, trend, dataQuality,
  };

  return {
    ...partial,
    insights: buildInsights(partial),
    patterns: buildPatterns(partial),
  };
}

// ------------------------------------------------------------------------------ Scorecard

export type ReviewWaitScorecard = {
  stats: ReviewWaitStats;
  comparison: { avgDeltaPct: number | null; previousAvgMinutes: number | null } | null;
  target: ReviewWaitTarget;
};

/**
 * The team page's Review Wait Time card. Reads the same population as the deep-dive (and NOT the
 * GAS-aggregated metrics_daily.peer_review_wait_* columns, which bucket by ticket CREATED date and
 * only count On Hold/For Checking exits) — so the card and the page it links to always agree.
 */
export async function getReviewWaitScorecard(
  teamKey: string,
  range: string,
  period: string,
  opts: { issueType?: string; baseline?: KpiBaselineRow; targetOverrideMinutes?: number | null } = {}
): Promise<ReviewWaitScorecard | null> {
  try {
    const team = (await getTeams()).find((t) => t.team_key === teamKey);
    if (!team) return null;
    const rows = await fetchReviewTickets(teamKey);
    const pop = buildPopulation(rows, team, opts.issueType, { extraExcluded: [], automation: new Set() }, toManilaDateString(new Date().toISOString())!);
    const target = resolveTarget(pop, opts.baseline, opts.targetOverrideMinutes ?? null);
    const stats = periodStats(pop, range, period, target.minutes);
    let comparison: ReviewWaitScorecard["comparison"] = null;
    try {
      const prev = periodStats(pop, range, shiftPeriod(range as RangeType, period, -1), target.minutes);
      comparison = { avgDeltaPct: pctDelta(stats.avgMinutes, prev.avgMinutes), previousAvgMinutes: prev.avgMinutes };
    } catch {
      comparison = null;
    }
    return { stats, comparison, target };
  } catch (err) {
    console.error("[getReviewWaitScorecard] failed:", err);
    return null;
  }
}
