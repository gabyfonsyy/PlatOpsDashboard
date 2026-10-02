import { getTeams, type TeamConfig } from "@/lib/teams";
import { getTicketMetrics } from "@/lib/metrics";
import { getP1SlaReport } from "@/lib/p1-sla";
import { getAutomatedTicketsReport } from "@/lib/automated-tickets";
import { getFcrReport } from "@/lib/ticket-breakdowns";
import { getBacklogAgingReport, type BacklogAgingTicket } from "@/lib/backlog-aging";
import { getTicketVolumeBreakdown } from "@/lib/ticket-volume-breakdown";
import { getEndToEndCycleTimeAverage, getEndToEndCycleTimeByIssueType } from "@/lib/business-review-cycle-time";
import { getSpanAveragesByIssueType, type SpanByIssueTypeRow } from "@/lib/lead-cycle-time";
import {
  compareBreakdowns,
  classifyDriver,
  buildDurationDriver,
  detectAnomaly,
  type DriverRow,
  type DriverVerdict,
  type AnomalyResult,
  type MixShiftFlag,
} from "@/lib/business-review-drivers";
import { buildInsightSentence, type Better } from "@/lib/business-review-view";
import {
  getReviewPeriod,
  getReviewPeriodFromStart,
  getPriorReviewPeriods,
  periodKey as buildPeriodKey,
  formatReviewPeriodLabel,
  type ReviewMode,
  type ReviewDateRange,
} from "@/lib/review-periods";
import { getCachedInsight } from "@/lib/work-store";
import { getChecklistState, getTalkingPoints, seedTalkingPointsIfEmpty } from "@/lib/business-review-store";
import { NARRATIVE_CACHE_CONTEXT, narrativeCacheKey, type NarrativeFacts } from "@/lib/business-review-ai";
import { isAiConfigured } from "@/lib/ai";
import type { Theme } from "@/lib/theme";

/**
 * Business Review Prep's orchestrator. Scoped to ONE team (SE / DBA / DevOps) per Gaby's explicit
 * correction — each team has its own metric set, not one org-wide aggregate (see
 * `C:\Users\gabriellef\.claude\plans\deep-herding-valiant.md` for the full design and why).
 */

export type ReviewTeamLabel = "SE" | "DBA" | "DevOps";

const PRIOR_PERIOD_COUNT: Record<ReviewMode, number> = { weekly: 8, monthly: 6, quarterly: 4 };

/** Metrics beyond |15%| or anomaly-flagged are "worth investigating" — named so it's one place to tune. */
const NOTABLE_PCT_DIFF = 15;

export async function resolveReviewTeam(label: ReviewTeamLabel): Promise<TeamConfig> {
  const teams = await getTeams();
  const match = teams.find((t) => t.team_name.trim().toLowerCase() === label.trim().toLowerCase());
  if (!match) throw new Error(`Could not resolve team "${label}" — check teams_config.team_name.`);
  return match;
}

export type MetricComparison = {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  absoluteDiff: number | null;
  pctDiff: number | null;
  isNew: boolean;
  unit: "count" | "days" | "percent";
  driverAvailable: boolean;
  driverDimensionLabel: string | null;
  /** One-line clarification of what the driver table's Previous/Current columns actually count, and
   * how that population relates to the headline number — the breakdown is often a different (or
   * differently-shaped) population than the metric it explains, so its totals need not equal the
   * headline. Shown right above the breakdown table. Null when there's no driver breakdown. See
   * ticket-volume-breakdown.ts's own doc comment for the canonical example (assigned vs all-created). */
  driverNote: string | null;
  /** Which way is good for the headline (Lead/Cycle/Ageing lower; FCR/P1/Automated higher; volume neutral). */
  better: Better;
  /** Which way is good for the breakdown rows' counts — differs from `better` for P1, whose rows
   * count breaches (more breaches = worse) while its headline is an on-time rate. */
  driverBetter: Better;
  driverBreakdown: DriverRow[];
  /**
   * The breakdown's Total row. "sum" for count breakdowns (rows add up exactly — anything past the
   * top drivers is folded into "Other"); "average" for duration breakdowns, where it is the
   * headline team average itself (per-category averages can't be summed).
   */
  driverTotal: { previous: number; current: number; kind: "sum" | "average"; label: string; pctDiff?: number | null } | null;
  /**
   * Ageing Rate only: each breakdown row's own rate (overdue ÷ resolved for that issue type, 0-1),
   * keyed by row key, plus "__total" for the whole team (= the headline). Null elsewhere.
   */
  driverRates: Record<string, { previous: number | null; current: number | null }> | null;
  driverVerdict: DriverVerdict;
  /** Set only for a duration driver (Lead/Cycle Time) when no single category's own pace explains
   * the change but a shift in ticket mix (toward inherently slower/faster categories) explains a
   * notable share of it — see buildDurationDriver in lib/business-review-drivers.ts. Null for every
   * count/rate-based metric, and null whenever mix shift isn't the dominant unexplained factor. */
  mixShift: MixShiftFlag | null;
  anomaly: AnomalyResult | null;
  insight: string;
  /** "ai" only when a cached AI narrative was found; the page never calls the model itself.
   * "deterministic" is what renders while there's no cached AI take yet — MetricComparisonCard
   * shows a "Get AI take" button in that case, iff `BusinessReview.aiAvailable`. */
  insightSource: "ai" | "deterministic";
  source: string;
  calculation: string;
  recordCount: number;
};

