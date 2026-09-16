import { resolvePeriodToDateRange } from "@/lib/period-range";
import { minutesBetween } from "@/lib/manila-date";
import { getAssigneeMetrics } from "@/lib/metrics";
import { BREAKDOWN_TICKET_LIMIT } from "@/lib/ticket-breakdowns";
import { TOOL_ASSISTED_LABEL } from "@/lib/tool-assisted";
import { fetchAccountCreationTicketRows } from "@/lib/account-creation-data";
import {
  deriveTicketSla,
  deriveDay1StartCompliance,
  businessDaysLate,
  DATA_UNAVAILABLE,
  type AccountCreationTicketSla,
  type TrackType,
  type CutoffSide,
  type OverallSlaStatus,
  type DataUnavailable,
  type Day1StartCompliance,
  type PeerReviewCycleRaw,
} from "@/lib/account-creation-sla";
import {
  buildTicketCycleTimeline,
  summarizeTimeline,
  deriveDelayAttribution,
  isQualifyingReviewExit,
  type DelayArea,
  type CycleStage,
  type CycleTimelineSummary,
  type DelayAttribution as CycleDelayAttribution,
} from "@/lib/account-creation-cycle";

/**
 * Account Creation page-facing report builders — one per Watchtower/Performance/SE Efficiency/
 * Tooling Impact/SE Patterns/Ticket Receipts section. Each does its own fetch (all against the
 * same small ST Account Creation population) rather than one god-report, matching how
 * tool-assisted.ts and ticket-outcomes.ts each expose several focused report functions instead of
 * a single combined shape.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ------------------------------------------------------------------------------- 1. Watchtower

export type WatchtowerCounts = Record<OverallSlaStatus | DataUnavailable, number>;

export type WatchtowerReport = {
  range: string;
  period: string;
  activeCount: number;
  counts: WatchtowerCounts;
  day1NotStartedCount: number;
  seStartComplianceRate: number | null;
  l3EndorsementComplianceRate: number | null;
  l3CompletionComplianceRate: number | null;
  dataLoadingComplianceRate: number | null;
  tickets: AccountCreationTicketSla[];
};

const EMPTY_COUNTS: WatchtowerCounts = {
  on_track: 0, at_risk: 0, breached: 0, completed: 0, pending: 0, data_unavailable: 0,
};

/** Breached first, then at-risk, then unknown, then everything else — the board is read to find what needs attention, not to browse. */
function attentionRank(status: OverallSlaStatus | DataUnavailable): number {
  const order: (OverallSlaStatus | DataUnavailable)[] = ["breached", "at_risk", "data_unavailable", "pending", "on_track", "completed"];
  return order.indexOf(status);
}

export async function getWatchtowerReport(range: string, period: string): Promise<WatchtowerReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();

    // "Currently being worked on" — open tickets created in the selected period. Already-resolved
    // tickets in the period are Performance's population (section 2), not the live board's.
    const active = rows.filter((r) => !r.resolved_datetime).map((r) => deriveTicketSla(r, nowIso));

    const counts: WatchtowerCounts = { ...EMPTY_COUNTS };
    for (const t of active) counts[t.overallStatus]++;

    const applicableStart = active
      .map((t) => deriveDay1StartCompliance(t.day1SeSetup.startedAt, t.day1Date, t.day1SeSetup.dueAt, nowIso))
      .filter((c): c is Exclude<Day1StartCompliance, "not_applicable"> => c !== "not_applicable");
    const onTimeStart = applicableStart.filter((c) => c === "started_on_time").length;

    // "Applicable" = the milestone reached a real end state (on time, late, or a confirmed-missing
    // inference) — mirrors seStartComplianceRate's own applicable/onTime split above.
    const l3Applicable = active.filter((t) =>
      t.day1L3Endorsement.status === "endorsed" || t.day1L3Endorsement.status === "late" || t.day1L3Endorsement.status === "missing"
    );
    const l3OnTime = l3Applicable.filter((t) => t.day1L3Endorsement.status === "endorsed").length;

    const day2Applicable = active.filter((t) => t.day2.status === "completed" || t.day2.status === "late");
    const day2OnTime = day2Applicable.filter((t) => t.day2.status === "completed").length;

    const day3Applicable = active.filter((t) => t.hasDataLoading && (t.day3.status === "completed" || t.day3.status === "late"));
    const day3OnTime = day3Applicable.filter((t) => t.day3.status === "completed").length;

    return {
      range, period,
      activeCount: active.length,
      counts,
      day1NotStartedCount: active.filter((t) => t.day1SeSetup.status === "not_started" || t.day1SeSetup.status === "at_risk").length,
      seStartComplianceRate: applicableStart.length ? round4(onTimeStart / applicableStart.length) : null,
      l3EndorsementComplianceRate: l3Applicable.length ? round4(l3OnTime / l3Applicable.length) : null,
      l3CompletionComplianceRate: day2Applicable.length ? round4(day2OnTime / day2Applicable.length) : null,
      dataLoadingComplianceRate: day3Applicable.length ? round4(day3OnTime / day3Applicable.length) : null,
      tickets: active.sort((a, b) => attentionRank(a.overallStatus) - attentionRank(b.overallStatus)).slice(0, BREAKDOWN_TICKET_LIMIT),
    };
  } catch {
    return {
      range, period, activeCount: 0, counts: { ...EMPTY_COUNTS }, day1NotStartedCount: 0,
      seStartComplianceRate: null, l3EndorsementComplianceRate: null, l3CompletionComplianceRate: null,
      dataLoadingComplianceRate: null, tickets: [],
    };
  }
}

