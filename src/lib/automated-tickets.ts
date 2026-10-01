import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { getTeams, excludedIssueTypes, isExcludedIssueType } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString } from "@/lib/manila-date";
import { basisFor } from "@/lib/lead-cycle-time";
import { escalationTargets, BREAKDOWN_TICKET_LIMIT, ANALYSIS_EXCLUDED_LABELS, toCountRows, groupCounts, type CountRow } from "@/lib/ticket-breakdowns";
import {
  automationLabelSet,
  hasAutomationLabel,
  sanitizeAutomationLabels,
  KNOWN_AUTOMATION_LABELS,
} from "@/lib/automation-labels";
import { defaultGrainFor, bucketKey, enumerateBuckets, type ReviewWaitGrain } from "@/lib/review-wait";
import type { KpiBaselineRow } from "@/lib/kpi-baselines";
import type { Insight } from "@/components/dashboard/InsightsPanel";
import { median } from "@/lib/stats";

/**
 * Assigned SE values that mean "a bot did this, not a person".
 *
 * A list rather than a single string so a second automation account can be added without
 * touching the filter logic. Matched case/whitespace-insensitively.
 */
export const AUTOMATION_ASSIGNED_SE_NAMES = ["Automation for Jira"];

// KNOWN_AUTOMATION_LABELS lives in lib/automation-labels.ts — the browser editor needs it too.
// Re-exported so callers have one import for the report and its inputs.
export { KNOWN_AUTOMATION_LABELS };

/**
 * Statuses whose tickets are dropped from this report entirely.
 *
 * Gaby's call, 2026-09-01. An Archived or Rejected ticket is one nobody ever did the work on, so
 * its lead time measures how long it sat before being written off — not how long automated work
 * takes. Scoped to this report on purpose — it does not change Ticket Volume, FCR, Escalation or
 * Backlog Aging, and the share's DENOMINATOR still counts them (see resolvedInPeriod).
 */
export const EXCLUDED_STATUSES = ["Archived", "Rejected"];

const EXCLUDED_STATUS_SET = new Set(EXCLUDED_STATUSES.map((v) => v.trim().toLowerCase()));

/** Case/whitespace-insensitive, so a Jira rename to "archived" cannot silently re-include it. */
export function isExcludedStatus(status: string | null | undefined): boolean {
  return EXCLUDED_STATUS_SET.has((status || "").trim().toLowerCase());
}

const AUTOMATION_SE_SET = new Set(AUTOMATION_ASSIGNED_SE_NAMES.map((n) => n.trim().toLowerCase()));

/**
 * Assigned SE is an automation account.
 *
 * Assigned SE (customfield_10189) is the basis, never the Jira assignee — the same rule as every
 * other SE metric. 133 ST tickets have "Automation for Jira" as their Jira *assignee* while a real
 * person owns them as Assigned SE; those are a person's work that a bot happened to transition.
 */
export function isBotOwned(row: { assigned_se: string | null }): boolean {
  return AUTOMATION_SE_SET.has((row.assigned_se || "").trim().toLowerCase());
}

/**
 * An automated ticket: the automation account owns it, OR it carries a catalogued automation label.
 *
 * A BLANK Assigned SE is deliberately NOT automation any more (Gaby, 2026-10-01). On ST most blank-SE
 * tickets were raised by a CA and auto-assigned to that same CA — a tagging gap, not a bot. They now
 * live in the page's Data Quality list ("untagged: who to tag") instead of inflating this number.
 *
 * The label clause is Gaby's 2026-09-01 change: adding a label to the catalogue pulls its tickets
 * into the population even when a real person owns them — an automation raised it, and someone
 * picking it up afterwards does not make it manual work.
 */
export function isAutomatedTicket(
  row: { assigned_se: string | null; labels: string | null },
  automationLabels: Set<string>,
  /** Opt-in (cookie, see AUTOMATION_INCLUDE_BLANK_COOKIE): also count a blank Assigned SE — the pre-2026-10-01 rule. */
  includeBlank = false
): boolean {
  if (isBotOwned(row) || hasAutomationLabel(row.labels, automationLabels)) return true;
  return includeBlank && isBlankSe(row);
}

export function isBlankSe(row: { assigned_se: string | null }): boolean {
  return !(row.assigned_se || "").trim();
}

/** How an automated ticket qualified: bot owns it, catalogued label, or (opt-in) blank Assigned SE. */
export function qualifiedByOf(row: { assigned_se: string | null; labels: string | null }, automationLabels: Set<string>): "bot" | "label" | "blank" {
  if (isBotOwned(row)) return "bot";
  if (hasAutomationLabel(row.labels, automationLabels)) return "label";
  return "blank";
}

export type TicketClass = "automated" | "untagged" | "manual";

