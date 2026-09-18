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