// ---------------------------------------------------------------------------- 2. Performance

export type PerformanceStageStat = {
  withinSla: number;
  late: number;
  total: number;
  complianceRate: number | null;
};

export type PerformanceReport = {
  range: string;
  period: string;
  totalCompleted: number;
  day1SeSetup: PerformanceStageStat;
  day1L3Endorsement: PerformanceStageStat;
  day2: PerformanceStageStat;
  day3: PerformanceStageStat;
};

function stageStat(withinSla: number, late: number): PerformanceStageStat {
  const total = withinSla + late;
  return { withinSla, late, total, complianceRate: total ? round4(withinSla / total) : null };
}

export async function getPerformanceReport(range: string, period: string): Promise<PerformanceReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();

    // "Completed" here means Day 1 Setup reached a real end state (completed or late) — resolving
    // the whole ticket isn't required for the Day 1 stage's own SLA to be measurable.
    const withSla = rows.map((r) => deriveTicketSla(r, nowIso));
    const measured = withSla.filter((t) => t.day1SeSetup.status === "completed" || t.day1SeSetup.status === "late");

    const withinSla = measured.filter((t) => t.day1SeSetup.status === "completed").length;
    const late = measured.filter((t) => t.day1SeSetup.status === "late").length;

    const l3Measured = withSla.filter((t) =>
      t.day1L3Endorsement.status === "endorsed" || t.day1L3Endorsement.status === "late" || t.day1L3Endorsement.status === "missing"
    );
    const day2Measured = withSla.filter((t) => t.day2.status === "completed" || t.day2.status === "late");
    const day3Measured = withSla.filter((t) => t.hasDataLoading && (t.day3.status === "completed" || t.day3.status === "late"));

    return {
      range, period,
      totalCompleted: measured.length,
      day1SeSetup: stageStat(withinSla, late),
      day1L3Endorsement: stageStat(
        l3Measured.filter((t) => t.day1L3Endorsement.status === "endorsed").length,
        l3Measured.filter((t) => t.day1L3Endorsement.status === "late" || t.day1L3Endorsement.status === "missing").length
      ),
      day2: stageStat(
        day2Measured.filter((t) => t.day2.status === "completed").length,
        day2Measured.filter((t) => t.day2.status === "late").length
      ),
      day3: stageStat(
        day3Measured.filter((t) => t.day3.status === "completed").length,
        day3Measured.filter((t) => t.day3.status === "late").length
      ),
    };
  } catch {
    return { range, period, totalCompleted: 0, day1SeSetup: stageStat(0, 0), day1L3Endorsement: stageStat(0, 0), day2: stageStat(0, 0), day3: stageStat(0, 0) };
  }
}

// ------------------------------------------------------------------------- 3. SE Efficiency

export type CycleTimeStats = {
  count: number;
  medianMinutes: number | null;
  avgMinutes: number | null;
  p75Minutes: number | null;
  p90Minutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
};