/** automated > untagged (blank Assigned SE) > manual (a real person owns it). */
export function classifyTicket(
  row: { assigned_se: string | null; labels: string | null },
  automationLabels: Set<string>,
  includeBlank = false
): TicketClass {
  if (isAutomatedTicket(row, automationLabels, includeBlank)) return "automated";
  if (isBlankSe(row)) return "untagged";
  return "manual";
}

/**
 * The Jira assignee, but only when it tells you something the reporter does not.
 *
 * A blank Assigned SE is a tagging gap, and the useful question is "who should have been tagged".
 * Jira's assignee answers that only when it is someone OTHER than the person who raised the ticket
 * — CA tickets are routinely auto-assigned to their own reporter. Compared case- and
 * whitespace-insensitively (two free-text display-name columns).
 */
export function assigneeRepairHint(row: {
  assignee_display_name: string | null;
  reporter_display_name: string | null;
}): string {
  const assignee = (row.assignee_display_name || "").trim();
  if (!assignee) return "";
  const reporter = (row.reporter_display_name || "").trim();
  if (reporter && assignee.toLowerCase() === reporter.toLowerCase()) return "";
  return assignee;
}

// ------------------------------------------------------------------------------ Types

export type AutomatedTicket = {
  issueKey: string;
  issueType: string;
  product: string;
  /**
   * The RAW label CSV, deliberately unfiltered. The hidden-label list is a browser preference, so
   * filtering happens client-side — a pre-filtered string could never have anything put back.
   */
  labels: string;
  assignedSe: string;
  /** How it got into the population: the bot owns it, a catalogued label, or (opt-in) a blank Assigned SE. */
  qualifiedBy: "bot" | "label" | "blank";
  escalation: string;
  leadMinutes: number | null;
  cycleMinutes: number | null;
  createdAt: string;
  resolvedAt: string;
};

/** Lead/cycle stats for one slice of the population. */
export type AutomatedDurationStats = {
  tickets: number;
  leadAvgMinutes: number | null;
  leadMedianMinutes: number | null;
  cycleAvgMinutes: number | null;
  cycleMedianMinutes: number | null;
};

export type AutomatedComparison = {
  previousPeriod: string;
  automatedCount: number;
  resolvedInPeriod: number;
  automatedShare: number | null;
};

export type AutomatedBaseline = {
  share: number | null;
  sampleCount: number;
  periodLabel: string;
  /** "baseline" = stored kpi_baselines row; "live-baseline" = computed on this request. */
  source: "baseline" | "live-baseline" | "none";
};

export type AutomatedVsManualRow = {
  issueType: string;
  automated: AutomatedDurationStats;
  manual: AutomatedDurationStats;
};

export type AutomatedVsManual = {
  automated: AutomatedDurationStats;
  manual: AutomatedDurationStats;
  byIssueType: AutomatedVsManualRow[];
  /**
   * Bot-owned tickets priced at the MANUAL median cycle time of their issue type — an estimate of
   * the calendar cycle time a person would have carried. Calendar time, not effort hours. Only
   * issue types with MANUAL_SAMPLE_MIN+ manual tickets are priced; the rest are counted as uncovered.
   */
  avoided: { tickets: number; pricedTickets: number; minutes: number | null };
  /** Label-qualified tickets a real person owns: the cycle time they put into automation-raised work. */
  absorbed: { tickets: number; cycleMinutes: number | null; avgCycleMinutes: number | null };
};

export type AutomatedPickerRow = {
  name: string;
  tickets: number;
  share: number;
  leadAvgMinutes: number | null;
  leadMedianMinutes: number | null;
  cycleAvgMinutes: number | null;
  topLabels: string[];
};

export type AutomatedTrendPoint = {
  bucket: string;
  resolved: number;
  automated: number;
  botOwned: number;
  labelOnly: number;
  blankSe: number;
  share: number | null;
};

export type AutomatedLabelTrendRow = {
  label: string;
  current: number;
  previous: number;
  delta: number;
  known: boolean;
};

export type UntaggedTicket = {
  issueKey: string;
  issueType: string;
  status: string;
  reporter: string;
  /** Jira assignee when it is someone other than the reporter — a hint for who to tag. */
  jiraAssignee: string;
  resolvedAt: string;
};

export type AutomatedDataQuality = {
  /** Blank Assigned SE, not automated, not Archived/Rejected. */
  untagged: UntaggedTicket[];
  untaggedCount: number;
  /** Blank-SE tickets that were Archived/Rejected — not worked, so not a tagging problem to fix. */
  untaggedExcludedByStatus: number;
  /**
   * Labels on bot-owned tickets that aren't catalogued, with how many tickets resolved in the period
   * carry them anywhere (any owner) — i.e. what cataloguing it would pull in. Raw; the client hides
   * the user's Hidden Labels.
   */
  candidateLabels: { label: string; botTickets: number; allTickets: number }[];
  /** Automated tickets dropped for their status. */
  excludedByStatusCount: number;
};

