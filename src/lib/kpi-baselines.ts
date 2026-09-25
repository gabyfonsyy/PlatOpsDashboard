import { getTeams, type TeamConfig } from "@/lib/teams";
import { getLeadTimeDeepDive, getCycleTimeDeepDive } from "@/lib/lead-cycle-time";
import { getFcrReport } from "@/lib/ticket-breakdowns";
import { getBacklogAgingDeepDive } from "@/lib/backlog-aging";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * The two quarters her ask is locking in as the reference point. Combined with a count-weighted
 * average (never a naive average of two averages) so a quarter with more resolved tickets
 * contributes proportionally more to the baseline. Bump this (and re-run the recompute route) if
 * she ever wants to re-baseline off a different window later.
 */
const BASELINE_QUARTERS = ["2026-Q1", "2026-Q2"] as const;
export const BASELINE_PERIOD_LABEL = "2026-Q1+Q2";

export type KpiMetricKey =
  | "lead_time"
  | "cycle_time_total"
  | "cycle_time_doer"
  | "cycle_time_validator"
  | "fcr_rate"
  | "ageing_rate";

export type KpiBaselineRow = {
  team_key: string;
  metric: KpiMetricKey;
  /** minutes for lead_time/cycle_time_*, a 0-1 fraction for fcr_rate/ageing_rate — same units the
   * live reports already use, so formatDaysValue/formatPercent apply unchanged. */
  value: number | null;
  sample_count: number;
  period_label: string;
  computed_at: string;
};

export type KpiBaselineMap = Partial<Record<KpiMetricKey, KpiBaselineRow>>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function baselineRow(teamKey: string, metric: KpiMetricKey, agg: { value: number | null; sampleCount: number }, computedAt: string): KpiBaselineRow {
  return { team_key: teamKey, metric, value: agg.value, sample_count: agg.sampleCount, period_label: BASELINE_PERIOD_LABEL, computed_at: computedAt };
}

/** (avg_i * count_i summed) / (count_i summed) — the correct way to combine two periods' averages, as opposed to averaging the two averages themselves. */
function weightedAvg(parts: { avg: number | null; count: number }[]): { value: number | null; sampleCount: number } {
  const sampleCount = parts.reduce((s, p) => s + p.count, 0);
  if (!sampleCount) return { value: null, sampleCount: 0 };
  const sum = parts.reduce((s, p) => s + (p.avg ?? 0) * p.count, 0);
  return { value: round2(sum / sampleCount), sampleCount };
}

/** numerator/denominator summed across periods first, then divided — correct for combining two rates. */
function weightedRate(parts: { numerator: number; denominator: number }[]): { value: number | null; sampleCount: number } {
  const denominator = parts.reduce((s, p) => s + p.denominator, 0);
  if (!denominator) return { value: null, sampleCount: 0 };
  const numerator = parts.reduce((s, p) => s + p.numerator, 0);
  return { value: round4(numerator / denominator), sampleCount: denominator };
}

/**
 * Builds the baseline row set for one team, scoped per her ask: Lead Time + Cycle Time
 * (end-to-end) for every team; Cycle Time as Doer/Validator, FCR Rate, and Ageing Rate only for a
 * team shaped like SE. Reuses `has_peer_review_tracking`/`has_fcr_escalation` — the same flags
 * that already gate the doer/validator split and the FCR card everywhere else in the app — rather
 * than hardcoding team keys, so this stays correct if team config ever changes.
 *
 * Calls the exact same report functions the live pages call (getLeadTimeDeepDive,
 * getCycleTimeDeepDive, getFcrReport, getBacklogAgingDeepDive) so the baseline can never disagree
 * with how these metrics are defined elsewhere.
 */