const EMPTY_CYCLE_STATS: CycleTimeStats = {
  count: 0, medianMinutes: null, avgMinutes: null, p75Minutes: null, p90Minutes: null, minMinutes: null, maxMinutes: null,
};

function median(sortedAsc: number[]): number | null {
  if (!sortedAsc.length) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

/** Nearest-rank percentile — consistent choice across median/p75/p90 rather than mixing methods. */
function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function cycleTimeStats(minutes: number[]): CycleTimeStats {
  if (!minutes.length) return { ...EMPTY_CYCLE_STATS };
  const sorted = [...minutes].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMinutes: round2(median(sorted)!),
    avgMinutes: round2(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p75Minutes: round2(percentile(sorted, 75)!),
    p90Minutes: round2(percentile(sorted, 90)!),
    minMinutes: round2(sorted[0]),
    maxMinutes: round2(sorted[sorted.length - 1]),
  };
}

export type CycleTimeBucket = { label: string; minMinutes: number; maxMinutes: number | null; count: number };

const DISTRIBUTION_BUCKETS: { label: string; minMinutes: number; maxMinutes: number | null }[] = [
  { label: "< 1 hour", minMinutes: 0, maxMinutes: 60 },
  { label: "1–2 hours", minMinutes: 60, maxMinutes: 120 },
  { label: "2–4 hours", minMinutes: 120, maxMinutes: 240 },
  { label: "4–8 hours", minMinutes: 240, maxMinutes: 480 },
  { label: "8–16 hours", minMinutes: 480, maxMinutes: 960 },
  { label: "16–24 hours", minMinutes: 960, maxMinutes: 1440 },
  { label: "> 24 hours", minMinutes: 1440, maxMinutes: null },
];

function distribution(minutes: number[]): CycleTimeBucket[] {
  return DISTRIBUTION_BUCKETS.map((b) => ({
    ...b,
    count: minutes.filter((m) => m >= b.minMinutes && (b.maxMinutes === null || m < b.maxMinutes)).length,
  }));
}

/**
 * Sums the qualifying peer-review (validator) cycles on one ticket — same business rule as
 * lib/tool-assisted.ts's peerReviewFor (exit to On Hold / For Checking only) and
 * lib/peer-review.ts's canonical cycle walk, but WITHOUT tool-assisted.ts's 3-person reviewer
 * allowlist — that allowlist is specific to the Tool-Assisted Efficiency feature's own scope, and
 * Account Creation review isn't limited to those three people. Attribution is `reviewerAtEntry`
 * only (never `reviewer`, which is the assignee when the cycle CLOSED — see peer-review.ts's own
 * doc comment for why that's a real, confirmed misattribution bug when used as a fallback).
 */
function validatorMinutesFor(cycles: PeerReviewCycleRaw[] | null): number | null {
  if (!cycles || !cycles.length) return null;
  let total = 0;
  let counted = 0;
  for (const c of cycles) {
    if (!c.enteredAt || !c.exitedAt) continue;
    const exitedToStatus = (c.exitedToStatus || "").toLowerCase();
    if (exitedToStatus !== "on hold" && exitedToStatus !== "for checking") continue;
    total += minutesBetween(c.enteredAt, c.exitedAt);
    counted++;
  }
  return counted ? round2(total) : null;
}

export type SeEfficiencyReport = {
  range: string;
  period: string;
  /** To Do -> For Peer Review — the SE-owned execution portion. */
  doer: CycleTimeStats;
  /** Time spent IN For Peer Review, from qualifying review cycles — the validator's own portion. */
  validator: CycleTimeStats;
  /** Doer average + validator average, when both exist; whichever one exists otherwise. Same
   * construction as lib/tool-assisted.ts's CycleStats.combinedAvgMinutes, for the same reason:
   * the two stages have different denominators, so summing per-ticket totals would silently drop
   * every ticket missing one side. */
  combinedAvgMinutes: number | null;
  distribution: CycleTimeBucket[];
  byTrackType: { trackType: TrackType | "unclassified"; stats: CycleTimeStats }[];
  byCutoffSide: { cutoffSide: CutoffSide; stats: CycleTimeStats }[];
};

export async function getSeEfficiencyReport(range: string, period: string): Promise<SeEfficiencyReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();
    const withSla = rows.map((r) => ({ sla: deriveTicketSla(r, nowIso), cycles: r.peer_review_cycles_json }));

    const doerMinutesOf = (t: AccountCreationTicketSla) =>
      t.day1SeSetup.startedAt && t.day1SeSetup.completedAt
        ? round2(minutesBetween(t.day1SeSetup.startedAt, t.day1SeSetup.completedAt))
        : null;

    const measurable = withSla
      .map((x) => ({ t: x.sla, doerMinutes: doerMinutesOf(x.sla), validatorMinutes: validatorMinutesFor(x.cycles) }))
      .filter((x) => x.doerMinutes !== null || x.validatorMinutes !== null);

    const byTrack: Record<string, number[]> = {};
    const byCutoff: Record<string, number[]> = {};
    for (const { t, doerMinutes } of measurable) {
      if (doerMinutes === null) continue;
      const trackKey = t.trackType ?? "unclassified";
      (byTrack[trackKey] ??= []).push(doerMinutes);
      (byCutoff[t.cutoffSide] ??= []).push(doerMinutes);
    }

    const doerStats = cycleTimeStats(measurable.map((x) => x.doerMinutes).filter((v): v is number => v !== null));
    const validatorStats = cycleTimeStats(measurable.map((x) => x.validatorMinutes).filter((v): v is number => v !== null));

    return {
      range, period,
      doer: doerStats,
      validator: validatorStats,
      combinedAvgMinutes:
        doerStats.avgMinutes !== null && validatorStats.avgMinutes !== null
          ? round2(doerStats.avgMinutes + validatorStats.avgMinutes)
          : doerStats.avgMinutes ?? validatorStats.avgMinutes,
      distribution: distribution(measurable.map((x) => x.doerMinutes).filter((v): v is number => v !== null)),
      byTrackType: Object.entries(byTrack).map(([trackType, mins]) => ({
        trackType: trackType as TrackType | "unclassified",
        stats: cycleTimeStats(mins),
      })),
      byCutoffSide: Object.entries(byCutoff).map(([cutoffSide, mins]) => ({
        cutoffSide: cutoffSide as CutoffSide,
        stats: cycleTimeStats(mins),
      })),
    };
  } catch {
    return {
      range, period, doer: { ...EMPTY_CYCLE_STATS }, validator: { ...EMPTY_CYCLE_STATS }, combinedAvgMinutes: null,
      distribution: distribution([]), byTrackType: [], byCutoffSide: [],
    };
  }
}