export type AutomatedTicketsReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  grain: ReviewWaitGrain;
  /** Every ticket resolved in the period, automated or not — the share's denominator. */
  resolvedInPeriod: number;
  automatedCount: number;
  automatedShare: number | null;
  botOwnedCount: number;
  /** Whether blank-Assigned-SE tickets were counted as automated on this request (opt-in toggle). */
  includeBlank: boolean;
  /** Automated only because Assigned SE is blank — 0 unless includeBlank. */
  blankSeCount: number;
  /** In only because of a catalogued label — they DO have a real Assigned SE. */
  includedByLabelOnlyCount: number;
  automationLabels: string[];
  excludedByStatusCount: number;
  excludedStatuses: string[];
  comparison: AutomatedComparison | null;
  baseline: AutomatedBaseline;
  overall: AutomatedDurationStats;
  byIssueType: CountRow[];
  byProduct: CountRow[];
  byEscalation: CountRow[];
  vsManual: AutomatedVsManual;
  pickers: AutomatedPickerRow[];
  trend: AutomatedTrendPoint[];
  labelTrend: AutomatedLabelTrendRow[];
  dataQuality: AutomatedDataQuality;
  insights: Insight[];
  /** What Cycle Time measures for this team, for the page's own prose. */
  cycleTimeDescription: string;
  tickets: AutomatedTicket[];
};

// ------------------------------------------------------------------------------ Helpers

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
const avgOf = (a: number[]) => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null);
const medOf = (a: number[]) => {
  const m = median(a);
  return m === null ? null : round2(m);
};

/** Below this many manual tickets of an issue type, its median isn't trusted to price anything. */
export const MANUAL_SAMPLE_MIN = 5;

