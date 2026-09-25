/**
 * Shared statistics helpers for report/metrics modules under src/lib/. Consolidates what used to
 * be 6 separate median implementations (account-creation-report.ts, backlog-aging.ts,
 * lead-cycle-time.ts, automated-tickets.ts, p1-sla.ts, ticket-breakdowns.ts) with inconsistent
 * contracts — some assumed pre-sorted input, some sorted internally. This one always sorts
 * internally so every caller gets the same contract regardless of whether it happens to already
 * have a sorted array (sorting an already-sorted array is still correct, just a no-op cost).
 *
 * Edge cases (matching the majority of the 6 prior implementations): empty array -> null,
 * single-element array -> that element. No rounding is applied here — callers that had a
 * rounding quirk on top of plain median keep their own wrapper around this function.
 */

/** Median of `values`. Sorts internally — callers do not need to pre-sort. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