// -------------------------------------------------------------------------- 4. Tooling Impact

export type ToolUsage = "tool_assisted" | "non_tool_assisted" | "unknown";

export type ToolingImpactReport = {
  range: string;
  period: string;
  byUsage: { usage: ToolUsage; stats: CycleTimeStats; slaCompliance: number | null }[];
  /** tool_assisted / (tool_assisted + non_tool_assisted) — excludes unknown from the denominator, since an unresolved case is neither an adoption nor a non-adoption. */
  adoptionRate: number | null;
};

function classifyToolUsage(labels: string | null): ToolUsage {
  // A null/undefined labels column is a genuine data gap (this ticket's labels were never synced),
  // distinct from a present-but-empty string, which reliably means "no labels, including no
  // tool-assisted tag" — see lib/tool-assisted.ts's splitLabels, which this mirrors.
  if (labels === null || labels === undefined) return "unknown";
  const list = labels.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(TOOL_ASSISTED_LABEL) ? "tool_assisted" : "non_tool_assisted";
}

export async function getToolingImpactReport(range: string, period: string): Promise<ToolingImpactReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();
    const withSla = rows.map((r) => ({ sla: deriveTicketSla(r, nowIso), labels: r.labels }));

    const usages: ToolUsage[] = ["tool_assisted", "non_tool_assisted", "unknown"];
    const byUsage = usages.map((usage) => {
      const group = withSla.filter((x) => classifyToolUsage(x.labels) === usage);
      const minutes = group
        .map((x) => (x.sla.day1SeSetup.startedAt && x.sla.day1SeSetup.completedAt
          ? round2(minutesBetween(x.sla.day1SeSetup.startedAt, x.sla.day1SeSetup.completedAt))
          : null))
        .filter((v): v is number => v !== null);
      const measuredDay1 = group.filter((x) => x.sla.day1SeSetup.status === "completed" || x.sla.day1SeSetup.status === "late");
      const onTime = measuredDay1.filter((x) => x.sla.day1SeSetup.status === "completed").length;
      return {
        usage,
        stats: cycleTimeStats(minutes),
        slaCompliance: measuredDay1.length ? round4(onTime / measuredDay1.length) : null,
      };
    });

    const assisted = byUsage.find((b) => b.usage === "tool_assisted")!.stats.count;
    const nonAssisted = byUsage.find((b) => b.usage === "non_tool_assisted")!.stats.count;
    const adoptionDenominator = assisted + nonAssisted;

    return { range, period, byUsage, adoptionRate: adoptionDenominator ? round4(assisted / adoptionDenominator) : null };
  } catch {
    return {
      range, period,
      byUsage: ["tool_assisted", "non_tool_assisted", "unknown"].map((usage) => ({
        usage: usage as ToolUsage, stats: { ...EMPTY_CYCLE_STATS }, slaCompliance: null,
      })),
      adoptionRate: null,
    };
  }
}

