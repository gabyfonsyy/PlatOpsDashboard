import { getTeams, type TeamConfig } from "@/lib/teams";
import { getTicketMetrics } from "@/lib/metrics";
import { getP1SlaReport } from "@/lib/p1-sla";
import { getAutomatedTicketsReport } from "@/lib/automated-tickets";
import { getFcrReport } from "@/lib/ticket-breakdowns";
import { getBacklogAgingReport, type BacklogAgingTicket } from "@/lib/backlog-aging";
import { getTicketVolumeBreakdown } from "@/lib/ticket-volume-breakdown";
import { compareBreakdowns, classifyDriver, detectAnomaly, type DriverRow, type DriverVerdict, type AnomalyResult } from "@/lib/business-review-drivers";
import { buildInsightSentence } from "@/lib/business-review-view";
import {
  getReviewPeriod,
  getReviewPeriodFromStart,
  getPriorReviewPeriods,
  periodKey as buildPeriodKey,
  formatReviewPeriodLabel,
  type ReviewMode,
  type ReviewDateRange,
} from "@/lib/review-periods";
import { getCachedInsight, saveInsight } from "@/lib/work-store";
import { getChecklistState, getTalkingPoints, seedTalkingPointsIfEmpty } from "@/lib/business-review-store";
import { buildNarrativePrompt, NARRATIVE_SYSTEM_PROMPT, type NarrativeFacts } from "@/lib/business-review-ai";
import { chatJson, getAiModel, isAiConfigured } from "@/lib/ai";
import { voiceForTheme } from "@/lib/ai-voice";
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
const NARRATIVE_CONTEXT = "business_review_narrative";

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
  unit: "count" | "minutes" | "percent";
  driverAvailable: boolean;
  driverDimensionLabel: string | null;
  driverBreakdown: DriverRow[];
  driverVerdict: DriverVerdict;
  anomaly: AnomalyResult | null;
  insight: string;
  source: string;
  calculation: string;
  recordCount: number;
};

export type ExecutiveSummary = {
  keyChanges: { metricKey: string; label: string; pctDiff: number | null; insight: string }[];
  investigate: string[];
};

