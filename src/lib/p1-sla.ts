import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import {
  getTeams,
  backlogAgingAssignee,
  backlogAgingAssigneeLabel,
  excludedIssueTypes,
  isExcludedIssueType,
  type TeamConfig,
} from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString, isoDateDiffDays, minutesBetween } from "@/lib/manila-date";
import {
  meaningfulLabels,
  isRealEscalation,
  escalationTargets,
  BREAKDOWN_TICKET_LIMIT,
  type CountRow,
} from "@/lib/ticket-breakdowns";
import { riskTierForConsumed, type RiskTier } from "@/lib/sla-status";

/**
 * Jira's native Priority field value for a P1 ticket. Matched case-insensitively (see fetchP1Rows)
 * because the real value is "P1 (Very urgent)" — lowercase "urgent" — which differs from how it
 * reads out loud; confirmed against real ST data 2026-09-02 after an exact-match filter on the
 * capitalized spelling silently matched zero tickets.
 */
export const P1_PRIORITY_VALUE = "P1 (Very urgent)";

/**
 * Holding reasons that name a dependency on a team OTHER than the one working the ticket — the
 * controlled vocabulary is fixed (see holding_reasons_json), and these three are the ones that
 * literally say "waiting on X team". Used both for the cross-team-delay flag and for the
 * controllability split below.
 */
export const OTHER_TEAM_HOLDING_REASONS = [
  "Platform Operations dependency",
  "L3 Support dependency",
  "Security Operations dependency",
];

/** The one real holding reason that names the REQUESTER, not a team — "outside the org" delay. */
export const EXTERNAL_HOLDING_REASONS = ["Awaiting client feedback"];

export type DelayControllability = "internal" | "dependency" | "external";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function toCountRows(counts: Record<string, number>, denominator: number): CountRow[] {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count, share: denominator ? round4(count / denominator) : null }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * holding_reasons_json is an array of plain reason strings — same shape as
 * lib/ticket-breakdowns.ts's holdingReasonCounts, duplicated rather than imported since that one
 * isn't exported (each report module owns its own small aggregation helpers, per this codebase's
 * existing convention — see e.g. every report file's own local round2/round4).
 */