// ---------------------------------------------------------------------------- 5. SE Patterns

export type SeStartPattern = {
  seName: string;
  ticketCount: number;
  startedOnTime: number;
  startedLate: number;
  notStarted: number;
  startComplianceRate: number | null;
  avgBusinessDaysLate: number | null;
  maxBusinessDaysLate: number | null;
  /** From getAssigneeMetrics("ST", ...) — whole-team volume for the same period, for workload context. Null if this SE has no row there (e.g. name mismatch). */
  ticketsAssignedAllSt: number | null;
};

export type DelayAttribution = {
  seSideCount: number;
  l3SideCount: number;
  unknownCount: number;
};

export type SePatternsReport = {
  range: string;
  period: string;
  bySe: SeStartPattern[];
  delayAttribution: DelayAttribution;
};

export async function getSePatternsReport(range: string, period: string): Promise<SePatternsReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();
    const withSla = rows.map((r) => deriveTicketSla(r, nowIso));

    const { assignees } = await getAssigneeMetrics("ST", range, period);
    const workloadByName = new Map(assignees.map((a) => [a.name, a.ticketsAssigned]));

    const bySeName = new Map<string, AccountCreationTicketSla[]>();
    for (const t of withSla) {
      if (t.seName === "(unassigned)") continue;
      const existing = bySeName.get(t.seName);
      if (existing) existing.push(t);
      else bySeName.set(t.seName, [t]);
    }

    const bySe: SeStartPattern[] = Array.from(bySeName.entries()).map(([seName, tickets]) => {
      const compliance = tickets
        .map((t) => ({ t, c: deriveDay1StartCompliance(t.day1SeSetup.startedAt, t.day1Date, t.day1SeSetup.dueAt, nowIso) }))
        .filter((x) => x.c !== "not_applicable");

      const onTime = compliance.filter((x) => x.c === "started_on_time").length;
      const late = compliance.filter((x) => x.c === "started_late");
      const notStarted = compliance.filter((x) => x.c === "not_started").length;

      const lateDays = late
        .map((x) => (x.t.day1SeSetup.startedAt ? businessDaysLate(x.t.day1SeSetup.startedAt, x.t.day1Date) : null))
        .filter((v): v is number => v !== null);

      return {
        seName,
        ticketCount: compliance.length,
        startedOnTime: onTime,
        startedLate: late.length,
        notStarted,
        startComplianceRate: compliance.length ? round4(onTime / compliance.length) : null,
        avgBusinessDaysLate: lateDays.length ? round2(lateDays.reduce((s, v) => s + v, 0) / lateDays.length) : null,
        maxBusinessDaysLate: lateDays.length ? Math.max(...lateDays) : null,
        ticketsAssignedAllSt: workloadByName.get(seName) ?? null,
      };
    }).sort((a, b) => b.ticketCount - a.ticketCount);

    // Day 1 Setup lateness is the confirmed, always-attributable SE-owned signal and takes
    // precedence — a ticket late on both Day 1 and an L3 stage counts as SE-side only, never both,
    // so the three buckets always sum to withSla.length.
    const seSideCount = withSla.filter((t) => t.day1SeSetup.status === "late").length;
    const l3SideCount = withSla.filter((t) =>
      t.day1SeSetup.status !== "late" &&
      (t.day1L3Endorsement.status === "late" ||
        t.day1L3Endorsement.status === "missing" ||
        t.day2.status === "late" ||
        (t.hasDataLoading && t.day3.status === "late"))
    ).length;
    const unknownCount = withSla.length - seSideCount - l3SideCount;

    return {
      range, period, bySe,
      delayAttribution: { seSideCount, l3SideCount, unknownCount },
    };
  } catch {
    return { range, period, bySe: [], delayAttribution: { seSideCount: 0, l3SideCount: 0, unknownCount: 0 } };
  }
}

