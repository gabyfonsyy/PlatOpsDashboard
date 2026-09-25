import type { CountRow } from "@/lib/ticket-breakdowns";

/**
 * Business Review Prep's "what caused the change?" engine. Pure functions, no I/O — operates on
 * CountRow[] breakdowns the report functions (getFcrReport, getBacklogAgingReport,
 * getTicketVolumeBreakdown, ...) already return. Never asked to find a cause itself; only to
 * compare two already-computed breakdowns and classify how confidently the result explains a
 * metric's change. See lib/business-review-ai.ts for how these facts, once computed, become prose.
 */

export type DriverRow = {
  key: string;
  previous: number;
  current: number;
  change: number;
  /** Share of the metric's total absolute change this row accounts for. Null when the metric
   * didn't move (totalAbsChange === 0) — there is nothing to attribute a share of. */
  contribution: number | null;
};

export type DriverVerdict = "confirmed" | "possible" | "none";

const TOP_DRIVER_LIMIT = 4;
const CONFIRMED_CONTRIBUTION_THRESHOLD = 0.4;
const POSSIBLE_CONTRIBUTION_THRESHOLD = 0.15;
const CONFIRMED_MARGIN_MULTIPLE = 1.5;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Full outer join of two same-shaped breakdowns by `key`, sorted by |contribution| descending,
 * with everything past the top `TOP_DRIVER_LIMIT` collapsed into a single "Other" row — mirrors
 * the brief's own example table and the sitewide "Other" convention already used in ranking
 * tables (e.g. ByLabelCard).
 */
export function compareBreakdowns(previous: CountRow[], current: CountRow[], totalAbsChange: number): DriverRow[] {
  const keys = new Set<string>([...previous.map((r) => r.key), ...current.map((r) => r.key)]);
  const previousByKey = new Map(previous.map((r) => [r.key, r.count]));
  const currentByKey = new Map(current.map((r) => [r.key, r.count]));

  const rows: DriverRow[] = Array.from(keys).map((key) => {
    const prev = previousByKey.get(key) ?? 0;
    const curr = currentByKey.get(key) ?? 0;
    const change = curr - prev;
    return {
      key,
      previous: prev,
      current: curr,
      change,
      contribution: totalAbsChange ? round4(change / totalAbsChange) : null,
    };
  });

  rows.sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0) || b.change - a.change);

  if (rows.length <= TOP_DRIVER_LIMIT) return rows;

  const top = rows.slice(0, TOP_DRIVER_LIMIT);
  const rest = rows.slice(TOP_DRIVER_LIMIT);
  const otherPrevious = rest.reduce((sum, r) => sum + r.previous, 0);
  const otherCurrent = rest.reduce((sum, r) => sum + r.current, 0);
  const otherChange = otherCurrent - otherPrevious;
  top.push({
    key: "Other",
    previous: otherPrevious,
    current: otherCurrent,
    change: otherChange,
    contribution: totalAbsChange ? round4(otherChange / totalAbsChange) : null,
  });
  return top;
}

/**
 * Candidate driver rows, ranked by contribution — POSITIVE contribution only. A negative
 * contribution means this row's own change moved OPPOSITE the metric's overall direction (e.g.
 * the metric fell overall while this one dimension rose) — naming it "the driver" would be a
 * direct factual inversion, not just a weak claim, so it's excluded from consideration entirely
 * rather than merely down-ranked. Found live verifying this against real Supabase data: DBA Ticket
 * Volume fell 78->74 while "Task" alone rose +17 (other categories fell by more) — the naive
 * largest-|contribution| pick named "Task" as driving a decrease it was actually pulling against.
 */
function rankedPositiveDrivers(rows: DriverRow[]): DriverRow[] {
  return rows
    .filter((r) => r.key !== "Other" && r.contribution !== null && r.contribution > 0)
    .sort((a, b) => b.contribution! - a.contribution!);
}

/** The single row (if any) safe to name as "the driver" — same-direction, largest contribution. */
export function topDriver(rows: DriverRow[]): DriverRow | null {
  return rankedPositiveDrivers(rows)[0] ?? null;
}

/**
 * Deterministic confirmed/possible/no-clear-driver classification, per the brief's section 7.
 * Named thresholds, not magic numbers — never re-derive causality from the model, this decides it.
 */
export function classifyDriver(rows: DriverRow[]): DriverVerdict {
  const ranked = rankedPositiveDrivers(rows);
  if (!ranked.length) return "none";

  const top = ranked[0].contribution!;
  const runnerUp = ranked.length > 1 ? ranked[1].contribution! : 0;

  if (top < POSSIBLE_CONTRIBUTION_THRESHOLD) return "none";
  if (top >= CONFIRMED_CONTRIBUTION_THRESHOLD && (runnerUp === 0 || top >= runnerUp * CONFIRMED_MARGIN_MULTIPLE)) {
    return "confirmed";
  }
  return "possible";
}

export type DurationByKeyRow = { key: string; count: number; avgValue: number };

export type MixShiftFlag = { deltaValue: number; pctOfTotalChange: number | null };

/** Below this share of the total change, a mix shift isn't worth calling out on its own. */
const MIX_SHIFT_NOTABLE_THRESHOLD = 0.3;