function holdingReasonsOf(r: P1Row): string[] {
  const entries = Array.isArray(r.holding_reasons_json) ? r.holding_reasons_json : [];
  return entries
    .map((e) => (typeof e === "string" ? e : String((e as { reason?: unknown })?.reason ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Real 3-way split of the actual 9-value holding-reason vocabulary (see OTHER_TEAM_HOLDING_REASONS/
 * EXTERNAL_HOLDING_REASONS), plus a real Ticket Escalation counting as a dependency regardless of
 * holding reason — both fields can carry "this left the team's hands". Not a guess: every value
 * this can return maps to something the ticket's own data actually says.
 */
function controllabilityOf(r: P1Row): DelayControllability {
  const holds = holdingReasonsOf(r);
  if (isRealEscalation(r.escalation_value) || holds.some((h) => OTHER_TEAM_HOLDING_REASONS.includes(h))) {
    return "dependency";
  }
  if (holds.some((h) => EXTERNAL_HOLDING_REASONS.includes(h))) return "external";
  return "internal";
}

type P1Row = {
  issue_key: string;
  issue_type: string | null;
  created: string;
  /** Null while the ticket is still open — every other Phase-4 report scopes by resolved date and
   * so never has to model this; P1 SLA scopes by CREATED date instead, so an in-period ticket can
   * genuinely still be open. */
  resolved_datetime: string | null;
  due_date: string | null;
  escalation_value: string | null;
  holding_reasons_json: unknown;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
};

const SELECT =
  "issue_key,issue_type,created,resolved_datetime,due_date,escalation_value,holding_reasons_json,product,labels,assigned_se,assigned_cod";

/**
 * Scoped by CREATED date, unlike Escalation/FCR/On-Hold (resolved date) — per Gaby: "% of P1
 * tickets resolved on time" is a question about the COHORT of P1s a period generated, not the
 * ones that happened to finish inside it. That means a ticket can be in scope and still open —
 * unlike fetchResolvedRows in lib/ticket-breakdowns.ts, this does NOT filter resolved_datetime
 * not-null.
 *
 * Coarse UTC prefilter widened a day each side, exact Manila-day check in JS — same split as
 * every other Phase 4 report.
 */
async function fetchP1Rows(teamKey: string, startDate: string, endDate: string, issueType?: string): Promise<P1Row[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  const excluded = excludedIssueTypes(teamKey);

  return fetchAllRows<P1Row>((from, to) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(SELECT)
      .eq("team_key", teamKey)
      .ilike("priority", P1_PRIORITY_VALUE)
      .gte("created", rangeStartUtc.toISOString())
      .lte("created", rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return q.range(from, to);
  });
}

type Classification = { decided: boolean; onTime: boolean | null; overdue: boolean; daysOverdue: number | null };
type Classified = { row: P1Row; cls: Classification };

/**
 * Where one ticket lands: DECIDED tickets are either resolved (on time or late) or still open but
 * already past their due date (an automatic miss — it has already blown the SLA regardless of
 * when/whether it eventually resolves). A ticket still open and NOT YET due is PENDING — its
 * outcome isn't known yet, so it counts toward neither the numerator nor the denominator. This is
 * the "real-time SLA compliance" reading Gaby chose over "resolved tickets only" (which would let
 * a period's % keep quietly changing weeks later) and over "every open ticket is a miss" (which
 * would punish a ticket still inside its window).
 *
 * The on-time test itself mirrors lib/backlog-aging.ts's overdue test exactly (Manila calendar day
 * comparison, resolved <= due is on time) so this reconciles with Backlog Aging's definition of
 * "overdue" rather than inventing a second one.
 */
function classify(r: P1Row, todayIso: string): Classification {
  const resolvedIso = r.resolved_datetime ? toManilaDateString(r.resolved_datetime) : null;
  const dueIso = r.due_date;

  if (resolvedIso) {
    if (!dueIso) return { decided: false, onTime: null, overdue: false, daysOverdue: null };
    const onTime = resolvedIso <= dueIso;
    return {
      decided: true,
      onTime,
      overdue: !onTime,
      daysOverdue: onTime ? null : isoDateDiffDays(dueIso, resolvedIso),
    };
  }

  if (!dueIso) return { decided: false, onTime: null, overdue: false, daysOverdue: null };
  if (todayIso > dueIso) {
    return { decided: true, onTime: false, overdue: true, daysOverdue: isoDateDiffDays(dueIso, todayIso) };
  }
  return { decided: false, onTime: null, overdue: false, daysOverdue: null };
}

function resolutionMinutesOf(r: P1Row): number | null {
  return r.resolved_datetime ? round2(minutesBetween(r.created, r.resolved_datetime)) : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------------------------------------------------------------- Trend series

export type P1TrendPoint = {
  /** 'YYYY-MM-DD' (daily, week/month ranges), a Monday 'YYYY-MM-DD' (weekly, quarter range), or
   * 'YYYY-MM' (monthly, year range). */
  bucket: string;
  created: number;
  decided: number;
  onTime: number;
  onTimeRate: number | null;
  avgResolutionMinutes: number | null;
};

function bucketKeyFor(range: string, dateIso: string): string {
  if (range === "year") return dateIso.slice(0, 7);
  if (range === "quarter") {
    const d = new Date(`${dateIso}T00:00:00Z`);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); // back to Monday
    return d.toISOString().slice(0, 10);
  }
  return dateIso; // week/month ranges: daily
}

function enumerateBuckets(range: string, startDate: string, endDate: string): string[] {
  const buckets: string[] = [];
  const end = new Date(`${endDate}T00:00:00Z`);

  if (range === "year") {
    const cursor = new Date(`${startDate}T00:00:00Z`);
    cursor.setUTCDate(1);
    while (cursor <= end) {
      buckets.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return buckets;
  }

  const cursor = new Date(`${startDate}T00:00:00Z`);
  const stepDays = range === "quarter" ? 7 : 1;
  if (range === "quarter") {
    const day = cursor.getUTCDay();
    cursor.setUTCDate(cursor.getUTCDate() - ((day + 6) % 7));
  }
  while (cursor <= end) {
    buckets.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + stepDays);
  }
  return buckets;
}

function buildTrend(range: string, startDate: string, endDate: string, classified: Classified[]): P1TrendPoint[] {
  const buckets = enumerateBuckets(range, startDate, endDate);
  const byBucket = new Map<
    string,
    { created: number; decided: number; onTime: number; resSum: number; resCount: number }
  >();
  for (const b of buckets) byBucket.set(b, { created: 0, decided: 0, onTime: 0, resSum: 0, resCount: 0 });

  for (const x of classified) {
    const createdIso = toManilaDateString(x.row.created);
    if (!createdIso) continue;
    const bucket = byBucket.get(bucketKeyFor(range, createdIso));
    if (!bucket) continue; // outside the enumerated range — shouldn't happen, rows are pre-filtered
    bucket.created++;
    if (x.cls.decided) {
      bucket.decided++;
      if (x.cls.onTime) bucket.onTime++;
    }
    const resMinutes = resolutionMinutesOf(x.row);
    if (resMinutes !== null) {
      bucket.resSum += resMinutes;
      bucket.resCount++;
    }
  }

  return buckets.map((key) => {
    const b = byBucket.get(key)!;
    return {
      bucket: key,
      created: b.created,
      decided: b.decided,
      onTime: b.onTime,
      onTimeRate: b.decided ? round4(b.onTime / b.decided) : null,
      avgResolutionMinutes: b.resCount ? round2(b.resSum / b.resCount) : null,
    };
  });
}

// ------------------------------------------------------------- Problem areas

export type ProblemAreaRow = {
  key: string;
  count: number;
  onTimeCount: number;
  onTimeRate: number | null;
  avgResolutionMinutes: number | null;
};

/** Grouped over DECIDED tickets (resolved + open-and-overdue) — the population with a known
 * outcome. Sorted by BREACH COUNT (impact), not raw volume, per "prioritize by impact". */
function problemAreas(decided: Classified[], keyFn: (r: P1Row) => string): ProblemAreaRow[] {
  const groups = new Map<string, { count: number; onTime: number; resSum: number; resCount: number }>();
  for (const x of decided) {
    const key = keyFn(x.row) || "(none)";
    if (!groups.has(key)) groups.set(key, { count: 0, onTime: 0, resSum: 0, resCount: 0 });
    const g = groups.get(key)!;
    g.count++;
    if (x.cls.onTime) g.onTime++;
    const resMinutes = resolutionMinutesOf(x.row);
    if (resMinutes !== null) {
      g.resSum += resMinutes;
      g.resCount++;
    }
  }
  return Array.from(groups.entries())
    .map(([key, g]) => ({
      key,
      count: g.count,
      onTimeCount: g.onTime,
      onTimeRate: g.count ? round4(g.onTime / g.count) : null,
      avgResolutionMinutes: g.resCount ? round2(g.resSum / g.resCount) : null,
    }))
    .sort((a, b) => b.count - b.onTimeCount - (a.count - a.onTimeCount) || b.count - a.count)
    .slice(0, 10);
}

// --------------------------------------------------------- Recurring patterns

export type P1PatternRow = {
  product: string;
  label: string;
  count: number;
  overdueCount: number;
  onTimeRate: number | null;
};

/** Product+label combos appearing on 2+ P1s among DECIDED tickets — a single occurrence isn't a
 * pattern. Sorted by breach count (impact) like problemAreas. */
function recurringPatterns(decided: Classified[]): P1PatternRow[] {
  const combos = new Map<string, { product: string; label: string; count: number; overdue: number }>();
  for (const x of decided) {
    const product = x.row.product || "(none)";
    for (const label of meaningfulLabels(x.row.labels)) {
      const key = `${product}|${label}`;
      if (!combos.has(key)) combos.set(key, { product, label, count: 0, overdue: 0 });
      const c = combos.get(key)!;
      c.count++;
      if (x.cls.overdue) c.overdue++;
    }
  }
  return Array.from(combos.values())
    .filter((c) => c.count >= 2)
    .map((c) => ({
      product: c.product,
      label: c.label,
      count: c.count,
      overdueCount: c.overdue,
      onTimeRate: c.count ? round4((c.count - c.overdue) / c.count) : null,
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount || b.count - a.count)
    .slice(0, 10);
}

// -------------------------------------------------------------------- At risk

export type P1AtRiskTicket = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  createdAt: string;
  dueDate: string;
  /** Fraction (0-1+) of the ticket's own created->due window already elapsed as of today. */
  consumedFraction: number;
  riskTier: RiskTier;
  daysRemaining: number;
};

/** Still-open, not-yet-due P1s (the PENDING set) — approaching breach, ranked most urgent first.
 * Already-overdue open tickets are in the overdue/decided set, not here — this section answers
 * "what needs attention before it breaches", not "what already has". */
function atRiskTickets(pending: Classified[], teamConfig: TeamConfig, todayIso: string): P1AtRiskTicket[] {
  return pending
    .map((x) => {
      const r = x.row;
      const createdIso = toManilaDateString(r.created) || todayIso;
      const dueIso = r.due_date as string; // pending requires due_date — see classify()
      const totalWindowDays = Math.max(1, isoDateDiffDays(createdIso, dueIso));
      const elapsedDays = isoDateDiffDays(createdIso, todayIso);
      const consumedFraction = round2(Math.max(0, elapsedDays) / totalWindowDays);
      return {
        issueKey: r.issue_key,
        issueType: r.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
        product: r.product || "(none)",
        createdAt: r.created,
        dueDate: dueIso,
        consumedFraction,
        riskTier: riskTierForConsumed(consumedFraction),
        daysRemaining: isoDateDiffDays(todayIso, dueIso),
      };
    })
    .sort((a, b) => b.consumedFraction - a.consumedFraction);
}

// --------------------------------------------------------- Ticket drill-down

export type P1TicketStatus = "onTime" | "overdue" | "pending";

export type P1TicketRow = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  labels: string;
  createdAt: string;
  dueDate: string | null;
  /** Null while still open. */
  resolvedAt: string | null;
  status: P1TicketStatus;
  daysOverdue: number | null;
  /** Only set for status === "pending". */
  daysRemaining: number | null;
  /** Only meaningful once a ticket is overdue — an on-time or pending ticket has no delay to classify. */
  controllability: DelayControllability | null;
  escalationTargets: string[];
  holdingReasons: string[];
};

function toTicketRow(x: Classified, todayIso: string): P1TicketRow {
  const { row: r, cls } = x;
  const status: P1TicketStatus = !cls.decided ? "pending" : cls.overdue ? "overdue" : "onTime";
  return {
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    assignee: "", // filled in by the caller, which has teamConfig
    product: r.product || "(none)",
    labels: meaningfulLabels(r.labels).join(", "),
    createdAt: r.created,
    dueDate: r.due_date,
    resolvedAt: r.resolved_datetime,
    status,
    daysOverdue: cls.daysOverdue,
    daysRemaining: status === "pending" && r.due_date ? isoDateDiffDays(todayIso, r.due_date) : null,
    controllability: status === "overdue" ? controllabilityOf(r) : null,
    escalationTargets: escalationTargets(r.escalation_value),
    holdingReasons: holdingReasonsOf(r),
  };
}

/** overdue (most days late first) -> pending (soonest due first) -> on time (most recent first). */
function ticketSortRank(t: Classified): number {
  if (t.cls.decided && t.cls.overdue) return 0;
  if (!t.cls.decided) return 1;
  return 2;
}

// ------------------------------------------------------------------- Compare

export type P1PeriodComparison = {
  createdInPeriod: { current: number; previous: number; deltaPct: number | null };
  onTimeRate: { current: number | null; previous: number | null; deltaPp: number | null };
  avgResolutionMinutes: { current: number | null; previous: number | null; deltaPct: number | null };
  medianResolutionMinutes: { current: number | null; previous: number | null; deltaPct: number | null };
};

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round4((current - previous) / previous);
}

// ------------------------------------------------------------------ Insights

export type P1Insight = { text: { professional: string; gaby: string }; tone: "positive" | "watch" | "negative" };

function formatPp(delta: number): string {
  const points = Math.round(delta * 1000) / 10; // fraction -> percentage points, 1 decimal
  return `${points > 0 ? "+" : ""}${points}pp`;
}
function formatPct(delta: number): string {
  const pct = Math.round(delta * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * Rules-based, over the report's own already-computed numbers — never free-text/LLM-generated,
 * and a rule only fires when its specific data condition is actually true. Ordered by what a
 * manager should see first: compliance direction, then why, then where, then a positive note if
 * one exists, capped at 5 so this stays a pulse, not a report.
 */
/**
 * Text for each insight condition, in both registers. Professional stays exactly as it always
 * has; Gaby is the "Gaby voice" tone spec (2026-09-02) — headline first, plain-English "so what",
 * hedged rather than causal language, light/sparing personality. Both are always computed (it's a
 * pure string template over numbers already in hand, not a second data fetch) so InsightsPanel
 * can pick between them on the client with no round trip — see its doc comment for why that
 * replaced picking the register here. This only ever restyles a condition that already fired — it
 * does not lower any threshold or add a condition, so "say nothing when nothing stands out" holds
 * in both registers identically.
 */
function buildInsights(report: {
  onTimeRate: number | null;
  createdInPeriod: number;
  overdueCount: number;
  decided: number;
  crossTeamDelayRate: number | null;
  comparison: P1PeriodComparison | null;
  byHoldingReason: CountRow[];
  patterns: P1PatternRow[];
  atRisk: P1AtRiskTicket[];
}): P1Insight[] {
  const insights: P1Insight[] = [];
  const c = report.comparison;

  if (c && c.onTimeRate.current !== null && c.onTimeRate.deltaPp !== null && Math.abs(c.onTimeRate.deltaPp) >= 0.005) {
    const improved = c.onTimeRate.deltaPp > 0;
    const pct = Math.round(c.onTimeRate.current * 1000) / 10;
    const pp = formatPp(c.onTimeRate.deltaPp);
    insights.push({
      text: {
        professional: `SLA compliance ${improved ? "improved" : "declined"} to ${pct}%, ${pp} vs the previous period.`,
        gaby: improved
          ? `**🚀 SLA compliance is trending up.** On-time rate hit **${pct}%**, up ${pp} from the previous period — more P1s closing inside SLA.`
          : `**SLA compliance slipped this period.** On-time rate is down to **${pct}%** (${pp}) — more P1s breaching than last period, worth a look.`,
      },
      tone: improved ? "positive" : "negative",
    });
  }

  if (report.overdueCount > 0 && report.byHoldingReason.length) {
    const top = report.byHoldingReason[0];
    if (top.share !== null) {
      const pct = Math.round(top.share * 1000) / 10;
      insights.push({
        text: {
          professional: `Primary delay reason: "${top.key}" — ${pct}% of holds on overdue P1s this period.`,
          gaby: `**🚩 One reason is behind most of the delays.** "${top.key}" accounts for **${pct}%** of holds on overdue P1s — that's the lever most likely to move the needle.`,
        },
        tone: "watch",
      });
    }
  }

  if (report.overdueCount > 0 && report.crossTeamDelayRate !== null && report.crossTeamDelayRate >= 0.3) {
    const pct = Math.round(report.crossTeamDelayRate * 1000) / 10;
    insights.push({
      text: {
        professional: `${pct}% of SLA breaches involved a dependency on another team, not the team itself.`,
        gaby: `**Translation: a chunk of these breaches aren't fully on this team.** **${pct}%** of SLA breaches involved a dependency on another team — worth flagging upstream rather than treating as a team-execution problem.`,
      },
      tone: "watch",
    });
  }

  if (report.patterns.length && report.patterns[0].overdueCount > 0) {
    const p = report.patterns[0];
    const plural = p.count === 1 ? "" : "s";
    const smallSample = p.count < 10;
    insights.push({
      text: {
        professional: `Recurring issue: ${p.product} + "${p.label}" generated ${p.count} P1${plural} this period, with ${p.overdueCount} breaching SLA.`,
        gaby: `**A pattern worth knowing about.** ${p.product} + "${p.label}" generated **${p.count}** P1${plural} this period, **${p.overdueCount}** of them breaching SLA.${
          smallSample ? " Small sample, so treat this as a signal rather than a trend, but" : " Worth investigating —"
        } this is the kind of thing worth digging into if it keeps showing up.`,
      },
      tone: "watch",
    });
  }

  if (c && c.avgResolutionMinutes.current !== null && c.avgResolutionMinutes.deltaPct !== null && c.avgResolutionMinutes.deltaPct <= -0.1) {
    const pct = formatPct(Math.abs(c.avgResolutionMinutes.deltaPct) * -1).replace("-", "");
    insights.push({
      text: {
        professional: `Average resolution time is down ${pct} from the previous period.`,
        gaby: `**Resolutions are getting faster too.** Average resolution time is down **${pct}** from the previous period.`,
      },
      tone: "positive",
    });
  }

  if (c && c.createdInPeriod.deltaPct !== null && c.createdInPeriod.deltaPct >= 0.25) {
    const complianceDeclined = c.onTimeRate.deltaPp !== null && c.onTimeRate.deltaPp < 0;
    const pct = formatPct(c.createdInPeriod.deltaPct);
    insights.push({
      text: {
        professional: `P1 volume is up ${pct} vs the previous period (${c.createdInPeriod.current} vs ${c.createdInPeriod.previous}).`,
        gaby: `**📈 A lot more P1s came in this period.** Volume is up **${pct}** (**${c.createdInPeriod.current}** vs **${c.createdInPeriod.previous}**)${
          complianceDeclined ? " — and compliance dipped alongside it, so this is worth a closer look" : ", though compliance held up"
        }.`,
      },
      tone: complianceDeclined ? "negative" : "watch",
    });
  }

  const criticalAtRisk = report.atRisk.filter((t) => t.riskTier === "critical").length;
  if (criticalAtRisk > 0) {
    const plural = criticalAtRisk === 1;
    insights.push({
      text: {
        professional: `${criticalAtRisk} open P1${plural ? " is" : "s are"} within 10% of breaching SLA right now — see P1s at Risk.`,
        gaby: `**🚩 Something needs eyes right now.** **${criticalAtRisk}** open P1${plural ? "" : "s"} ${
          plural ? "is" : "are"
        } within 10% of breaching SLA — not a "later" problem, check P1s at Risk.`,
      },
      tone: "negative",
    });
  }

  if (!insights.length && report.decided > 0 && report.overdueCount === 0) {
    insights.push({
      text: {
        professional: "Every decided P1 this period resolved on time.",
        gaby: "**🎉 Clean sheet this period.** Every decided P1 resolved on time — nothing to flag.",
      },
      tone: "positive",
    });
  }

  return insights.slice(0, 5);
}

// ------------------------------------------------------------ Positive notes

export type P1PositiveHighlight = { label: string; detail: string };

function buildPositiveHighlights(
  problemAreasByProduct: ProblemAreaRow[],
  comparison: P1PeriodComparison | null
): P1PositiveHighlight[] {
  const highlights: P1PositiveHighlight[] = [];

  const zeroBreachProducts = problemAreasByProduct.filter((p) => p.count >= 2 && p.onTimeCount === p.count);
  if (zeroBreachProducts.length) {
    const top = zeroBreachProducts.sort((a, b) => b.count - a.count)[0];
    highlights.push({ label: "Zero breaches", detail: `${top.key} — ${top.count} P1s, all resolved on time.` });
  }

  if (comparison?.onTimeRate.deltaPp !== null && comparison && comparison.onTimeRate.deltaPp !== null && comparison.onTimeRate.deltaPp > 0) {
    highlights.push({ label: "Compliance improved", detail: `${formatPp(comparison.onTimeRate.deltaPp)} vs the previous period.` });
  }

  if (
    comparison?.medianResolutionMinutes.deltaPct !== null &&
    comparison &&
    comparison.medianResolutionMinutes.deltaPct !== null &&
    comparison.medianResolutionMinutes.deltaPct < 0
  ) {
    highlights.push({
      label: "Faster resolution",
      detail: `Median resolution time ${formatPct(comparison.medianResolutionMinutes.deltaPct)} vs the previous period.`,
    });
  }

  return highlights.slice(0, 3);
}

// --------------------------------------------------------------------- Report

export type P1SlaReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  assigneeLabel: string;
  todayIso: string;

  // PULSE
  createdInPeriod: number;
  decided: number;
  onTimeCount: number;
  onTimeRate: number | null;
  overdueCount: number;
  pendingCount: number;
  avgResolutionMinutes: number | null;
  medianResolutionMinutes: number | null;
  crossTeamDelayCount: number;
  crossTeamDelayRate: number | null;
  comparison: P1PeriodComparison | null;
  insights: P1Insight[];
  positiveHighlights: P1PositiveHighlight[];

  // TREND
  trend: P1TrendPoint[];

  // WHY
  byHoldingReason: CountRow[];
  byEscalationTarget: CountRow[];
  byLabel: CountRow[];
  controllability: Record<DelayControllability, { count: number; share: number | null }>;
  avgDaysOverdue: number | null;

  // WHERE
  byProduct: ProblemAreaRow[];
  byIssueType: ProblemAreaRow[];
  byAssignee: ProblemAreaRow[];
  patterns: P1PatternRow[];

  // ACTION
  atRisk: P1AtRiskTicket[];

  // DETAILS
  tickets: P1TicketRow[];
  ticketsTotalCount: number;
};

const EMPTY_CONTROLLABILITY: P1SlaReport["controllability"] = {
  internal: { count: 0, share: null },
  dependency: { count: 0, share: null },
  external: { count: 0, share: null },
};

const EMPTY_REPORT: Omit<P1SlaReport, "team" | "range" | "period" | "issueType"> = {
  assigneeLabel: "Assignee",
  todayIso: "",
  createdInPeriod: 0,
  decided: 0,
  onTimeCount: 0,
  onTimeRate: null,
  overdueCount: 0,
  pendingCount: 0,
  avgResolutionMinutes: null,
  medianResolutionMinutes: null,
  crossTeamDelayCount: 0,
  crossTeamDelayRate: null,
  comparison: null,
  insights: [],
  positiveHighlights: [],
  trend: [],
  byHoldingReason: [],
  byEscalationTarget: [],
  byLabel: [],
  controllability: EMPTY_CONTROLLABILITY,
  avgDaysOverdue: null,
  byProduct: [],
  byIssueType: [],
  byAssignee: [],
  patterns: [],
  atRisk: [],
  tickets: [],
  ticketsTotalCount: 0,
};

/** Just enough of one period's numbers to diff against another — see getP1SlaReport's comparison field. */
async function summarizePeriod(
  team: string,
  range: string,
  period: string,
  issueType: string | undefined,
  todayIso: string
): Promise<{ createdInPeriod: number; onTimeRate: number | null; avgResolutionMinutes: number | null; medianResolutionMinutes: number | null }> {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const rows = (await fetchP1Rows(team, startDate, endDate, issueType)).filter((r) => {
    if (isExcludedIssueType(team, r.issue_type)) return false;
    const createdIso = toManilaDateString(r.created);
    return createdIso !== null && createdIso >= startDate && createdIso <= endDate;
  });
  const classified = rows.map((r) => ({ row: r, cls: classify(r, todayIso) }));
  const decided = classified.filter((x) => x.cls.decided);
  const onTime = decided.filter((x) => x.cls.onTime);
  const resolutionMinutes = classified.map((x) => resolutionMinutesOf(x.row)).filter((v): v is number => v !== null);

  return {
    createdInPeriod: rows.length,
    onTimeRate: decided.length ? round4(onTime.length / decided.length) : null,
    avgResolutionMinutes: resolutionMinutes.length ? round2(resolutionMinutes.reduce((a, b) => a + b, 0) / resolutionMinutes.length) : null,
    medianResolutionMinutes: median(resolutionMinutes),
  };
}

/**
 * P1 (Very Urgent) SLA compliance — the full pulse-to-details report: on-time rate, trend over
 * time, why tickets breach (holding reason / escalation / controllability), where the problems
 * concentrate (product / issue type / assignee / recurring product+label patterns), which open
 * P1s are approaching breach right now, and a per-ticket drill-down. See classify() for the
 * on-time/overdue/pending definition and controllabilityOf() for the internal/dependency/external
 * split — both derived entirely from real synced fields, nothing here is mocked.
 */
export async function getP1SlaReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<P1SlaReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    const todayIso = toManilaDateString(new Date().toISOString()) || endDate;

    const rows = (await fetchP1Rows(team, startDate, endDate, issueType)).filter((r) => {
      if (isExcludedIssueType(team, r.issue_type)) return false;
      const createdIso = toManilaDateString(r.created);
      return createdIso !== null && createdIso >= startDate && createdIso <= endDate;
    });

    const classified: Classified[] = rows.map((r) => ({ row: r, cls: classify(r, todayIso) }));
    const decided = classified.filter((x) => x.cls.decided);
    const onTime = decided.filter((x) => x.cls.onTime);
    const overdue = decided.filter((x) => x.cls.overdue);
    const pending = classified.filter((x) => !x.cls.decided);
    const overdueRows = overdue.map((x) => x.row);

    const resolutionMinutesList = classified.map((x) => resolutionMinutesOf(x.row)).filter((v): v is number => v !== null);

    const crossTeamDelay = overdue.filter(
      (x) => isRealEscalation(x.row.escalation_value) || holdingReasonsOf(x.row).some((h) => OTHER_TEAM_HOLDING_REASONS.includes(h))
    );

    const holdingReasonCounts: Record<string, number> = {};
    for (const r of overdueRows) {
      for (const reason of holdingReasonsOf(r)) {
        holdingReasonCounts[reason] = (holdingReasonCounts[reason] || 0) + 1;
      }
    }

    let escalationEntries = 0;
    const escalationCounts: Record<string, number> = {};
    for (const r of overdueRows) {
      for (const target of escalationTargets(r.escalation_value)) {
        escalationCounts[target] = (escalationCounts[target] || 0) + 1;
        escalationEntries++;
      }
    }

    const labelCounts: Record<string, number> = {};
    for (const r of overdueRows) {
      for (const label of meaningfulLabels(r.labels)) {
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      }
    }

    const controllabilityCounts: Record<DelayControllability, number> = { internal: 0, dependency: 0, external: 0 };
    for (const r of overdueRows) controllabilityCounts[controllabilityOf(r)]++;
    const controllability: P1SlaReport["controllability"] = {
      internal: { count: controllabilityCounts.internal, share: overdueRows.length ? round4(controllabilityCounts.internal / overdueRows.length) : null },
      dependency: { count: controllabilityCounts.dependency, share: overdueRows.length ? round4(controllabilityCounts.dependency / overdueRows.length) : null },
      external: { count: controllabilityCounts.external, share: overdueRows.length ? round4(controllabilityCounts.external / overdueRows.length) : null },
    };

    const daysOverdueList = overdue.map((x) => x.cls.daysOverdue).filter((v): v is number => v !== null);

    // Previous-period comparison — swallow failures rather than let one bad fetch blank the
    // whole report; the current period's own numbers are still valid without it.
    let comparison: P1PeriodComparison | null = null;
    try {
      const prevPeriod = shiftPeriod(range as RangeType, period, -1);
      const prev = await summarizePeriod(team, range, prevPeriod, issueType, todayIso);
      const current = {
        createdInPeriod: rows.length,
        onTimeRate: decided.length ? round4(onTime.length / decided.length) : null,
        avgResolutionMinutes: resolutionMinutesList.length ? round2(resolutionMinutesList.reduce((a, b) => a + b, 0) / resolutionMinutesList.length) : null,
        medianResolutionMinutes: median(resolutionMinutesList),
      };
      comparison = {
        createdInPeriod: {
          current: current.createdInPeriod,
          previous: prev.createdInPeriod,
          deltaPct: pctDelta(current.createdInPeriod, prev.createdInPeriod),
        },
        onTimeRate: {
          current: current.onTimeRate,
          previous: prev.onTimeRate,
          deltaPp: current.onTimeRate !== null && prev.onTimeRate !== null ? round4(current.onTimeRate - prev.onTimeRate) : null,
        },
        avgResolutionMinutes: {
          current: current.avgResolutionMinutes,
          previous: prev.avgResolutionMinutes,
          deltaPct: pctDelta(current.avgResolutionMinutes, prev.avgResolutionMinutes),
        },
        medianResolutionMinutes: {
          current: current.medianResolutionMinutes,
          previous: prev.medianResolutionMinutes,
          deltaPct: pctDelta(current.medianResolutionMinutes, prev.medianResolutionMinutes),
        },
      };
    } catch {
      comparison = null;
    }

    const byProduct = problemAreas(decided, (r) => r.product || "(none)");
    const byIssueType = problemAreas(decided, (r) => r.issue_type || "(none)");
    const byAssignee = problemAreas(decided, (r) => backlogAgingAssignee(teamConfig, r) || "(unassigned)");
    const patterns = recurringPatterns(decided);
    const atRisk = atRiskTickets(pending, teamConfig, todayIso);

    const sortedTickets = classified
      .slice()
      .sort((a, b) => {
        const rankDiff = ticketSortRank(a) - ticketSortRank(b);
        if (rankDiff !== 0) return rankDiff;
        if (ticketSortRank(a) === 0) return (b.cls.daysOverdue ?? 0) - (a.cls.daysOverdue ?? 0); // overdue: worst first
        if (ticketSortRank(a) === 1) return (a.row.due_date ?? "").localeCompare(b.row.due_date ?? ""); // pending: soonest due first
        return b.row.created.localeCompare(a.row.created); // on time: most recent first
      });

    const tickets = sortedTickets.slice(0, BREAKDOWN_TICKET_LIMIT).map((x) => ({
      ...toTicketRow(x, todayIso),
      assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
    }));

    const report = {
      team,
      range,
      period,
      issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      todayIso,
      createdInPeriod: rows.length,
      decided: decided.length,
      onTimeCount: onTime.length,
      onTimeRate: decided.length ? round4(onTime.length / decided.length) : null,
      overdueCount: overdue.length,
      pendingCount: pending.length,
      avgResolutionMinutes: resolutionMinutesList.length
        ? round2(resolutionMinutesList.reduce((a, b) => a + b, 0) / resolutionMinutesList.length)
        : null,
      medianResolutionMinutes: median(resolutionMinutesList),
      crossTeamDelayCount: crossTeamDelay.length,
      crossTeamDelayRate: overdue.length ? round4(crossTeamDelay.length / overdue.length) : null,
      comparison,
      trend: buildTrend(range, startDate, endDate, classified),
      byHoldingReason: toCountRows(holdingReasonCounts, 0),
      byEscalationTarget: toCountRows(escalationCounts, escalationEntries),
      byLabel: toCountRows(labelCounts, overdueRows.length),
      controllability,
      avgDaysOverdue: daysOverdueList.length ? round2(daysOverdueList.reduce((a, b) => a + b, 0) / daysOverdueList.length) : null,
      byProduct,
      byIssueType,
      byAssignee,
      patterns,
      atRisk,
      tickets,
      ticketsTotalCount: classified.length,
      insights: [] as P1Insight[],
      positiveHighlights: [] as P1PositiveHighlight[],
    };

    report.insights = buildInsights({
      onTimeRate: report.onTimeRate,
      createdInPeriod: report.createdInPeriod,
      overdueCount: report.overdueCount,
      decided: report.decided,
      crossTeamDelayRate: report.crossTeamDelayRate,
      comparison: report.comparison,
      byHoldingReason: report.byHoldingReason,
      patterns: report.patterns,
      atRisk: report.atRisk,
    });
    report.positiveHighlights = buildPositiveHighlights(byProduct, comparison);

    return report;
  } catch {
    return { team, range, period, issueType: issueType ?? null, ...EMPTY_REPORT };
  }
}