// -------------------------------------------------------------------------- 6. Ticket Receipts

export type TicketReceiptsFilters = {
  seName?: string;
  trackType?: TrackType | "unclassified";
  cutoffSide?: CutoffSide;
  overallStatus?: OverallSlaStatus | DataUnavailable;
  /** Matches against any qualifying peer-review cycle's reviewerAtEntry on the ticket. */
  reviewer?: string;
  delayArea?: DelayArea;
};

/** Per-ticket SE-execution-vs-peer-review data, keyed by issueKey — kept alongside `tickets`
 * (unchanged shape, AccountCreationTicketSla[]) rather than folded into it, so nothing that
 * already reads a plain AccountCreationTicketSla[] elsewhere needs to change. */
export type TicketCycleInfo = {
  stages: CycleStage[];
  summary: CycleTimelineSummary;
  delay: CycleDelayAttribution;
};

export type TicketReceiptsReport = {
  range: string;
  period: string;
  totalCount: number;
  tickets: AccountCreationTicketSla[];
  cycles: Record<string, TicketCycleInfo>;
};

export async function getTicketReceiptsReport(
  range: string,
  period: string,
  filters: TicketReceiptsFilters = {}
): Promise<TicketReceiptsReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();

    let computed = rows.map((r) => {
      const sla = deriveTicketSla(r, nowIso);
      const stages = buildTicketCycleTimeline(r.se_work_cycles_json, r.peer_review_cycles_json, nowIso);
      const summary = summarizeTimeline(stages);
      const delay = deriveDelayAttribution(sla, summary, stages);
      return { sla, stages, summary, delay };
    });

    if (filters.seName) computed = computed.filter((c) => c.sla.seName === filters.seName);
    if (filters.trackType) computed = computed.filter((c) => (c.sla.trackType ?? "unclassified") === filters.trackType);
    if (filters.cutoffSide) computed = computed.filter((c) => c.sla.cutoffSide === filters.cutoffSide);
    if (filters.overallStatus) computed = computed.filter((c) => c.sla.overallStatus === filters.overallStatus);
    if (filters.reviewer) {
      computed = computed.filter((c) => c.stages.some((s) => s.stage === "peer_review" && s.ownerAtStart === filters.reviewer));
    }
    if (filters.delayArea) computed = computed.filter((c) => c.delay.area === filters.delayArea);

    computed.sort((a, b) => (a.sla.created < b.sla.created ? 1 : -1));

    const sliced = computed.slice(0, BREAKDOWN_TICKET_LIMIT);
    const cycles: Record<string, TicketCycleInfo> = {};
    for (const c of sliced) cycles[c.sla.issueKey] = { stages: c.stages, summary: c.summary, delay: c.delay };

    return { range, period, totalCount: computed.length, tickets: sliced.map((c) => c.sla), cycles };
  } catch {
    return { range, period, totalCount: 0, tickets: [], cycles: {} };
  }
}

// ------------------------------------------------------------- 7. Cycle Time Diagnostics (new)

export type DelayBucketCounts = Record<DelayArea, number>;

export type CycleTimeDiagnosticsReport = {
  range: string;
  period: string;
  seWork: CycleTimeStats;
  review: CycleTimeStats;
  total: CycleTimeStats;
  /** Share of tickets with a measurable SE-work/review time whose delay signal fired — independent
   * booleans (see DelayAttribution's doc comment), so these two don't sum to 100% and a ticket can
   * count in both. */
  pctDelayedSeWork: number | null;
  pctDelayedReview: number | null;
  delayCounts: DelayBucketCounts;
  seWorkDistribution: CycleTimeBucket[];
  reviewDistribution: CycleTimeBucket[];
};

