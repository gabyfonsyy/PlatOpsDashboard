/**
 * The team-page scorecards' "↑ 12% vs previous period" line (MetricCard's `trend` slot) — one
 * helper so every card words and colours the comparison the same way.
 *
 * - `mode: "pct"` — relative change, for counts and durations.
 * - `mode: "pts"` — percentage-point change, for rates (a rate going 20% -> 25% reads as "+5 pts",
 *   not "+25%", which is a percent of a percent and easy to misread).
 * - `mode: "abs"` — absolute difference rendered by `formatAbs`, for durations where "↓ 0.6 days"
 *   is easier to act on than "↓ 20%" (On-Hold Wait Time). Moves under 1% of the previous value read
 *   as no change.
 * - `better`: "lower" / "higher" colours the line green/red; "neutral" keeps it grey — for volume
 *   metrics where more isn't good or bad on its own (Ticket Volume, Automated Tickets).
 *
 * Returns undefined (no line) when either side is missing or the previous value is 0 for a
 * relative change. A move that rounds to nothing shows as a grey "≈ no change" rather than no line
 * at all — an absent line on one card among several reads as missing data, not as "flat".
 */
export function vsPreviousTrend(
  current: number | null | undefined,
  previous: number | null | undefined,
  opts: { better: "lower" | "higher" | "neutral"; mode?: "pct" | "pts" | "abs"; formatAbs?: (magnitude: number) => string }
): { direction: "up" | "down" | "flat"; label: string; positive: boolean | null } | undefined {
  if (current === null || current === undefined || previous === null || previous === undefined) return undefined;
  const mode = opts.mode ?? "pct";

  if (mode === "abs") {
    const diff = current - previous;
    if (Math.abs(diff) < Math.abs(previous) * 0.01 || diff === 0) return { direction: "flat", label: "≈ no change vs previous period", positive: null };
    const up = diff > 0;
    const text = opts.formatAbs ? opts.formatAbs(Math.abs(diff)) : String(Math.round(Math.abs(diff) * 10) / 10);
    return {
      direction: up ? "up" : "down",
      label: `${up ? "↑" : "↓"} ${text} vs previous period`,
      positive: opts.better === "neutral" ? null : opts.better === "lower" ? !up : up,
    };
  }

  let magnitude: number;
  let unit: string;
  if (mode === "pts") {
    magnitude = Math.round((current - previous) * 1000) / 10;
    unit = " pts";
  } else {
    if (previous === 0) return undefined;
    magnitude = Math.round(((current - previous) / previous) * 1000) / 10;
    unit = "%";
  }
  if (Math.abs(magnitude) < 0.5) return { direction: "flat", label: "≈ no change vs previous period", positive: null };

  const up = magnitude > 0;
  return {
    direction: up ? "up" : "down",
    label: `${up ? "↑" : "↓"} ${Math.abs(magnitude)}${unit} vs previous period`,
    positive: opts.better === "neutral" ? null : opts.better === "lower" ? !up : up,
  };
}