export async function computeTeamBaselines(team: TeamConfig): Promise<KpiBaselineRow[]> {
  const computedAt = new Date().toISOString();
  const rows: KpiBaselineRow[] = [];

  const leadTimeReports = await Promise.all(
    BASELINE_QUARTERS.map((period) => getLeadTimeDeepDive(team.team_key, "quarter", period))
  );
  rows.push(
    baselineRow(
      team.team_key,
      "lead_time",
      weightedAvg(leadTimeReports.map((r) => ({ avg: r.pulse.avgMinutes, count: r.pulse.count }))),
      computedAt
    )
  );

  const cycleTimeReports = await Promise.all(
    BASELINE_QUARTERS.map((period) => getCycleTimeDeepDive(team.team_key, "quarter", period))
  );
  rows.push(
    baselineRow(
      team.team_key,
      "cycle_time_total",
      weightedAvg(cycleTimeReports.map((r) => ({ avg: r.pulse.total.avgMinutes, count: r.pulse.total.count }))),
      computedAt
    )
  );

  if (team.has_peer_review_tracking) {
    rows.push(
      baselineRow(
        team.team_key,
        "cycle_time_doer",
        weightedAvg(cycleTimeReports.map((r) => ({ avg: r.pulse.doer?.avgMinutes ?? null, count: r.pulse.doer?.count ?? 0 }))),
        computedAt
      )
    );
    rows.push(
      baselineRow(
        team.team_key,
        "cycle_time_validator",
        weightedAvg(cycleTimeReports.map((r) => ({ avg: r.pulse.validator?.avgMinutes ?? null, count: r.pulse.validator?.count ?? 0 }))),
        computedAt
      )
    );

    const ageingReports = await Promise.all(
      BASELINE_QUARTERS.map((period) => getBacklogAgingDeepDive(team.team_key, "quarter", period))
    );
    rows.push(
      baselineRow(
        team.team_key,
        "ageing_rate",
        weightedRate(ageingReports.map((r) => ({ numerator: r.resolutionTimeliness.beyondDue, denominator: r.resolutionTimeliness.resolved }))),
        computedAt
      )
    );
  }

  if (team.has_fcr_escalation) {
    const fcrReports = await Promise.all(
      BASELINE_QUARTERS.map((period) => getFcrReport(team.team_key, "quarter", period))
    );
    rows.push(
      baselineRow(
        team.team_key,
        "fcr_rate",
        weightedRate(fcrReports.map((r) => ({ numerator: r.fcrYesTickets, denominator: r.resolvedInPeriod }))),
        computedAt
      )
    );
  }

  return rows;
}

export async function storeTeamBaselines(rows: KpiBaselineRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await getSupabaseClient().from("kpi_baselines").upsert(rows, { onConflict: "team_key,metric" });
  if (error) throw new Error(`Failed to store KPI baselines: ${error.message}`);
}

/** One team at a time — this is a rare admin action, not a hot path, so sequential is simpler and
 * kinder to Supabase/Jira-derived data than firing every team's queries at once. */
export async function recomputeAllTeamBaselines(): Promise<{ teamKey: string; rows: KpiBaselineRow[] }[]> {
  const teams = await getTeams();
  const results: { teamKey: string; rows: KpiBaselineRow[] }[] = [];
  for (const team of teams) {
    const rows = await computeTeamBaselines(team);
    await storeTeamBaselines(rows);
    results.push({ teamKey: team.team_key, rows });
  }
  return results;
}

/** Read-side for every page below — falls back to empty rather than throwing, same convention as
 * getTicketMetrics, so a Supabase hiccup just means no baseline line shows rather than a broken page. */
export async function getKpiBaselines(teamKey: string): Promise<KpiBaselineMap> {
  try {
    const { data, error } = await getSupabaseClient().from("kpi_baselines").select("*").eq("team_key", teamKey);
    if (error) throw new Error(error.message);
    const map: KpiBaselineMap = {};
    for (const row of (data ?? []) as KpiBaselineRow[]) map[row.metric] = row;
    return map;
  } catch {
    return {};
  }
}

/**
 * `trend`-shaped comparison of a live value against its stored baseline, for the scorecard cards
 * (MetricCard's `trend` prop is unused there today, unlike the deep-dive pages which already use it
 * for period-over-period). `lowerIsBetter` flips the color convention for time/ageing metrics vs.
 * rate metrics like FCR where higher is the improvement.
 */
export function baselineTrend(
  current: number | null,
  baseline: KpiBaselineRow | undefined,
  opts: { lowerIsBetter: boolean; formatValue: (v: number | null) => string }
): { direction: "up" | "down" | "flat"; label: string; positive: boolean | null } | undefined {
  if (!baseline || baseline.value === null || current === null) return undefined;
  const baselineText = `Baseline (${baseline.period_label}): ${opts.formatValue(baseline.value)}`;
  if (baseline.value === 0) return { direction: "flat", label: baselineText, positive: null };
  const deltaPct = (current - baseline.value) / baseline.value;
  if (Math.abs(deltaPct) < 0.005) return { direction: "flat", label: baselineText, positive: null };
  const pct = Math.round(deltaPct * 1000) / 10;
  return {
    direction: deltaPct > 0 ? "up" : "down",
    label: `${baselineText} · ${pct > 0 ? "+" : ""}${pct}%`,
    positive: opts.lowerIsBetter ? deltaPct < 0 : deltaPct > 0,
  };
}

/** Same reference line as baselineTrend, but for deep-dive pages where `trend` is already spoken
 * for by the period-over-period comparison — rendered as a second, quiet line instead. */
export function baselineLine(
  baseline: KpiBaselineRow | undefined,
  formatValue: (v: number | null) => string
): { label: string } | undefined {
  if (!baseline || baseline.value === null) return undefined;
  return { label: `Baseline (${baseline.period_label}): ${formatValue(baseline.value)}` };
}