const EMPTY_DELAY_COUNTS: DelayBucketCounts = {
  se_work_delay: 0, peer_review_delay: 0, no_significant_delay: 0, unable_to_determine: 0,
};

export async function getCycleTimeDiagnosticsReport(range: string, period: string): Promise<CycleTimeDiagnosticsReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();

    const computed = rows.map((r) => {
      const sla = deriveTicketSla(r, nowIso);
      const timeline = buildTicketCycleTimeline(r.se_work_cycles_json, r.peer_review_cycles_json, nowIso);
      const summary = summarizeTimeline(timeline);
      const delay = deriveDelayAttribution(sla, summary, timeline);
      return { summary, delay };
    });

    const seMinutes = computed.map((c) => c.summary.totalSeWorkMinutes).filter((v): v is number => v !== null);
    const reviewMinutes = computed.map((c) => c.summary.totalReviewMinutes).filter((v): v is number => v !== null);
    const totalMinutes = computed.map((c) => c.summary.totalWorkflowMinutes).filter((v): v is number => v !== null);

    const delayCounts: DelayBucketCounts = { ...EMPTY_DELAY_COUNTS };
    for (const c of computed) delayCounts[c.delay.area]++;

    const seDelayedCount = computed.filter((c) => c.delay.seDelayed).length;
    const reviewDelayedCount = computed.filter((c) => c.delay.reviewDelayed).length;
    const seMeasurableCount = computed.filter((c) => c.summary.totalSeWorkMinutes !== null).length;
    const reviewMeasurableCount = computed.filter((c) => c.summary.totalReviewMinutes !== null).length;

    return {
      range, period,
      seWork: cycleTimeStats(seMinutes),
      review: cycleTimeStats(reviewMinutes),
      total: cycleTimeStats(totalMinutes),
      pctDelayedSeWork: seMeasurableCount ? round4(seDelayedCount / seMeasurableCount) : null,
      pctDelayedReview: reviewMeasurableCount ? round4(reviewDelayedCount / reviewMeasurableCount) : null,
      delayCounts,
      seWorkDistribution: distribution(seMinutes),
      reviewDistribution: distribution(reviewMinutes),
    };
  } catch {
    return {
      range, period, seWork: { ...EMPTY_CYCLE_STATS }, review: { ...EMPTY_CYCLE_STATS }, total: { ...EMPTY_CYCLE_STATS },
      pctDelayedSeWork: null, pctDelayedReview: null, delayCounts: { ...EMPTY_DELAY_COUNTS },
      seWorkDistribution: distribution([]), reviewDistribution: distribution([]),
    };
  }
}

// --------------------------------------------------------------- 8. SE Cycle Role Breakdown (new)

export type SeCycleRoleRow = {
  seName: string;
  /** Tickets worked (As Original SE) or reviews completed (As Reviewer) — a different unit per role, never combined. */
  count: number;
  stats: CycleTimeStats;
};

export type SeCycleRoleReport = {
  range: string;
  period: string;
  asOriginalSe: SeCycleRoleRow[];
  asReviewer: SeCycleRoleRow[];
};