function labelsOf(csv: string | null | undefined): string[] {
  return (csv || "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------------------------ Data fetch

type ResolvedRow = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assignee_display_name: string | null;
  reporter_display_name: string | null;
  escalation_value: string | null;
  created: string;
  resolved_datetime: string;
  first_out_of_backlog_todo: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string | null;
};

const FULL_SELECT =
  "issue_key,issue_type,status,product,labels,assigned_se,assignee_display_name," +
  "reporter_display_name,escalation_value," +
  "created,resolved_datetime,first_out_of_backlog_todo,cycle_time_start,cycle_time_end";

/** Enough to classify a ticket and bucket it — the previous period, scorecard and baseline. */
const NARROW_SELECT = "issue_key,issue_type,status,labels,assigned_se,resolved_datetime";

type NarrowRow = Pick<ResolvedRow, "issue_key" | "issue_type" | "status" | "labels" | "assigned_se" | "resolved_datetime">;

/**
 * Every ticket resolved in [startDate, endDate] (Manila days), minus the team's excluded issue
 * types. Coarse UTC prefilter widened a day each side + exact Manila-day check in JS — the same
 * split as lib/ticket-breakdowns.ts.
 *
 * No automation prefilter any more: the deep-dive needs the manual population for its comparison,
 * and the share needs the denominator anyway, so one fetch of all resolved rows serves both.
 */
async function fetchResolved<T extends { resolved_datetime: string; issue_type: string | null }>(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType: string | undefined,
  columns: string
): Promise<T[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  const excluded = excludedIssueTypes(teamKey);

  const rows = await fetchAllRowsParallel<T>((head) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // `any` for the same reason as lib/lead-cycle-time.ts: conditional re-chaining widens
    // supabase-js's builder generics until TS reports "type instantiation is excessively deep".
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .eq("team_key", teamKey)
      .not("resolved_datetime", "is", null)
      .gte("resolved_datetime", rangeStartUtc.toISOString())
      .lte("resolved_datetime", rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return q;
  }, "issue_key");

  return rows.filter((r) => {
    if (isExcludedIssueType(teamKey, r.issue_type)) return false;
    const iso = toManilaDateString(r.resolved_datetime);
    return iso !== null && iso >= startDate && iso <= endDate;
  });
}

/** The share over a set of resolved rows: automated (not Archived/Rejected) ÷ all resolved. */
function shareOf(rows: NarrowRow[], labelSet: Set<string>, includeBlank = false): { automated: number; resolved: number; share: number | null } {
  const automated = rows.filter((r) => !isExcludedStatus(r.status) && isAutomatedTicket(r, labelSet, includeBlank)).length;
  return { automated, resolved: rows.length, share: rows.length ? round4(automated / rows.length) : null };
}

// ------------------------------------------------------------------------------ Baseline

const BASELINE_START = "2026-01-01";
const BASELINE_END = "2026-06-30";
export const AUTOMATED_BASELINE_LABEL = "2026-Q1+Q2";

/**
 * Q1+Q2 2026 automated share, as one pooled rate (automated ÷ resolved over the whole window —
 * the same thing a quarter-weighted combination gives). Computed with the definition passed in;
 * the stored row (lib/kpi-baselines.ts) uses the default: built-in catalogue, blank SE excluded.
 */
export async function computeAutomatedShareBaseline(
  teamKey: string,
  automationLabels: readonly string[] = KNOWN_AUTOMATION_LABELS,
  includeBlank = false
): Promise<{ value: number | null; sampleCount: number }> {
  const rows = await fetchResolved<NarrowRow>(teamKey, BASELINE_START, BASELINE_END, undefined, NARROW_SELECT);
  const s = shareOf(rows, automationLabelSet(sanitizeAutomationLabels(automationLabels)), includeBlank);
  return { value: s.share, sampleCount: s.resolved };
}

async function resolveBaseline(
  teamKey: string,
  stored: KpiBaselineRow | undefined,
  labels: readonly string[],
  includeBlank: boolean
): Promise<AutomatedBaseline> {
  // The stored row is the DEFAULT definition (blank SE excluded). With blank SE included it would
  // compare two different populations, so the baseline is recomputed live under the same rule.
  if (stored && stored.value !== null && !includeBlank) {
    return { share: Number(stored.value), sampleCount: stored.sample_count, periodLabel: stored.period_label, source: "baseline" };
  }
  const live = await computeAutomatedShareBaseline(teamKey, labels, includeBlank);
  return {
    share: live.value,
    sampleCount: live.sampleCount,
    periodLabel: AUTOMATED_BASELINE_LABEL,
    source: live.value === null ? "none" : "live-baseline",
  };
}

// ------------------------------------------------------------------------------ Stats

function durationStats(items: { leadMinutes: number | null; cycleMinutes: number | null }[]): AutomatedDurationStats {
  const lead = items.map((t) => t.leadMinutes).filter((m): m is number => m !== null);
  const cycle = items.map((t) => t.cycleMinutes).filter((m): m is number => m !== null);
  return {
    tickets: items.length,
    leadAvgMinutes: avgOf(lead),
    leadMedianMinutes: medOf(lead),
    cycleAvgMinutes: avgOf(cycle),
    cycleMedianMinutes: medOf(cycle),
  };
}

// ------------------------------------------------------------------------------ Insights

function fmtDur(minutes: number | null): string {
  if (minutes === null) return "—";
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
function pct(n: number | null, digits = 1): string {
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

function buildInsights(r: Omit<AutomatedTicketsReport, "insights">): Insight[] {
  const out: Insight[] = [];
  if (!r.resolvedInPeriod) return out;

  const c = r.comparison;
  if (c && c.automatedShare !== null && r.automatedShare !== null && c.resolvedInPeriod > 0) {
    const pts = Math.round((r.automatedShare - c.automatedShare) * 1000) / 10;
    if (Math.abs(pts) >= 0.5) {
      const up = pts > 0;
      out.push({
        tone: up ? "positive" : "watch",
        text: {
          professional: `Automated share is ${up ? "up" : "down"} ${Math.abs(pts)} pts vs the previous period (${pct(c.automatedShare)} → ${pct(r.automatedShare)}; ${c.automatedCount} → ${r.automatedCount} tickets).`,
          gaby: up
            ? `**Automation is carrying more.** ${pct(c.automatedShare)} → ${pct(r.automatedShare)} of resolved tickets (${c.automatedCount} → ${r.automatedCount}).`
            : `**Automation is carrying less.** ${pct(c.automatedShare)} → ${pct(r.automatedShare)} of resolved tickets (${c.automatedCount} → ${r.automatedCount}).`,
        },
      });
    }
  }

  const b = r.baseline;
  if (b.share !== null && r.automatedShare !== null) {
    const pts = Math.round((r.automatedShare - b.share) * 1000) / 10;
    if (Math.abs(pts) >= 0.5) {
      const up = pts > 0;
      out.push({
        tone: up ? "positive" : "watch",
        text: {
          professional: `${pct(r.automatedShare)} is ${Math.abs(pts)} pts ${up ? "above" : "below"} the ${b.periodLabel} baseline of ${pct(b.share)}.`,
          gaby: `**${up ? "Above" : "Below"} baseline by ${Math.abs(pts)} pts.** ${pct(r.automatedShare)} now vs ${pct(b.share)} in ${b.periodLabel}.`,
        },
      });
    }
  }

  // Insights are server-side and can't see a browser's Hidden Labels, so they skip the default
  // hidden set (workflow/bookkeeping labels like ffup-1) — otherwise "ffup-1 grew" leads the panel.
  const bookkeeping = new Set(ANALYSIS_EXCLUDED_LABELS.map((l) => l.toLowerCase()));
  const grower = r.labelTrend
    .filter((l) => !bookkeeping.has(l.label.toLowerCase()) && l.current >= 3 && l.delta > 0)
    .sort((a, b2) => b2.delta - a.delta)[0];
  if (grower && grower.delta >= 3) {
    out.push({
      tone: "watch",
      text: {
        professional: `"${grower.label}" grew the most: ${grower.previous} → ${grower.current} automated tickets vs the previous period.`,
        gaby: `**"${grower.label}" is on the rise.** ${grower.previous} → ${grower.current} tickets vs last period.`,
      },
    });
  }

  const vm = r.vsManual;
  if (vm.automated.tickets >= 5 && vm.manual.tickets >= 5 && vm.automated.leadMedianMinutes !== null && vm.manual.leadMedianMinutes !== null) {
    const faster = vm.automated.leadMedianMinutes < vm.manual.leadMedianMinutes;
    out.push({
      tone: faster ? "positive" : "watch",
      text: {
        professional: `Median lead time is ${fmtDur(vm.automated.leadMedianMinutes)} for automated tickets vs ${fmtDur(vm.manual.leadMedianMinutes)} for manual ones.`,
        gaby: faster
          ? `**Automated tickets close faster.** Typical lead time ${fmtDur(vm.automated.leadMedianMinutes)} vs ${fmtDur(vm.manual.leadMedianMinutes)} by hand.`
          : `**Automated tickets aren't closing faster.** Typical lead time ${fmtDur(vm.automated.leadMedianMinutes)} vs ${fmtDur(vm.manual.leadMedianMinutes)} by hand — worth a look.`,
      },
    });
  }

  const top = r.pickers[0];
  if (top && r.includedByLabelOnlyCount >= 5 && top.share >= 0.5) {
    out.push({
      tone: "watch",
      text: {
        professional: `${top.name} picked up ${top.tickets} of ${r.includedByLabelOnlyCount} automation-raised tickets that a person owned (${pct(top.share, 0)}).`,
        gaby: `**${top.name} is absorbing most automation follow-up.** ${top.tickets} of ${r.includedByLabelOnlyCount} (${pct(top.share, 0)}).`,
      },
    });
  }

  if (r.dataQuality.untaggedCount > 0) {
    const n = r.dataQuality.untaggedCount;
    out.push({
      tone: "watch",
      text: {
        professional: `${n} resolved ticket${n === 1 ? " has" : "s have"} no Assigned SE and no automation signal — listed under Data quality with who to tag.`,
        gaby: `**${n} untagged ticket${n === 1 ? "" : "s"} to fix.** No Assigned SE and not automation — see Data health check.`,
      },
    });
  }

  return out.slice(0, 6);
}

// ------------------------------------------------------------------------------ Main report

export type AutomatedReportOptions = {
  issueType?: string;
  grain?: ReviewWaitGrain;
  automationLabels?: readonly string[];
  /** Count a blank Assigned SE as automated too (the opt-in toggle). Default false. */
  includeBlank?: boolean;
  baseline?: KpiBaselineRow;
  /** Custom date range (Business Review Prep) — `range` is then "custom" and period a label. */
  start?: string;
  end?: string;
};

const DQ_LIMIT = 100;

/**
 * Automated tickets resolved in the period, against everything else the team resolved.
 *
 * `automationLabels` is the live catalogue (cookie-backed, see lib/automation-labels.ts) and is
 * part of the DEFINITION, not a display filter.
 *
 * Scoped to tickets RESOLVED in the period — the basis FCR/Escalation/On-Hold use. For a
 * peer-review team (ST) the Cycle Time SCORECARD buckets by cycle_time_end rather than by
 * resolution; the span FORMULA is identical (both from basisFor()).
 */
export async function getAutomatedTicketsReport(
  team: string,
  range: string,
  period: string,
  opts: AutomatedReportOptions = {}
): Promise<AutomatedTicketsReport> {
  const labels = sanitizeAutomationLabels(opts.automationLabels ?? KNOWN_AUTOMATION_LABELS);
  const labelSet = automationLabelSet(labels);
  const knownSet = labelSet;
  const includeBlank = opts.includeBlank ?? false;
  const { startDate, endDate } = resolvePeriodToDateRange(range, period, opts.start, opts.end);
  const teamConfig = (await getTeams()).find((t) => t.team_key === team);
  if (!teamConfig) throw new Error(`Unknown team: ${team}`);
  const grain = opts.grain ?? defaultGrainFor(range);

  const leadBasis = basisFor("lead", teamConfig.has_peer_review_tracking);
  const cycleBasis = basisFor("cycle", teamConfig.has_peer_review_tracking);

  // Previous period only exists for the named ranges; a custom range has no shiftable period.
  let prevPeriod: string | null = null;
  if (range !== "custom") {
    try {
      prevPeriod = shiftPeriod(range as RangeType, period, -1);
    } catch {
      prevPeriod = null;
    }
  }
  const prevRange = prevPeriod ? resolvePeriodToDateRange(range, prevPeriod) : null;

  const [rows, prevRows, baseline] = await Promise.all([
    fetchResolved<ResolvedRow>(team, startDate, endDate, opts.issueType, FULL_SELECT),
    prevRange
      ? fetchResolved<NarrowRow>(team, prevRange.startDate, prevRange.endDate, opts.issueType, NARROW_SELECT)
      : Promise.resolve(null),
    // A custom-range caller (Business Review Prep) doesn't render the baseline; skip the fetch.
    range === "custom"
      ? Promise.resolve<AutomatedBaseline>({ share: null, sampleCount: 0, periodLabel: AUTOMATED_BASELINE_LABEL, source: "none" })
      : resolveBaseline(team, opts.baseline, labels, includeBlank),
  ]);

  const finite = (n: number | null) => (n !== null && isFinite(n) ? round2(n) : null);
  const span = (r: ResolvedRow) => ({ leadMinutes: finite(leadBasis.duration(r)), cycleMinutes: finite(cycleBasis.duration(r)) });

  // ---- Partition
  const automatedAll: ResolvedRow[] = [];
  const untaggedAll: ResolvedRow[] = [];
  const manual: ResolvedRow[] = [];
  for (const r of rows) {
    const cls = classifyTicket(r, labelSet, includeBlank);
    if (cls === "automated") automatedAll.push(r);
    else if (cls === "manual" && !isExcludedStatus(r.status)) manual.push(r);
    // Listed under Data quality whether or not the toggle counts them — the who-to-tag hint is
    // useful either way.
    if (classifyTicket(r, labelSet) === "untagged") untaggedAll.push(r);
  }
  const automated = automatedAll.filter((r) => !isExcludedStatus(r.status));
  const excludedByStatusCount = automatedAll.length - automated.length;
  const untagged = untaggedAll.filter((r) => !isExcludedStatus(r.status));

  const resolvedInPeriod = rows.length;
  const automatedShare = resolvedInPeriod ? round4(automated.length / resolvedInPeriod) : null;
  const botOwned = automated.filter((r) => qualifiedByOf(r, labelSet) === "bot");
  const labelOnly = automated.filter((r) => qualifiedByOf(r, labelSet) === "label");
  const blankSe = automated.filter((r) => qualifiedByOf(r, labelSet) === "blank");

  // ---- Tickets (the panel's list)
  const sorted = automated.slice().sort((a, b) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1));
  const toTicket = (r: ResolvedRow): AutomatedTicket => ({
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    product: r.product || "(none)",
    labels: r.labels || "",
    assignedSe: (r.assigned_se || "").trim(),
    qualifiedBy: qualifiedByOf(r, labelSet),
    escalation: (r.escalation_value || "").trim(),
    ...span(r),
    createdAt: r.created,
    resolvedAt: r.resolved_datetime,
  });
  const allTickets = sorted.map(toTicket);
  const tickets = allTickets.slice(0, BREAKDOWN_TICKET_LIMIT);

  // ---- Comparison
  const comparison: AutomatedComparison | null =
    prevPeriod && prevRows
      ? (() => {
          const s = shareOf(prevRows, labelSet, includeBlank);
          return { previousPeriod: prevPeriod, automatedCount: s.automated, resolvedInPeriod: s.resolved, automatedShare: s.share };
        })()
      : null;

  // ---- Automated vs manual
  const manualSpans = manual.map((r) => ({ issueType: r.issue_type || "(none)", ...span(r) }));
  const autoSpans = allTickets.map((t) => ({ issueType: t.issueType || "(none)", leadMinutes: t.leadMinutes, cycleMinutes: t.cycleMinutes }));
  const issueTypesWithAuto = Array.from(new Set(autoSpans.map((s) => s.issueType)));
  const byIssueTypeVs: AutomatedVsManualRow[] = issueTypesWithAuto
    .map((it) => ({
      issueType: it,
      automated: durationStats(autoSpans.filter((s) => s.issueType === it)),
      manual: durationStats(manualSpans.filter((s) => s.issueType === it)),
    }))
    .sort((a, b) => b.automated.tickets - a.automated.tickets || a.issueType.localeCompare(b.issueType));

  const manualMedianCycleByType = new Map<string, number>();
  for (const row of byIssueTypeVs) {
    const cyc = manualSpans.filter((s) => s.issueType === row.issueType && s.cycleMinutes !== null);
    if (cyc.length >= MANUAL_SAMPLE_MIN && row.manual.cycleMedianMinutes !== null) manualMedianCycleByType.set(row.issueType, row.manual.cycleMedianMinutes);
  }
  let avoidedMinutes = 0;
  let priced = 0;
  for (const r of botOwned) {
    const m = manualMedianCycleByType.get(r.issue_type || "(none)");
    if (m === undefined) continue;
    avoidedMinutes += m;
    priced++;
  }
  const absorbedCycles = labelOnly.map((r) => span(r).cycleMinutes).filter((m): m is number => m !== null);

  const vsManual: AutomatedVsManual = {
    automated: durationStats(autoSpans),
    manual: durationStats(manualSpans),
    byIssueType: byIssueTypeVs,
    avoided: { tickets: botOwned.length, pricedTickets: priced, minutes: priced ? round2(avoidedMinutes) : null },
    absorbed: {
      tickets: labelOnly.length,
      cycleMinutes: absorbedCycles.length ? round2(absorbedCycles.reduce((a, b) => a + b, 0)) : null,
      avgCycleMinutes: avgOf(absorbedCycles),
    },
  };

  // ---- Who picks them up (label-qualified tickets with a real Assigned SE)
  const byPicker = new Map<string, ResolvedRow[]>();
  for (const r of labelOnly) {
    const name = (r.assigned_se || "").trim();
    if (!byPicker.has(name)) byPicker.set(name, []);
    byPicker.get(name)!.push(r);
  }
  const pickers: AutomatedPickerRow[] = Array.from(byPicker.entries())
    .map(([name, rs]) => {
      const s = durationStats(rs.map(span));
      const labelCounts = new Map<string, number>();
      for (const r of rs) for (const l of labelsOf(r.labels)) if (knownSet.has(l.toLowerCase())) labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
      return {
        name,
        tickets: rs.length,
        share: labelOnly.length ? round4(rs.length / labelOnly.length) : 0,
        leadAvgMinutes: s.leadAvgMinutes,
        leadMedianMinutes: s.leadMedianMinutes,
        cycleAvgMinutes: s.cycleAvgMinutes,
        topLabels: Array.from(labelCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l),
      };
    })
    .sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name));

  // ---- Trend (within the period)
  const buckets = enumerateBuckets(grain, startDate, endDate);
  const trendMap = new Map(buckets.map((b) => [b.key, { bucket: b.key, resolved: 0, automated: 0, botOwned: 0, labelOnly: 0, blankSe: 0, share: null as number | null }]));
  for (const r of rows) {
    const iso = toManilaDateString(r.resolved_datetime)!;
    const p = trendMap.get(bucketKey(grain, iso));
    if (!p) continue;
    p.resolved++;
    if (isExcludedStatus(r.status) || !isAutomatedTicket(r, labelSet, includeBlank)) continue;
    p.automated++;
    const q = qualifiedByOf(r, labelSet);
    if (q === "bot") p.botOwned++;
    else if (q === "label") p.labelOnly++;
    else p.blankSe++;
  }
  const trend: AutomatedTrendPoint[] = Array.from(trendMap.values()).map((p) => ({ ...p, share: p.resolved ? round4(p.automated / p.resolved) : null }));

  // ---- Label trend: per-label automated ticket counts, this period vs previous
  const countLabels = (rs: { labels: string | null }[]) => {
    const m = new Map<string, { label: string; n: number }>();
    for (const r of rs)
      for (const l of Array.from(new Set(labelsOf(r.labels)))) {
        const k = l.toLowerCase();
        const e = m.get(k);
        if (e) e.n++;
        else m.set(k, { label: l, n: 1 });
      }
    return m;
  };
  const curLabels = countLabels(automated);
  const prevLabels = prevRows ? countLabels(prevRows.filter((r) => !isExcludedStatus(r.status) && isAutomatedTicket(r, labelSet, includeBlank))) : new Map<string, { label: string; n: number }>();
  const labelKeys = new Set([...Array.from(curLabels.keys()), ...Array.from(prevLabels.keys())]);
  const labelTrend: AutomatedLabelTrendRow[] = Array.from(labelKeys)
    .map((k) => {
      const current = curLabels.get(k)?.n ?? 0;
      const previous = prevLabels.get(k)?.n ?? 0;
      return { label: curLabels.get(k)?.label ?? prevLabels.get(k)!.label, current, previous, delta: current - previous, known: knownSet.has(k) };
    })
    .sort((a, b) => b.current - a.current || b.previous - a.previous || a.label.localeCompare(b.label));

  // ---- Data quality
  const allActive = rows.filter((r) => !isExcludedStatus(r.status));
  const allLabelCounts = countLabels(allActive);
  const botLabelCounts = countLabels(botOwned);
  const candidateLabels = Array.from(botLabelCounts.entries())
    .filter(([k]) => !knownSet.has(k))
    .map(([k, v]) => ({ label: v.label, botTickets: v.n, allTickets: allLabelCounts.get(k)?.n ?? v.n }))
    .sort((a, b) => b.botTickets - a.botTickets || a.label.localeCompare(b.label));

  const dataQuality: AutomatedDataQuality = {
    untagged: untagged
      .slice()
      .sort((a, b) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1))
      .slice(0, DQ_LIMIT)
      .map((r) => ({
        issueKey: r.issue_key,
        issueType: r.issue_type || "",
        status: r.status || "",
        reporter: (r.reporter_display_name || "").trim(),
        jiraAssignee: assigneeRepairHint(r),
        resolvedAt: r.resolved_datetime,
      })),
    untaggedCount: untagged.length,
    untaggedExcludedByStatus: untaggedAll.length - untagged.length,
    candidateLabels,
    excludedByStatusCount,
  };

  // ---- Breakdowns over the FULL automated population (not the capped ticket list)
  const byEscalation = (() => {
    const counts: Record<string, number> = {};
    let entries = 0;
    for (const t of allTickets) {
      const targets = escalationTargets(t.escalation);
      if (!targets.length) {
        counts["(not escalated)"] = (counts["(not escalated)"] || 0) + 1;
        entries++;
        continue;
      }
      for (const target of targets) {
        counts[target] = (counts[target] || 0) + 1;
        entries++;
      }
    }
    return toCountRows(counts, entries);
  })();

  const partial: Omit<AutomatedTicketsReport, "insights"> = {
    team,
    range,
    period,
    issueType: opts.issueType ?? null,
    grain,
    resolvedInPeriod,
    automatedCount: automated.length,
    automatedShare,
    botOwnedCount: botOwned.length,
    includeBlank,
    blankSeCount: blankSe.length,
    includedByLabelOnlyCount: labelOnly.length,
    automationLabels: labels,
    excludedByStatusCount,
    excludedStatuses: EXCLUDED_STATUSES,
    comparison,
    baseline,
    overall: vsManual.automated,
    byIssueType: toCountRows(groupCounts(allTickets, (t) => t.issueType || "(none)"), allTickets.length),
    byProduct: toCountRows(groupCounts(allTickets, (t) => t.product), allTickets.length).slice(0, 10),
    byEscalation,
    vsManual,
    pickers,
    trend,
    labelTrend,
    dataQuality,
    cycleTimeDescription: cycleBasis.description,
    tickets,
  };
  return { ...partial, insights: buildInsights(partial) };
}

