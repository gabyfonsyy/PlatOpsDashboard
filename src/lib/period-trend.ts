/**
 * The team-page scorecards' "↑ 12% vs previous period" line (MetricCard's `trend` slot) — one
 * helper so every card words and colours the comparison the same way.
 *
 * - `mode: "pct"` — relative change, for counts and durations.
 * - `mode: "pts"` — percentage-point change, for rates (a rate going 20% -> 25% reads as "+5 pts",
 *   not "+25%", which is a percent of a percent and easy to misread).
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
  opts: { better: "lower" | "higher" | "neutral"; mode?: "pct" | "pts" }
): { direction: "up" | "down" | "flat"; label: string; positive: boolean | null } | undefined {
  if (current === null || current === undefined || previous === null || previous === undefined) return undefined;
  const mode = opts.mode ?? "pct";

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