export async function getSeCycleRoleReport(range: string, period: string): Promise<SeCycleRoleReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();

    const byOriginalSe: Record<string, number[]> = {};
    const byReviewer: Record<string, number[]> = {};

    for (const r of rows) {
      const timeline = buildTicketCycleTimeline(r.se_work_cycles_json, r.peer_review_cycles_json, nowIso);
      const summary = summarizeTimeline(timeline);

      // Attributed to the FIRST se_work cycle's owner — the ticket's original SE. A later rework
      // cycle by a DIFFERENT SE (rare — reassignment mid-ticket) still folds into this same
      // person's total-SE-work-time bucket, same "one ticket, one original owner" simplification
      // Section 7's table itself implies ("Tickets worked", not "cycles worked").
      const firstSeStage = timeline.find((s) => s.stage === "se_work");
      if (firstSeStage?.ownerAtStart && summary.totalSeWorkMinutes !== null) {
        (byOriginalSe[firstSeStage.ownerAtStart] ??= []).push(summary.totalSeWorkMinutes);
      }

      // Reviewer side is per-CYCLE, not per-ticket — Section 7 explicitly counts "Reviews
      // completed", and a multi-cycle ticket can legitimately have a different reviewer each time.
      for (const stage of timeline) {
        if (stage.stage !== "peer_review" || !stage.ownerAtStart || stage.durationMinutes === null) continue;
        if (!(stage.endedAt === null || isQualifyingReviewExit(stage.exitedToStatus))) continue;
        (byReviewer[stage.ownerAtStart] ??= []).push(stage.durationMinutes);
      }
    }

    const toRows = (map: Record<string, number[]>): SeCycleRoleRow[] =>
      Object.entries(map)
        .map(([seName, minutes]) => ({ seName, count: minutes.length, stats: cycleTimeStats(minutes) }))
        .sort((a, b) => b.count - a.count);

    return { range, period, asOriginalSe: toRows(byOriginalSe), asReviewer: toRows(byReviewer) };
  } catch {
    return { range, period, asOriginalSe: [], asReviewer: [] };
  }
}

// ----------------------------------------------------------- 9. Account Creation Bottlenecks (new)

export type BottleneckRole = "original_se" | "reviewer";

export type BottleneckRow = {
  seName: string;
  role: BottleneckRole;
  tickets: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  /** Share of this person's own tickets/reviews (in this role) where deriveDelayAttribution
   * pointed the ticket's delay at them specifically — neutral "delay concentration", not a blame
   * count, per Section 8's explicit language guidance. */
  delayRate: number | null;
};

export type BottlenecksReport = {
  range: string;
  period: string;
  rows: BottleneckRow[];
};

export async function getAccountCreationBottlenecksReport(range: string, period: string): Promise<BottlenecksReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchAccountCreationTicketRows(startDate, endDate);
    const nowIso = new Date().toISOString();

    const seAgg: Record<string, { minutes: number[]; delayed: number }> = {};
    const reviewerAgg: Record<string, { minutes: number[]; delayed: number }> = {};

    for (const r of rows) {
      const sla = deriveTicketSla(r, nowIso);
      const timeline = buildTicketCycleTimeline(r.se_work_cycles_json, r.peer_review_cycles_json, nowIso);
      const summary = summarizeTimeline(timeline);
      const delay = deriveDelayAttribution(sla, summary, timeline);

      const firstSeStage = timeline.find((s) => s.stage === "se_work");
      if (firstSeStage?.ownerAtStart && summary.totalSeWorkMinutes !== null) {
        const bucket = (seAgg[firstSeStage.ownerAtStart] ??= { minutes: [], delayed: 0 });
        bucket.minutes.push(summary.totalSeWorkMinutes);
        if (delay.area === "se_work_delay" && delay.owner === firstSeStage.ownerAtStart) bucket.delayed++;
      }

      for (const stage of timeline) {
        if (stage.stage !== "peer_review" || !stage.ownerAtStart || stage.durationMinutes === null) continue;
        if (!(stage.endedAt === null || isQualifyingReviewExit(stage.exitedToStatus))) continue;
        const bucket = (reviewerAgg[stage.ownerAtStart] ??= { minutes: [], delayed: 0 });
        bucket.minutes.push(stage.durationMinutes);
        if (delay.area === "peer_review_delay" && delay.owner === stage.ownerAtStart) bucket.delayed++;
      }
    }

    const toRows = (agg: Record<string, { minutes: number[]; delayed: number }>, role: BottleneckRole): BottleneckRow[] =>
      Object.entries(agg).map(([seName, { minutes, delayed }]) => {
        const stats = cycleTimeStats(minutes);
        return {
          seName, role, tickets: stats.count, avgMinutes: stats.avgMinutes, medianMinutes: stats.medianMinutes,
          p90Minutes: stats.p90Minutes, delayRate: stats.count ? round4(delayed / stats.count) : null,
        };
      });

    const combined = [...toRows(seAgg, "original_se"), ...toRows(reviewerAgg, "reviewer")].sort(
      (a, b) => (b.delayRate ?? 0) - (a.delayRate ?? 0)
    );

    return { range, period, rows: combined };
  } catch {
    return { range, period, rows: [] };
  }
}

export { DATA_UNAVAILABLE };