// ------------------------------------------------------------------------------ Scorecard

export type AutomatedScorecard = {
  automatedCount: number;
  resolvedInPeriod: number;
  automatedShare: number | null;
  previous: { automatedCount: number; resolvedInPeriod: number; automatedShare: number | null } | null;
  includeBlank: boolean;
  /**
   * Q1+Q2 baseline computed live under the SAME definition — only when includeBlank is on, since the
   * stored kpi_baselines row is the default definition. Null otherwise (the page uses the stored row).
   */
  liveBaseline: { value: number | null; sampleCount: number } | null;
};

/**
 * The Team Stats card: this period and the previous one, from the same classification the
 * deep-dive uses (shareOf over the same fetch), so the card and the page it links to agree.
 */
export async function getAutomatedScorecard(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  automationLabels: readonly string[] = KNOWN_AUTOMATION_LABELS,
  includeBlank = false
): Promise<AutomatedScorecard> {
  const labelSet = automationLabelSet(sanitizeAutomationLabels(automationLabels));
  try {
    const cur = resolvePeriodToDateRange(range, period);
    let prev: { startDate: string; endDate: string } | null = null;
    try {
      prev = resolvePeriodToDateRange(range, shiftPeriod(range as RangeType, period, -1));
    } catch {
      prev = null;
    }
    const [curRows, prevRows, liveBaseline] = await Promise.all([
      fetchResolved<NarrowRow>(team, cur.startDate, cur.endDate, issueType, NARROW_SELECT),
      prev ? fetchResolved<NarrowRow>(team, prev.startDate, prev.endDate, issueType, NARROW_SELECT) : Promise.resolve(null),
      includeBlank ? computeAutomatedShareBaseline(team, automationLabels, true) : Promise.resolve(null),
    ]);
    const c = shareOf(curRows, labelSet, includeBlank);
    const p = prevRows ? shareOf(prevRows, labelSet, includeBlank) : null;
    return {
      automatedCount: c.automated,
      resolvedInPeriod: c.resolved,
      automatedShare: c.share,
      previous: p ? { automatedCount: p.automated, resolvedInPeriod: p.resolved, automatedShare: p.share } : null,
      includeBlank,
      liveBaseline,
    };
  } catch (err) {
    console.error("[getAutomatedScorecard] failed:", err);
    return { automatedCount: 0, resolvedInPeriod: 0, automatedShare: null, previous: null, includeBlank, liveBaseline: null };
  }
}