/**
 * Driver rows for a metric that IS an average (Lead Time, Cycle Time) rather than a count/rate
 * over a population. compareBreakdowns' plain count-diff contribution doesn't apply here: it works
 * for Ticket Volume et al. because a category's own COUNT literally sums to the total, so "share of
 * the total count change" is a sound number. Per-category AVERAGES don't sum to the overall average
 * at all — the overall figure is a volume-weighted mix of them, and it can move because a category's
 * own typical duration changed, because the ticket MIX shifted toward inherently slower/faster
 * categories, or both at once.
 *
 * Decomposes the overall average's change into, per key present in BOTH periods, a "within" effect:
 * how much the average moved because that key's own typical value changed, weighted by its CURRENT
 * share of volume (so the number reflects today's mix of work, not a period-old one). A key present
 * in only one period has no baseline to attribute a pace CHANGE to, so it contributes nothing to any
 * row here — its volume shift is real, but it belongs to the mix effect below, not to a claim about
 * that key getting faster or slower.
 *
 * Whatever the within effects don't explain (residual = total change − sum of within effects) is
 * mix shift: the ticket composition itself moving toward slower- or faster-to-resolve categories.
 * It's returned separately and never folded into the ranked candidate rows, so "key X's own pace
 * changed" is never confused with "the ticket mix shifted" — the exact conflation buildDriver in
 * lib/business-review.ts already guards against for count-based metrics (see its own doc comment).
 */
export function buildDurationDriver(
  previousRows: DurationByKeyRow[],
  currentRows: DurationByKeyRow[]
): { rows: DriverRow[]; verdict: DriverVerdict; mixShift: MixShiftFlag | null } {
  const totalCountCurr = currentRows.reduce((s, r) => s + r.count, 0);
  const totalCountPrev = previousRows.reduce((s, r) => s + r.count, 0);
  if (!totalCountCurr || !totalCountPrev) return { rows: [], verdict: "none", mixShift: null };

  const overallPrev = previousRows.reduce((s, r) => s + r.avgValue * r.count, 0) / totalCountPrev;
  const overallCurr = currentRows.reduce((s, r) => s + r.avgValue * r.count, 0) / totalCountCurr;
  const totalChange = overallCurr - overallPrev;

  const prevByKey = new Map(previousRows.map((r) => [r.key, r]));
  const currByKey = new Map(currentRows.map((r) => [r.key, r]));

  const withinRows: DriverRow[] = [];
  let withinSum = 0;
  for (const [key, curr] of Array.from(currByKey)) {
    const prev = prevByKey.get(key);
    if (!prev) continue; // no baseline for this key — its volume shift belongs to mixShift, not a row
    const within = (curr.count / totalCountCurr) * (curr.avgValue - prev.avgValue);
    withinSum += within;
    withinRows.push({
      key,
      previous: prev.avgValue,
      current: curr.avgValue,
      change: round4(curr.avgValue - prev.avgValue),
      contribution: totalChange ? round4(within / totalChange) : null,
    });
  }
  withinRows.sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0));

  // Same top-N + "Other" convention as compareBreakdowns, so the table never grows unbounded and
  // classifyDriver (which excludes "Other" from consideration) behaves identically either way.
  let rows = withinRows;
  if (withinRows.length > TOP_DRIVER_LIMIT) {
    const top = withinRows.slice(0, TOP_DRIVER_LIMIT);
    const rest = withinRows.slice(TOP_DRIVER_LIMIT);
    const restCountPrev = rest.reduce((s, r) => s + (prevByKey.get(r.key)?.count ?? 0), 0);
    const restCountCurr = rest.reduce((s, r) => s + (currByKey.get(r.key)?.count ?? 0), 0);
    const restPrevAvg = restCountPrev ? rest.reduce((s, r) => s + r.previous * (prevByKey.get(r.key)?.count ?? 0), 0) / restCountPrev : 0;
    const restCurrAvg = restCountCurr ? rest.reduce((s, r) => s + r.current * (currByKey.get(r.key)?.count ?? 0), 0) / restCountCurr : 0;
    top.push({
      key: "Other",
      previous: round4(restPrevAvg),
      current: round4(restCurrAvg),
      change: round4(restCurrAvg - restPrevAvg),
      contribution: round4(rest.reduce((s, r) => s + (r.contribution ?? 0), 0)),
    });
    rows = top;
  }

  const verdict = classifyDriver(rows);

  const mixShiftDelta = totalChange - withinSum;
  const mixShiftPct = totalChange ? mixShiftDelta / totalChange : null;
  const mixShift =
    mixShiftPct !== null && Math.abs(mixShiftPct) >= MIX_SHIFT_NOTABLE_THRESHOLD
      ? { deltaValue: round4(mixShiftDelta), pctOfTotalChange: round4(mixShiftPct) }
      : null;

  return { rows, verdict, mixShift };
}

export type AnomalyResult = { flagged: boolean; zScore: number };

const MIN_HISTORY_FOR_ANOMALY = 4;
const ANOMALY_Z_THRESHOLD = 2;

/**
 * Plain mean / population-stdev z-score against prior equivalent periods. Returns null (never a
 * false "not anomalous") when there isn't enough history to say anything — a metric with too
 * little history never gets a spike/drop claim it can't support.
 */
export function detectAnomaly(currentValue: number, history: number[]): AnomalyResult | null {
  if (history.length < MIN_HISTORY_FOR_ANOMALY) return null;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return { flagged: false, zScore: 0 };
  const zScore = round4((currentValue - mean) / stdev);
  return { flagged: Math.abs(zScore) >= ANOMALY_Z_THRESHOLD, zScore };
}