export type ExecutiveSummary = {
  keyChanges: { metricKey: string; label: string; pctDiff: number | null; better: Better; insight: string }[];
  investigate: string[];
};

export type BusinessReview = {
  /** Whether AI_API_KEY is configured at all — gates whether "Get AI take" renders anywhere. */
  aiAvailable: boolean;
  team: ReviewTeamLabel;
  teamKey: string;
  mode: ReviewMode;
  periodKey: string;
  current: ReviewDateRange;
  previous: ReviewDateRange;
  currentLabel: string;
  previousLabel: string;
  metrics: MetricComparison[];
  executiveSummary: ExecutiveSummary;
  checklistState: Record<string, boolean>;
  talkingPoints: { id: string; content: string; position: number }[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fallback breakdown note by unit, used when a spec doesn't set its own `driverNote`. Duration and
 * rate breakdowns don't share the headline's units at all (per-issue-type averages, or composition
 * COUNTS behind a percentage), so their columns never sum to the headline — say so explicitly rather
 * than let a reader assume the table should reconcile.
 */
function defaultDriverNote(unit: MetricComparison["unit"]): string {
  if (unit === "days") {
    return "Previous/Current are the average days for each category (not ticket counts); the headline is their volume-weighted average across all categories, so the rows don't sum to it.";
  }
  if (unit === "percent") {
    return "Previous/Current are ticket counts making up this rate, not the rate itself — they show what the percentage is composed of and won't sum to the headline figure.";
  }
  return "Previous/Current are ticket counts by category and sum to the breakdown total shown below.";
}

function pctDiffOf(current: number, previous: number): { pctDiff: number | null; isNew: boolean } {
  if (previous === 0 && current === 0) return { pctDiff: null, isNew: false };
  if (previous === 0) return { pctDiff: null, isNew: true };
  return { pctDiff: round2(((current - previous) / previous) * 100), isNew: false };
}

function sumCounts(rows: { count: number }[]): number {
  return rows.reduce((sum, r) => sum + r.count, 0);
}

const MINUTES_PER_DAY = 1440;

function minutesToDays(minutes: number | null): number | null {
  return minutes === null ? null : round2(minutes / MINUTES_PER_DAY);
}

/** A { key: count } map as CountRow-shaped rows for buildDriver. */
function countRowsOf(m: Record<string, number>) {
  const total = Object.values(m).reduce((a, b) => a + b, 0);
  return Object.entries(m).map(([key, count]) => ({ key, count, share: total ? count / total : null }));
}

function overdueByIssueType(tickets: BacklogAgingTicket[]) {
  const counts: Record<string, number> = {};
  for (const t of tickets) counts[t.issueType || "(none)"] = (counts[t.issueType || "(none)"] || 0) + 1;
  return Object.entries(counts).map(([key, count]) => ({ key, count, share: tickets.length ? count / tickets.length : null }));
}

/**
 * Deterministic driver rows + verdict for a metric, from two already-scoped CountRow-shaped
 * populations. `metricDelta` is the HEADLINE metric's own (current - previous), not the breakdown's. A driver
 * breakdown is sometimes built from a different underlying population than the metric it explains
 * (e.g. Ticket Volume's headline number is metrics_daily's assigned_count, but its breakdown counts
 * tickets CREATED in the period — see ticket-volume-breakdown.ts's own doc comment on this gap).
 * When the two disagree on DIRECTION — the breakdown's total went down while the headline metric
 * went up, or vice versa — attributing the metric's movement to that breakdown is unsound even if
 * the breakdown is internally sign-consistent, so the verdict is forced to "none" rather than
 * asserting a cause from a population that moved the opposite way. Found live verifying against
 * real Supabase data: SE Ticket Volume (assigned_count) rose while its created-tickets breakdown
 * fell, and the naive version of this function produced "Ticket Volume increased... driven by
 * Backend Changes (-17)" — correct arithmetic, misleading sentence.
 */
function buildDriver(
  previousRows: { key: string; count: number }[],
  currentRows: { key: string; count: number }[],
  metricDelta: number,
  /**
   * "same": the breakdown counts the metric's own population, so more of it should move the
   * metric the same way (Ticket Volume, Automated Tickets, Ageing Rate — that metric IS a "bad
   * outcome" share, so more bad-outcome tickets raises it).
   * "inverse": the breakdown counts a BAD-outcome population but the metric is framed as a GOOD-
   * outcome rate (P1 SLA Compliance's byHoldingReason counts breaches; more breaches means a
   * LOWER on-time rate, not a higher one) — the two must move opposite ways to be consistent.
   */
  expectedRelationship: "same" | "inverse" = "same"
) {
  const totalChange = sumCounts(currentRows) - sumCounts(previousRows);
  const rows = compareBreakdowns(
    previousRows.map((r) => ({ key: r.key, count: r.count, share: null })),
    currentRows.map((r) => ({ key: r.key, count: r.count, share: null })),
    totalChange
  );
  const expectedSign = expectedRelationship === "same" ? Math.sign(metricDelta) : -Math.sign(metricDelta);
  const directionsAgree = Math.sign(totalChange) === 0 || expectedSign === 0 || Math.sign(totalChange) === expectedSign;
  return { rows, verdict: directionsAgree ? classifyDriver(rows) : ("none" as const) };
}

/**
 * Reads the AI narrative cache — NEVER calls the model. The only place that calls the model for
 * Business Review Prep is api/ai/business-review-narrative/route.ts, and only when she explicitly
 * clicks "Get AI take" on a card (per her instruction: the AI call happens once, and only when
 * asked — the same on-demand posture the Overview's daily assessment already uses, triggered by
 * AssessmentHeader rather than generated on every render). Keeping the live call out of this
 * render path is also what makes the page fast: no metric ever waits on a model round-trip to
 * paint. Once she's asked for one narrative, every later render of that exact (metric, period)
 * finds it here and never calls the model again for it.
 */
async function narrativeFor(facts: NarrativeFacts, email: string | null): Promise<{ text: string; source: "ai" | "deterministic" }> {
  const fallback = buildInsightSentence(facts.metricLabel, facts.pctDiff, facts.isNew, facts.driverRows, facts.verdict, facts.theme as Theme, facts.mixShift);
  if (!email) return { text: fallback, source: "deterministic" };

  try {
    const { entityId, version } = narrativeCacheKey(facts);
    const cached = await getCachedInsight<{ narrative: string }>(email, NARRATIVE_CACHE_CONTEXT, entityId, version);
    if (cached?.content.narrative) return { text: cached.content.narrative, source: "ai" };
  } catch {
    // A cache read failing must behave exactly like a cache miss.
  }
  return { text: fallback, source: "deterministic" };
}

type MetricSpec = {
  key: string;
  label: string;
  unit: MetricComparison["unit"];
  current: number | null;
  previous: number | null;
  history: number[];
  driver: { rows: DriverRow[]; verdict: DriverVerdict; dimensionLabel: string; mixShift?: MixShiftFlag | null } | null;
  /**
   * Unrounded current/previous for the % change. Duration metrics display days rounded to 2
   * decimals, and a % change taken from those rounded values drifts badly on small numbers
   * (DBA Lead Time 0.3158 -> 0.3606 days is +14.19%, but 0.32 -> 0.36 reads +12.5%).
   */
  exact?: { current: number | null; previous: number | null };
  /** Per-key denominators (resolved tickets by issue type) for MetricComparison.driverRates. */
  rateDenominators?: { previous: Record<string, number>; current: Record<string, number> };
  /** See MetricComparison.driverNote. Null falls back to a generic note in buildComparison. */
  driverNote?: string | null;
  source: string;
  calculation: string;
  recordCount: number;
};

/**
 * Duration-driver rows are computed in minutes (basisFor's native unit) but every duration metric
 * on this page displays in days (minutesToDays) — converts a Lead/Cycle Time by-issue-type
 * breakdown into buildDurationDriver's input shape in that same display unit, so the driver table's
 * Previous/Current/Change match the headline card exactly rather than needing their own conversion.
 */
function toDurationDriverRows(rows: SpanByIssueTypeRow[] | { issueType: string; count: number; avgMinutes: number }[]) {
  return rows.map((r) => ({ key: r.issueType, count: r.count, avgValue: minutesToDays(r.avgMinutes) ?? 0 }));
}

function buildDurationSpecDriver(
  previousRows: { issueType: string; count: number; avgMinutes: number }[],
  currentRows: { issueType: string; count: number; avgMinutes: number }[]
) {
  const { rows, verdict, mixShift } = buildDurationDriver(toDurationDriverRows(previousRows), toDurationDriverRows(currentRows));
  return { rows, verdict, mixShift, dimensionLabel: "Issue Type" };
}

/**
 * Rate per breakdown row = row count ÷ that key's denominator. "Other" (the roll-up of keys past
 * the top drivers) uses every key not shown as its own row, so its rate is still exact.
 */
function ratesOf(
  rows: DriverRow[],
  den: { previous: Record<string, number>; current: Record<string, number> }
): MetricComparison["driverRates"] {
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 10000 : null);
  const sumOf = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const named = rows.filter((r) => r.key !== "Other").map((r) => r.key);
  const otherDen = (m: Record<string, number>) => sumOf(m) - named.reduce((a, k) => a + (m[k] || 0), 0);
  const out: NonNullable<MetricComparison["driverRates"]> = {};
  for (const r of rows) {
    const dp = r.key === "Other" ? otherDen(den.previous) : den.previous[r.key] || 0;
    const dc = r.key === "Other" ? otherDen(den.current) : den.current[r.key] || 0;
    out[r.key] = { previous: rate(r.previous, dp), current: rate(r.current, dc) };
  }
  out.__total = {
    previous: rate(rows.reduce((a, r) => a + r.previous, 0), sumOf(den.previous)),
    current: rate(rows.reduce((a, r) => a + r.current, 0), sumOf(den.current)),
  };
  return out;
}

const METRIC_BETTER: Record<string, Better> = {
  ticket_volume: "neutral",
  lead_time: "lower",
  cycle_time: "lower",
  ageing_rate: "lower",
  p1_sla_compliance: "higher",
  automated_tickets: "higher",
  fcr: "higher",
};

function totalOf(spec: MetricSpec, rows: DriverRow[]): MetricComparison["driverTotal"] {
  if (!spec.driver || !rows.length) return null;
  // Duration metrics: the Total row IS the headline (the team average), so the card and the table
  // agree exactly (Gaby, 2026-10-02). The rows above are the per-issue-type breakdown; they come from
  // a separate per-type query and are not re-averaged into this number.
  if (spec.unit === "days") {
    const toDays = (m: number | null | undefined) => (m === null || m === undefined ? null : Math.round((m / MINUTES_PER_DAY) * 10000) / 10000);
    const previous = spec.exact ? toDays(spec.exact.previous) : spec.previous;
    const current = spec.exact ? toDays(spec.exact.current) : spec.current;
    return previous === null || current === null ? null : { previous, current, kind: "average", label: "Team average" };
  }
  return {
    previous: rows.reduce((n, r) => n + r.previous, 0),
    current: rows.reduce((n, r) => n + r.current, 0),
    kind: "sum",
    // P1 holding reasons count one per hold, so a ticket held twice adds two.
    label: spec.key === "p1_sla_compliance" ? "Total holds" : "Total",
  };
}

async function buildComparison(spec: MetricSpec, theme: Theme, email: string | null): Promise<MetricComparison> {
  const current = spec.current ?? 0;
  const previous = spec.previous ?? 0;
  const { pctDiff, isNew } = spec.exact ? pctDiffOf(spec.exact.current ?? 0, spec.exact.previous ?? 0) : pctDiffOf(current, previous);
  const anomaly = spec.history.length ? detectAnomaly(current, spec.history) : null;
  const driverRows = spec.driver?.rows ?? [];
  const driverVerdict = spec.driver?.verdict ?? "none";
  const mixShift = spec.driver?.mixShift ?? null;

  const { text: insight, source: insightSource } = await narrativeFor(
    {
      metricLabel: spec.label,
      current,
      previous,
      pctDiff,
      isNew,
      driverRows,
      verdict: driverVerdict,
      theme,
      mixShift,
    },
    email
  );

  return {
    key: spec.key,
    label: spec.label,
    current: spec.current,
    previous: spec.previous,
    absoluteDiff: spec.current !== null && spec.previous !== null ? round2(spec.current - spec.previous) : null,
    pctDiff,
    isNew,
    unit: spec.unit,
    driverAvailable: spec.driver !== null,
    driverDimensionLabel: spec.driver?.dimensionLabel ?? null,
    driverNote: spec.driver ? (spec.driverNote ?? defaultDriverNote(spec.unit)) : null,
    better: METRIC_BETTER[spec.key] ?? "neutral",
    driverBetter: spec.key === "p1_sla_compliance" ? "lower" : METRIC_BETTER[spec.key] ?? "neutral",
    driverBreakdown: driverRows,
    driverTotal: (() => {
      const t = totalOf(spec, driverRows);
      // An average Total is the headline, so it shows the headline's exact % (not one recomputed
      // from the rounded days it displays).
      return t && t.kind === "average" ? { ...t, pctDiff } : t;
    })(),
    driverRates: spec.rateDenominators ? ratesOf(driverRows, spec.rateDenominators) : null,
    driverVerdict,
    mixShift,
    anomaly,
    insight,
    insightSource,
    source: spec.source,
    calculation: spec.calculation,
    recordCount: spec.recordCount,
  };
}

const CHECKLIST_ITEM_KEYS = [
  "ticket_volume", "sla_exceptions", "cycle_time", "backlog_aging",
  "unusual_spikes", "team_changes", "operational_incidents", "talking_points",
] as const;

export async function getBusinessReview(
  teamLabel: ReviewTeamLabel,
  mode: ReviewMode,
  theme: Theme,
  /** The desired "current" period's own start date (e.g. from a `?period=` URL param) — NOT an
   * arbitrary "today" anchor. Omit for the live (most recently completed) period. */
  currentPeriodStart?: string,
  email?: string | null
): Promise<BusinessReview> {
  const team = await resolveReviewTeam(teamLabel);
  // Resolving a SPECIFIC period's start uses getReviewPeriodFromStart (a direct computation), not
  // the anchor-based getReviewPeriod functions — those two have different semantics on purpose,
  // see getReviewPeriodFromStart's own doc comment for the bug this distinction fixes.
  const { current: resolvedCurrent, previous: resolvedPrevious } = currentPeriodStart
    ? getReviewPeriodFromStart(mode, currentPeriodStart)
    : getReviewPeriod(mode);

  const priorPeriods = getPriorReviewPeriods(mode, resolvedCurrent.start, PRIOR_PERIOD_COUNT[mode]);
  const key = buildPeriodKey(team.team_key, mode, resolvedCurrent.start);

  const isSe = teamLabel === "SE";

  // All five waves are independent of each other's results (none reads another wave's output to
  // build its own request), so they're fired together in ONE outer Promise.all — each inner
  // Promise.all/call still starts immediately, rather than running one after another. This was a
  // real, measured contributor to the page's slow load: several sequential round-trips instead of
  // one concurrent one. (Checklist/talking points don't need metrics to be READ — only the later
  // seed step, which needs keyChanges, does.)
  const [
    [currentTM, previousTM, ...priorTMs],
    [currentVolByType, previousVolByType, currentAging, previousAging, priorVolByType],
    seReports,
    personalState,
    [leadByTypeCurrent, leadByTypePrevious, cycleByTypeCurrent, cycleByTypePrevious],
  ] = await Promise.all([
      Promise.all([
        getTicketMetrics(team.team_key, "custom", key, undefined, resolvedCurrent.start, resolvedCurrent.end),
        getTicketMetrics(team.team_key, "custom", key, undefined, resolvedPrevious.start, resolvedPrevious.end),
        ...priorPeriods.map((p) => getTicketMetrics(team.team_key, "custom", key, undefined, p.start, p.end)),
      ]),
      Promise.all([
        getTicketVolumeBreakdown(team.team_key, resolvedCurrent.start, resolvedCurrent.end, "issue_type"),
        getTicketVolumeBreakdown(team.team_key, resolvedPrevious.start, resolvedPrevious.end, "issue_type"),
        getBacklogAgingReport(team.team_key, "custom", key, undefined, resolvedCurrent.start, resolvedCurrent.end),
        getBacklogAgingReport(team.team_key, "custom", key, undefined, resolvedPrevious.start, resolvedPrevious.end),
        // Ticket Volume's headline is ALL created tickets (same set as its breakdown), so its anomaly
        // history has to be that set too, not metrics_daily's assigned-only count.
        Promise.all(priorPeriods.map((p) => getTicketVolumeBreakdown(team.team_key, p.start, p.end, "issue_type"))),
      ]),
      isSe
        ? Promise.all([
            getP1SlaReport(team.team_key, "custom", key, undefined, undefined, resolvedCurrent.start, resolvedCurrent.end),
            getP1SlaReport(team.team_key, "custom", key, undefined, undefined, resolvedPrevious.start, resolvedPrevious.end),
            getAutomatedTicketsReport(team.team_key, "custom", key, { start: resolvedCurrent.start, end: resolvedCurrent.end }),
            getAutomatedTicketsReport(team.team_key, "custom", key, { start: resolvedPrevious.start, end: resolvedPrevious.end }),
            getFcrReport(team.team_key, "custom", key, undefined, resolvedCurrent.start, resolvedCurrent.end),
            getFcrReport(team.team_key, "custom", key, undefined, resolvedPrevious.start, resolvedPrevious.end),
            getEndToEndCycleTimeAverage(team.team_key, resolvedCurrent.start, resolvedCurrent.end),
            getEndToEndCycleTimeAverage(team.team_key, resolvedPrevious.start, resolvedPrevious.end),
            Promise.all(priorPeriods.map((p) => getEndToEndCycleTimeAverage(team.team_key, p.start, p.end))),
            // FCR's headline uses getFcrReport's rate (blank FCR excluded, as on the FCR page), so its
            // history must too.
            Promise.all(priorPeriods.map((p) => getFcrReport(team.team_key, "custom", key, undefined, p.start, p.end))),
          ])
        : Promise.resolve(null),
      email ? Promise.all([getChecklistState(email, key), getTalkingPoints(email, key)]) : Promise.resolve(null),
      // Lead Time's by-issue-type driver breakdown applies identically to every team. Cycle Time's
      // does not: SE's Cycle Time headline (below) deliberately uses a different, narrower span
      // definition than lead-cycle-time.ts's basisFor (see getEndToEndCycleTimeByIssueType's doc
      // comment), so its driver breakdown must be fetched the same way or the two would disagree.
      Promise.all([
        getSpanAveragesByIssueType(team.team_key, "lead", team.has_peer_review_tracking, resolvedCurrent.start, resolvedCurrent.end),
        getSpanAveragesByIssueType(team.team_key, "lead", team.has_peer_review_tracking, resolvedPrevious.start, resolvedPrevious.end),
        isSe
          ? getEndToEndCycleTimeByIssueType(team.team_key, resolvedCurrent.start, resolvedCurrent.end)
          : getSpanAveragesByIssueType(team.team_key, "cycle", team.has_peer_review_tracking, resolvedCurrent.start, resolvedCurrent.end),
        isSe
          ? getEndToEndCycleTimeByIssueType(team.team_key, resolvedPrevious.start, resolvedPrevious.end)
          : getSpanAveragesByIssueType(team.team_key, "cycle", team.has_peer_review_tracking, resolvedPrevious.start, resolvedPrevious.end),
      ]),
    ]);

  const specs: MetricSpec[] = [
    {
      key: "ticket_volume", label: "Ticket Volume", unit: "count",
      // ALL tickets created (assigned + unassigned) — the same set as the breakdown below, so the
      // headline and the table's Total agree (Gaby, 2026-10-02). Previously the headline was
      // metrics_daily's assigned-only count while the table counted everything.
      current: currentVolByType.totalTickets, previous: previousVolByType.totalTickets,
      history: priorVolByType.map((v) => v.totalTickets),
      driver: { ...buildDriver(previousVolByType.rows, currentVolByType.rows, currentVolByType.totalTickets - previousVolByType.totalTickets), dimensionLabel: "Issue Type" },
      driverNote: "All tickets created in the period (assigned + unassigned), by issue type. The Total row is the headline.",
      source: "Supabase tickets (created in period)",
      calculation: "Count of all tickets created during the reporting period (assigned and unassigned), by issue type.",
      recordCount: currentVolByType.totalTickets,
    },
    {
      key: "lead_time", label: "Lead Time", unit: "days",
      current: minutesToDays(currentTM.leadTimeAvgMinutes), previous: minutesToDays(previousTM.leadTimeAvgMinutes),
      exact: { current: currentTM.leadTimeAvgMinutes, previous: previousTM.leadTimeAvgMinutes },
      history: priorTMs.map((m) => minutesToDays(m.leadTimeAvgMinutes)).filter((n): n is number => n !== null),
      driver: buildDurationSpecDriver(leadByTypePrevious, leadByTypeCurrent),
      source: "Supabase tickets (live span average)",
      calculation: "Average days from ticket creation to resolution, for tickets resolved in the period.",
      recordCount: currentTM.ticketsResolvedInPeriod,
    },
    {
      key: "cycle_time", label: "Cycle Time", unit: "days",
      current: minutesToDays(currentTM.cycleTimeAvgMinutes), previous: minutesToDays(previousTM.cycleTimeAvgMinutes),
      exact: { current: currentTM.cycleTimeAvgMinutes, previous: previousTM.cycleTimeAvgMinutes },
      history: priorTMs.map((m) => minutesToDays(m.cycleTimeAvgMinutes)).filter((n): n is number => n !== null),
      // For SE this is overwritten below with the end-to-end values, but NOT the driver — it's
      // already built from the same cycleByType source getEndToEndCycleTimeByIssueType provides,
      // which matches the end-to-end definition SE's override uses.
      driver: buildDurationSpecDriver(cycleByTypePrevious, cycleByTypeCurrent),
      source: "Supabase tickets (live span average)",
      calculation: "Average days of active work time, for tickets resolved in the period.",
      recordCount: currentTM.ticketsResolvedInPeriod,
    },
    {
      key: "ageing_rate", label: "Ageing Rate", unit: "percent",
      current: currentTM.backlogAgingRate !== null ? round2(currentTM.backlogAgingRate * 100) : null,
      previous: previousTM.backlogAgingRate !== null ? round2(previousTM.backlogAgingRate * 100) : null,
      history: priorTMs.map((m) => m.backlogAgingRate).filter((n): n is number => n !== null).map((n) => round2(n * 100)),
      driver: {
        ...buildDriver(
          overdueByIssueType(previousAging.tickets),
          overdueByIssueType(currentAging.tickets),
          (currentTM.backlogAgingRate ?? 0) - (previousTM.backlogAgingRate ?? 0)
        ),
        dimensionLabel: "Issue Type",
      },
      driverNote:
        "Previous/Current are counts of OVERDUE tickets by issue type, with that issue type's own Ageing Rate (overdue ÷ resolved for that type) underneath. The Total row's rate is the headline.",
      rateDenominators: { previous: previousAging.resolvedByIssueType, current: currentAging.resolvedByIssueType },
      source: "Supabase tickets (resolved after due date)",
      calculation: "Share of tickets resolved in the period that were resolved after their due date; driver breakdown is the composition of those overdue tickets, by issue type.",
      recordCount: currentAging.resolvedInPeriod,
    },
  ];

  if (isSe && seReports) {
    const [currentP1, previousP1, currentAuto, previousAuto, currentFcr, previousFcr, currentEte, previousEte, priorEte, priorFcr] = seReports;

    // Cycle Time, for SE only, is END-TO-END: average Doer span (Backlog/To Do exit -> reached
    // review) + average Validator (completed peer-review wait) — the same number as the team-page
    // Cycle Time card and the cycle_time_total baseline (Gaby, 2026-10-02). Replaces the base specs
    // array's single-stage value above, which is only right for DBA/DevOps (no validator stage).
    const cycleTimeSpec = specs.find((s) => s.key === "cycle_time")!;
    cycleTimeSpec.current = minutesToDays(currentEte.avgMinutes);
    cycleTimeSpec.previous = minutesToDays(previousEte.avgMinutes);
    cycleTimeSpec.exact = { current: currentEte.avgMinutes, previous: previousEte.avgMinutes };
    cycleTimeSpec.history = priorEte.map((e) => minutesToDays(e.avgMinutes)).filter((n): n is number => n !== null);
    cycleTimeSpec.recordCount = currentEte.recordCount;
    cycleTimeSpec.calculation =
      "End-to-end: average Doer time (moved out of Backlog/To Do → reached review: For Peer Review, For Checking, For Product Team, Archived or Rejected) plus average Validator time (completed peer-review wait) — for tickets whose cycle closed in the period. Same as the team-page Cycle Time card.";

    specs.push(
      {
        key: "p1_sla_compliance", label: "P1 SLA Compliance", unit: "percent",
        current: currentP1.onTimeRate !== null ? round2(currentP1.onTimeRate * 100) : null,
        previous: previousP1.onTimeRate !== null ? round2(previousP1.onTimeRate * 100) : null,
        history: [],
        driver: {
          ...buildDriver(
            previousP1.byHoldingReason,
            currentP1.byHoldingReason,
            (currentP1.onTimeRate ?? 0) - (previousP1.onTimeRate ?? 0),
            "inverse"
          ),
          dimensionLabel: "Holding Reason",
        },
        driverNote:
          "Previous/Current are counts of P1 tickets by holding reason (breaches) — the composition behind the rate, not the rate itself. More breaches LOWERS the on-time rate, so this table moves opposite the headline.",
        source: "Supabase tickets (P1 / Very Urgent priority)",
        calculation: "Share of decided P1 tickets resolved on time; driver breakdown is the composition of P1 tickets by holding reason.",
        recordCount: currentP1.decided,
      },
      {
        key: "automated_tickets", label: "Automated Tickets", unit: "count",
        current: currentAuto.automatedCount, previous: previousAuto.automatedCount,
        history: [],
        driver: {
          ...buildDriver(previousAuto.byIssueType, currentAuto.byIssueType, currentAuto.automatedCount - previousAuto.automatedCount),
          dimensionLabel: "Issue Type",
        },
        driverNote:
          "Previous/Current are counts of automated tickets resolved in the period, by issue type — this table sums to the headline count.",
        source: "Supabase tickets (automation-owned or automation-labelled)",
        calculation: "Count of tickets resolved in the period that were automated, by issue type.",
        recordCount: currentAuto.resolvedInPeriod,
      },
      {
        key: "fcr", label: "First Contact Resolution", unit: "percent",
        // getFcrReport's rate: FCR = Yes ÷ (Yes + No), blank FCR left out of both sides — the FCR
        // page's definition and the stored baseline's. metrics_daily's fcrRate counts a blank as No.
        current: currentFcr.fcrRate !== null ? round2(currentFcr.fcrRate * 100) : null,
        previous: previousFcr.fcrRate !== null ? round2(previousFcr.fcrRate * 100) : null,
        exact: { current: currentFcr.fcrRate, previous: previousFcr.fcrRate },
        history: priorFcr.map((f) => f.fcrRate).filter((n): n is number => n !== null).map((n) => round2(n * 100)),
        driver: {
          ...buildDriver(
            countRowsOf(previousFcr.fcrYesByIssueType),
            countRowsOf(currentFcr.fcrYesByIssueType),
            (currentFcr.fcrRate ?? 0) - (previousFcr.fcrRate ?? 0)
          ),
          dimensionLabel: "Issue Type",
        },
        driverNote:
          "Previous/Current are FCR = Yes tickets by issue type, with that issue type's own FCR rate (Yes ÷ Yes + No) underneath. The Total row's rate is the headline.",
        rateDenominators: { previous: previousFcr.fcrKnownByIssueType, current: currentFcr.fcrKnownByIssueType },
        source: "Supabase tickets (First Contact Resolution = Yes / No)",
        calculation: "FCR = Yes ÷ resolved tickets with FCR = Yes or No (a blank FCR value is left out); driver breakdown is the FCR = Yes tickets by issue type.",
        recordCount: currentFcr.resolvedInPeriod,
      }
    );
  }

  const metrics = await Promise.all(specs.map((spec) => buildComparison(spec, theme, email ?? null)));

  const ranked = [...metrics].filter((m) => m.pctDiff !== null).sort((a, b) => Math.abs(b.pctDiff!) - Math.abs(a.pctDiff!));
  const keyChanges = ranked.slice(0, 5).map((m) => ({ metricKey: m.key, label: m.label, pctDiff: m.pctDiff, better: m.better, insight: m.insight }));
  const investigate = metrics
    .filter((m) => m.anomaly?.flagged || (m.pctDiff !== null && Math.abs(m.pctDiff) >= NOTABLE_PCT_DIFF))
    .map((m) => m.insight);

  let checklistState: Record<string, boolean> = {};
  let finalTalkingPoints: { id: string; content: string; position: number }[] = [];

  if (email && personalState) {
    const [state, points] = personalState;
    checklistState = state;
    finalTalkingPoints = points;
    if (points.length === 0 && keyChanges.length > 0) {
      await seedTalkingPointsIfEmpty(email, key, keyChanges.map((k) => k.insight));
      finalTalkingPoints = await getTalkingPoints(email, key);
    }
  }

  return {
    aiAvailable: isAiConfigured(),
    team: teamLabel,
    teamKey: team.team_key,
    mode,
    periodKey: key,
    current: resolvedCurrent,
    previous: resolvedPrevious,
    currentLabel: formatReviewPeriodLabel(mode, resolvedCurrent),
    previousLabel: formatReviewPeriodLabel(mode, resolvedPrevious),
    metrics,
    executiveSummary: { keyChanges, investigate },
    checklistState,
    talkingPoints: finalTalkingPoints,
  };
}

export const REVIEW_CHECKLIST_ITEMS: { key: (typeof CHECKLIST_ITEM_KEYS)[number]; label: string; gabyLabel: string }[] = [
  { key: "ticket_volume", label: "Review major ticket-volume changes", gabyLabel: "Scan the volume swings" },
  { key: "sla_exceptions", label: "Review SLA exceptions", gabyLabel: "Check SLA near-misses" },
  { key: "cycle_time", label: "Review significant cycle-time changes", gabyLabel: "Eyeball the cycle-time drift" },
  { key: "backlog_aging", label: "Review backlog aging", gabyLabel: "Peek at the aging backlog" },
  { key: "unusual_spikes", label: "Review unusual spikes", gabyLabel: "Hunt for anything spiky" },
  { key: "team_changes", label: "Review team-specific changes", gabyLabel: "Note team-specific shifts" },
  { key: "operational_incidents", label: "Review major operational incidents/projects", gabyLabel: "Recall any big incidents" },
  { key: "talking_points", label: "Add talking points", gabyLabel: "Polish your talking points" },
];