export type BusinessReview = {
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pctDiffOf(current: number, previous: number): { pctDiff: number | null; isNew: boolean } {
  if (previous === 0 && current === 0) return { pctDiff: null, isNew: false };
  if (previous === 0) return { pctDiff: null, isNew: true };
  return { pctDiff: round1(((current - previous) / previous) * 100), isNew: false };
}

function sumCounts(rows: { count: number }[]): number {
  return rows.reduce((sum, r) => sum + r.count, 0);
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

async function narrativeFor(facts: NarrativeFacts, email: string | null): Promise<string> {
  const fallback = buildInsightSentence(facts.metricLabel, facts.pctDiff, facts.isNew, facts.driverRows, facts.verdict, facts.theme as Theme);
  if (!email || !isAiConfigured()) return fallback;

  const entityId = `${facts.metricLabel}`;
  const version = JSON.stringify({ c: facts.current, p: facts.previous, d: facts.driverRows, v: facts.verdict, t: facts.theme });
  try {
    const cached = await getCachedInsight<{ narrative: string }>(email, NARRATIVE_CONTEXT, entityId, version);
    if (cached) return cached.content.narrative || fallback;

    const voice = voiceForTheme(facts.theme);
    const result = await chatJson<{ narrative?: unknown }>(buildNarrativePrompt(facts), {
      systemPrompt: `${NARRATIVE_SYSTEM_PROMPT}\n\nVoice: ${voice === "gaby" ? "warm, a bit playful, space-themed — but still fit for presenting to leadership." : "neutral, professional, executive-facing."}`,
      temperature: 0.3,
      maxTokens: 300,
      tier: "fast",
    });
    const narrative = String(result.narrative ?? "").trim();
    if (!narrative) return fallback;
    await saveInsight(email, NARRATIVE_CONTEXT, entityId, version, { narrative }, getAiModel("fast"));
    return narrative;
  } catch {
    // AI is a progressive enhancement here, never a blocking dependency — the deterministic
    // sentence already computed above is always a complete, correct answer on its own.
    return fallback;
  }
}

type MetricSpec = {
  key: string;
  label: string;
  unit: MetricComparison["unit"];
  current: number | null;
  previous: number | null;
  history: number[];
  driver: { rows: DriverRow[]; verdict: DriverVerdict; dimensionLabel: string } | null;
  source: string;
  calculation: string;
  recordCount: number;
};

async function buildComparison(spec: MetricSpec, theme: Theme, email: string | null): Promise<MetricComparison> {
  const current = spec.current ?? 0;
  const previous = spec.previous ?? 0;
  const { pctDiff, isNew } = pctDiffOf(current, previous);
  const anomaly = spec.history.length ? detectAnomaly(current, spec.history) : null;
  const driverRows = spec.driver?.rows ?? [];
  const driverVerdict = spec.driver?.verdict ?? "none";

  const insight = await narrativeFor(
    {
      metricLabel: spec.label,
      current,
      previous,
      pctDiff,
      isNew,
      driverRows,
      verdict: driverVerdict,
      theme,
    },
    email
  );

  return {
    key: spec.key,
    label: spec.label,
    current: spec.current,
    previous: spec.previous,
    absoluteDiff: spec.current !== null && spec.previous !== null ? round1(spec.current - spec.previous) : null,
    pctDiff,
    isNew,
    unit: spec.unit,
    driverAvailable: spec.driver !== null,
    driverDimensionLabel: spec.driver?.dimensionLabel ?? null,
    driverBreakdown: driverRows,
    driverVerdict,
    anomaly,
    insight,
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

  const [currentTM, previousTM, ...priorTMs] = await Promise.all([
    getTicketMetrics(team.team_key, "custom", key, undefined, resolvedCurrent.start, resolvedCurrent.end),
    getTicketMetrics(team.team_key, "custom", key, undefined, resolvedPrevious.start, resolvedPrevious.end),
    ...priorPeriods.map((p) => getTicketMetrics(team.team_key, "custom", key, undefined, p.start, p.end)),
  ]);

  const [currentVolByType, previousVolByType, currentAging, previousAging] = await Promise.all([
    getTicketVolumeBreakdown(team.team_key, resolvedCurrent.start, resolvedCurrent.end, "issue_type"),
    getTicketVolumeBreakdown(team.team_key, resolvedPrevious.start, resolvedPrevious.end, "issue_type"),
    getBacklogAgingReport(team.team_key, "custom", key, undefined, resolvedCurrent.start, resolvedCurrent.end),
    getBacklogAgingReport(team.team_key, "custom", key, undefined, resolvedPrevious.start, resolvedPrevious.end),
  ]);

  const specs: MetricSpec[] = [
    {
      key: "ticket_volume", label: "Ticket Volume", unit: "count",
      current: currentTM.ticketVolume, previous: previousTM.ticketVolume,
      history: priorTMs.map((m) => m.ticketVolume),
      driver: { ...buildDriver(previousVolByType.rows, currentVolByType.rows, currentTM.ticketVolume - previousTM.ticketVolume), dimensionLabel: "Issue Type" },
      source: "Supabase tickets (created in period)",
      calculation: "Count of tickets created during the reporting period, by issue type.",
      recordCount: currentVolByType.totalTickets,
    },
    {
      key: "lead_time", label: "Lead Time", unit: "minutes",
      current: currentTM.leadTimeAvgMinutes, previous: previousTM.leadTimeAvgMinutes,
      history: priorTMs.map((m) => m.leadTimeAvgMinutes).filter((n): n is number => n !== null),
      driver: null,
      source: "Supabase tickets (live span average)",
      calculation: "Average minutes from ticket creation to resolution, for tickets resolved in the period.",
      recordCount: currentTM.ticketsResolvedInPeriod,
    },
    {
      key: "cycle_time", label: "Cycle Time", unit: "minutes",
      current: currentTM.cycleTimeAvgMinutes, previous: previousTM.cycleTimeAvgMinutes,
      history: priorTMs.map((m) => m.cycleTimeAvgMinutes).filter((n): n is number => n !== null),
      driver: null,
      source: "Supabase tickets (live span average)",
      calculation: "Average minutes of active work time, for tickets resolved in the period.",
      recordCount: currentTM.ticketsResolvedInPeriod,
    },
    {
      key: "ageing_rate", label: "Ageing Rate", unit: "percent",
      current: currentTM.backlogAgingRate !== null ? round1(currentTM.backlogAgingRate * 100) : null,
      previous: previousTM.backlogAgingRate !== null ? round1(previousTM.backlogAgingRate * 100) : null,
      history: priorTMs.map((m) => m.backlogAgingRate).filter((n): n is number => n !== null).map((n) => round1(n * 100)),
      driver: {
        ...buildDriver(
          overdueByIssueType(previousAging.tickets),
          overdueByIssueType(currentAging.tickets),
          (currentTM.backlogAgingRate ?? 0) - (previousTM.backlogAgingRate ?? 0)
        ),
        dimensionLabel: "Issue Type",
      },
      source: "Supabase tickets (resolved after due date)",
      calculation: "Share of tickets resolved in the period that were resolved after their due date; driver breakdown is the composition of those overdue tickets, by issue type.",
      recordCount: currentAging.resolvedInPeriod,
    },
  ];

  if (isSe) {
    const [currentP1, previousP1, currentAuto, previousAuto, currentFcr, previousFcr] = await Promise.all([
      getP1SlaReport(team.team_key, "custom", key, undefined, undefined, resolvedCurrent.start, resolvedCurrent.end),
      getP1SlaReport(team.team_key, "custom", key, undefined, undefined, resolvedPrevious.start, resolvedPrevious.end),
      getAutomatedTicketsReport(team.team_key, "custom", key, undefined, undefined, resolvedCurrent.start, resolvedCurrent.end),
      getAutomatedTicketsReport(team.team_key, "custom", key, undefined, undefined, resolvedPrevious.start, resolvedPrevious.end),
      getFcrReport(team.team_key, "custom", key, undefined, resolvedCurrent.start, resolvedCurrent.end),
      getFcrReport(team.team_key, "custom", key, undefined, resolvedPrevious.start, resolvedPrevious.end),
    ]);

    specs.push(
      {
        key: "p1_sla_compliance", label: "P1 SLA Compliance", unit: "percent",
        current: currentP1.onTimeRate !== null ? round1(currentP1.onTimeRate * 100) : null,
        previous: previousP1.onTimeRate !== null ? round1(previousP1.onTimeRate * 100) : null,
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
        source: "Supabase tickets (automation-owned or automation-labelled)",
        calculation: "Count of tickets resolved in the period that were automated, by issue type.",
        recordCount: currentAuto.resolvedInPeriod,
      },
      {
        key: "fcr", label: "First Contact Resolution", unit: "percent",
        current: currentTM.fcrRate !== null ? round1(currentTM.fcrRate * 100) : null,
        previous: previousTM.fcrRate !== null ? round1(previousTM.fcrRate * 100) : null,
        history: priorTMs.map((m) => m.fcrRate).filter((n): n is number => n !== null).map((n) => round1(n * 100)),
        driver: {
          ...buildDriver(
            previousFcr.byIssueType,
            currentFcr.byIssueType,
            (currentTM.fcrRate ?? 0) - (previousTM.fcrRate ?? 0)
          ),
          dimensionLabel: "Issue Type",
        },
        source: "Supabase tickets (resolved without escalation, or FCR = Yes)",
        calculation: "Share of resolved tickets that were first-contact-resolved; driver breakdown is the composition of that population by issue type.",
        recordCount: currentFcr.resolvedInPeriod,
      }
    );
  }

  const metrics = await Promise.all(specs.map((spec) => buildComparison(spec, theme, email ?? null)));

  const ranked = [...metrics].filter((m) => m.pctDiff !== null).sort((a, b) => Math.abs(b.pctDiff!) - Math.abs(a.pctDiff!));
  const keyChanges = ranked.slice(0, 5).map((m) => ({ metricKey: m.key, label: m.label, pctDiff: m.pctDiff, insight: m.insight }));
  const investigate = metrics
    .filter((m) => m.anomaly?.flagged || (m.pctDiff !== null && Math.abs(m.pctDiff) >= NOTABLE_PCT_DIFF))
    .map((m) => m.insight);

  let checklistState: Record<string, boolean> = {};
  let finalTalkingPoints: { id: string; content: string; position: number }[] = [];

  if (email) {
    const [state, points] = await Promise.all([getChecklistState(email, key), getTalkingPoints(email, key)]);
    checklistState = state;
    finalTalkingPoints = points;
    if (points.length === 0 && keyChanges.length > 0) {
      await seedTalkingPointsIfEmpty(email, key, keyChanges.map((k) => k.insight));
      finalTalkingPoints = await getTalkingPoints(email, key);
    }
  }

  return {
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
