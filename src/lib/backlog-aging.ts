import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, backlogAgingAssignee, backlogAgingAssigneeLabel, isExcludedIssueType, type TeamConfig } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, isoDateDiffDays } from "@/lib/manila-date";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { cycleTimeWorkCategoryFor, type CycleTimeWorkCategory } from "@/lib/lead-cycle-time";
import { P1_PRIORITY_VALUE } from "@/lib/p1-sla";
import { riskTierForConsumed, type RiskTier } from "@/lib/sla-status";
import { BREAKDOWN_TICKET_LIMIT } from "@/lib/ticket-breakdowns";

export type BacklogAgingTicket = {
  teamKey: string;
  issueKey: string;
  issueType: string;
  /** The team's configured owner — Assigned COD for DBA/DevOps, Assigned SE for ST. */
  assignee: string;
  dueDate: string;
  resolvedDate: string;
  daysOverdue: number;
};

export type BacklogAgingReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  /** Column header for `assignee` — "Assigned COD" or "Assigned SE", per the team's config. */
  assigneeLabel: string;
  overdueCount: number;
  resolvedInPeriod: number;
  backlogAgingRate: number | null;
  tickets: BacklogAgingTicket[];
};

const EMPTY_REPORT: BacklogAgingReport = {
  team: "", range: "month", period: "", issueType: null, assigneeLabel: "Assignee",
  overdueCount: 0, resolvedInPeriod: 0, backlogAgingRate: null, tickets: [],
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type ResolvedTicketRow = {
  team_key: string;
  issue_key: string;
  issue_type: string | null;
  resolved_datetime: string;
  due_date: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
};

/**
 * Coarse UTC-range prefilter (widened by a day on each side to safely cover the +8h Manila
 * shift) — cuts down what's transferred for a typical week/month/quarter without risking
 * missing a true match; the exact Manila-day check happens in JS afterward, same as the GAS
 * version's toDisplayDate_ comparison.
 */
async function fetchResolvedTickets(
  teamKeys: string[],
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<ResolvedTicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<ResolvedTicketRow>((from, to) => {
    let query = getSupabaseClient()
      .from("tickets")
      .select("team_key,issue_key,issue_type,resolved_datetime,due_date,assigned_se,assigned_cod")
      .in("team_key", teamKeys)
      .not("resolved_datetime", "is", null)
      .gte("resolved_datetime", rangeStartUtc.toISOString())
      .lte("resolved_datetime", rangeEndUtc.toISOString())
      // Explicit order so multi-page fetches (fetchAllRows) can't silently drop/duplicate rows —
      // Postgres has no guaranteed row order without one (see fetchAllRows's own doc comment).
      .order("issue_key", { ascending: true });
    if (issueType) query = query.eq("issue_type", issueType);
    return query.range(from, to);
  });
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `backlog-aging-report` route. Ported from
 * gas/BacklogAgingApi.gs's getBacklogAgingReport_ — the overdue test stays character-for-
 * character the same (resolved calendar day strictly later than the due date) so this
 * reconciles with the "N of M resolved overdue" the metrics scorecard reports.
 *
 * A team's excluded issue types (see excludedIssueTypes in lib/teams.ts) are dropped from BOTH the
 * numerator and the denominator here and in lib/metrics.ts.
 */
export async function getBacklogAgingReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<BacklogAgingReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const allTeams = await getTeams();
    const teams = team === "ALL" ? allTeams : allTeams.filter((t) => t.team_key === team);
    if (!teams.length) throw new Error(`Unknown team: ${team}`);

    const rows = await fetchResolvedTickets(teams.map((t) => t.team_key), startDate, endDate, issueType);
    const teamByKey = new Map(teams.map((t) => [t.team_key, t]));

    const tickets: BacklogAgingTicket[] = [];
    let resolvedInPeriod = 0;

    for (const r of rows) {
      // Skipped before the denominator, exactly as lib/metrics.ts skips its metrics_daily rows —
      // the two must narrow the population identically or the scorecard's "N of M resolved
      // overdue" stops reconciling with this list.
      if (isExcludedIssueType(r.team_key, r.issue_type)) continue;

      const resolvedIso = toManilaDateString(r.resolved_datetime);
      if (!resolvedIso || resolvedIso < startDate || resolvedIso > endDate) continue;
      resolvedInPeriod++;

      const dueIso = r.due_date;
      if (!dueIso || resolvedIso <= dueIso) continue;

      const teamConfig = teamByKey.get(r.team_key);
      if (!teamConfig) continue;

      tickets.push({
        teamKey: r.team_key,
        issueKey: r.issue_key,
        issueType: r.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
        dueDate: dueIso,
        resolvedDate: resolvedIso,
        daysOverdue: isoDateDiffDays(dueIso, resolvedIso),
      });
    }

    tickets.sort((a, b) => b.daysOverdue - a.daysOverdue || a.issueKey.localeCompare(b.issueKey));

    return {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: teams.length === 1 ? backlogAgingAssigneeLabel(teams[0]) : "Assignee",
      overdueCount: tickets.length,
      resolvedInPeriod,
      backlogAgingRate: resolvedInPeriod ? round4(tickets.length / resolvedInPeriod) : null,
      tickets,
    };
  } catch {
    return { ...EMPTY_REPORT, team, range, period, issueType: issueType ?? null };
  }
}

// =====================================================================================
// Backlog & Ageing DEEP-DIVE — manager/lead revision (2026-09-03 brief). Everything below
// is additive: getBacklogAgingReport() above is untouched and still backs the team-overview
// scorecard. Ageing Rate itself is not redefined anywhere below — it is always "resolved
// beyond due date / total resolved," computed the same way as above.
//
// ZERO Lead Time / Cycle Time terminology, numbers or cross-links belong anywhere in this
// section or the components that render it — the only cross-import from lib/lead-cycle-time
// is cycleTimeWorkCategoryFor(), a pure Backend-Changes/Investigations classifier already
// shared between the Lead Time and Cycle Time pages, not a Lead/Cycle Time number.
// =====================================================================================

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percentileOf(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return round1(sortedAsc[0]);
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round1(sortedAsc[lo]);
  return round1(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo));
}

function medianOfDays(sortedAsc: number[]): number | null {
  return percentileOf(sortedAsc, 50);
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isP1Priority(priority: string | null | undefined): boolean {
  return (priority || "").trim().toLowerCase() === P1_PRIORITY_VALUE.toLowerCase();
}

function bumpRiskTier(tier: RiskTier): RiskTier {
  if (tier === "healthy") return "watch";
  if (tier === "watch") return "atRisk";
  return "critical";
}

/** Display labels for RiskTier in an Aging Risk context — brief section 19's own vocabulary
 * ("Critical / Aging Risk / Watch / Normal"), reusing lib/sla-status.ts's tier MATH (already
 * the app's one established "% of a ticket's own due-date window consumed" rule) rather than
 * inventing new thresholds. RiskTier's healthy end is called "healthy" (P1 SLA's vocabulary);
 * this page just relabels it "Normal" for display. */
export const AGING_RISK_LABEL: Record<RiskTier, string> = {
  healthy: "Normal",
  watch: "Watch",
  atRisk: "Aging Risk",
  critical: "Critical",
};

/** 0-1d / 2-3d / ... / 60+d — brief section 17's fallback bucket set; no existing bucket set
 * was found anywhere else in the codebase to reuse instead. */
export const BACKLOG_AGE_BUCKETS: ReadonlyArray<{ label: string; minDays: number; maxDays: number | null }> = [
  { label: "0-1d", minDays: 0, maxDays: 2 },
  { label: "2-3d", minDays: 2, maxDays: 4 },
  { label: "4-7d", minDays: 4, maxDays: 8 },
  { label: "8-14d", minDays: 8, maxDays: 15 },
  { label: "15-30d", minDays: 15, maxDays: 31 },
  { label: "31-60d", minDays: 31, maxDays: 61 },
  { label: "60+d", minDays: 61, maxDays: null },
];

/** Her own example number (brief section 21: "no meaningful movement for more than 5 days") —
 * named constant so it's one place to tune, not a magic number scattered around. */
export const STALE_DAYS_THRESHOLD = 5;

function ageStats(sortedAscDays: number[]) {
  return {
    count: sortedAscDays.length,
    medianAgeDays: medianOfDays(sortedAscDays),
    avgAgeDays: sortedAscDays.length ? round1(sortedAscDays.reduce((s, d) => s + d, 0) / sortedAscDays.length) : null,
    p75AgeDays: percentileOf(sortedAscDays, 75),
    p90AgeDays: percentileOf(sortedAscDays, 90),
    oldestAgeDays: sortedAscDays.length ? sortedAscDays[sortedAscDays.length - 1] : null,
  };
}
export type BacklogAgeStats = ReturnType<typeof ageStats>;

// ------------------------------------------------------------------- Current open backlog

type OpenTicketRow = {
  team_key: string;
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  created: string;
  updated: string;
  due_date: string | null;
  priority: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
};

/**
 * Every ticket currently open for the team(s) — no date-range filter at all beyond
 * resolved_datetime IS NULL. "Current backlog" answers "what's open right now," the same way
 * P1 SLA's atRiskTickets() is inherently live/today-relative regardless of the period filter
 * selected elsewhere on the page. Ordered by issue_key so fetchAllRows's paging can't silently
 * drop/duplicate rows (see that function's own doc comment, and the fix already applied above
 * to fetchResolvedTickets).
 */
async function fetchOpenTickets(teamKeys: string[]): Promise<OpenTicketRow[]> {
  return fetchAllRows<OpenTicketRow>((from, to) =>
    getSupabaseClient()
      .from("tickets")
      .select("team_key,issue_key,issue_type,status,created,updated,due_date,priority,product,labels,assigned_se,assigned_cod")
      .in("team_key", teamKeys)
      .is("resolved_datetime", null)
      .order("issue_key", { ascending: true })
      .range(from, to)
  );
}

export type BacklogOpenTicket = {
  teamKey: string;
  issueKey: string;
  issueType: string;
  workCategory: CycleTimeWorkCategory | null;
  status: string;
  assignee: string;
  priority: string;
  product: string;
  labels: string | null;
  createdAt: string;
  dueDate: string | null;
  ageDays: number;
  /** age expressed as minutes (ageDays * 1440) purely so components can reuse the app's
   * existing formatDaysValue/formatDurationBreakdown helpers — there is no sub-day precision
   * here, it's a calendar-day difference. */
  ageMinutes: number;
  daysSinceUpdate: number;
  stale: boolean;
  /** Fraction of the ticket's own created→due window elapsed, for tickets with a due date —
   * same math as lib/p1-sla.ts's atRiskTickets(). Null when there's no due date. */
  consumedFraction: number | null;
  riskTier: RiskTier;
};

function decorateOpenTicket(
  r: OpenTicketRow,
  teamConfig: TeamConfig,
  todayIso: string,
  populationP90AgeDays: number | null
): BacklogOpenTicket {
  const createdIso = toManilaDateString(r.created) || todayIso;
  const ageDays = Math.max(0, isoDateDiffDays(createdIso, todayIso));
  const updatedIso = toManilaDateString(r.updated) || createdIso;
  const daysSinceUpdate = Math.max(0, isoDateDiffDays(updatedIso, todayIso));
  const stale = daysSinceUpdate >= STALE_DAYS_THRESHOLD;

  let consumedFraction: number | null = null;
  let riskTier: RiskTier;
  if (r.due_date) {
    const totalWindowDays = Math.max(1, isoDateDiffDays(createdIso, r.due_date));
    const elapsedDays = Math.max(0, isoDateDiffDays(createdIso, todayIso));
    consumedFraction = round4(elapsedDays / totalWindowDays);
    if (todayIso > r.due_date) {
      // Already missed its own due date — every overdue ticket has elapsed/window >= 1, so
      // tiering on consumedFraction directly would dump EVERY overdue ticket straight into
      // "critical" regardless of whether it's a day late or years late, collapsing the whole
      // gradient. Instead tier by how much EXTRA time has elapsed BEYOND the due date, relative
      // to that same window — same riskTierForConsumed math P1 SLA already uses for a
      // not-yet-due ticket, just applied to the overdue overshoot. Never healthier than "Aging
      // Risk" once actually overdue (a fresh miss is still a miss), escalating to "Critical"
      // once the overshoot itself approaches the ticket's own original window.
      const daysOverdue = isoDateDiffDays(r.due_date, todayIso);
      const overshootTier = riskTierForConsumed(daysOverdue / totalWindowDays);
      riskTier = overshootTier === "healthy" || overshootTier === "watch" ? "atRisk" : overshootTier;
    } else {
      riskTier = riskTierForConsumed(consumedFraction);
    }
  } else {
    // No due date on this issue type — fall back to the CURRENT population's own P90 age
    // (data-driven, not an invented fixed day count per brief section 47) rather than leaving
    // every undated ticket un-tiered.
    riskTier = populationP90AgeDays !== null && ageDays >= populationP90AgeDays ? "watch" : "healthy";
  }
  if (isP1Priority(r.priority)) riskTier = bumpRiskTier(riskTier);

  return {
    teamKey: r.team_key,
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    // Backend Changes vs. Investigations is an SE-only concept — the classifier's issue-type
    // names (e.g. "Task") aren't unique to SE, so this must stay gated on the TEAM actually
    // having the split, or another team's same-named issue type (confirmed live: DBA's "Task")
    // gets mislabeled "Backend Changes" purely by coincidence.
    workCategory: teamConfig.has_peer_review_tracking ? cycleTimeWorkCategoryFor(r.issue_type) : null,
    status: r.status || "(no status)",
    assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
    priority: r.priority || "(none)",
    product: r.product || "(none)",
    labels: r.labels,
    createdAt: r.created,
    dueDate: r.due_date,
    ageDays,
    ageMinutes: ageDays * 1440,
    daysSinceUpdate,
    stale,
    consumedFraction,
    riskTier,
  };
}

// ------------------------------------------------------------ Point-in-time backlog size

type OpenAsOfRow = { team_key: string; created: string; resolved_datetime: string | null };

/**
 * "Was this ticket open as of the end of Manila calendar day `asOfIso`" — reconstructed
 * directly from `tickets` (created ≤ asOfIso AND (never resolved OR resolved after asOfIso)),
 * not a snapshot table. One fetch covers every asOf point the caller needs as long as it passes
 * the EARLIEST asOf date as `earliestAsOfIso` (so the coarse prefilter doesn't exclude tickets
 * that were already resolved by the time of a later asOf check but still open at an earlier
 * one) — see countOpenAsOf below, which does the exact per-date Manila-day filtering in JS.
 */
async function fetchTicketsOpenAsOf(teamKeys: string[], earliestAsOfIso: string, latestAsOfIso: string): Promise<OpenAsOfRow[]> {
  const earliestUtc = new Date(`${earliestAsOfIso}T00:00:00Z`);
  earliestUtc.setUTCDate(earliestUtc.getUTCDate() - 1);
  const latestUtc = new Date(`${latestAsOfIso}T00:00:00Z`);
  latestUtc.setUTCDate(latestUtc.getUTCDate() + 2);

  return fetchAllRows<OpenAsOfRow>((from, to) =>
    getSupabaseClient()
      .from("tickets")
      .select("team_key,created,resolved_datetime")
      .in("team_key", teamKeys)
      .lte("created", latestUtc.toISOString())
      .or(`resolved_datetime.is.null,resolved_datetime.gte.${earliestUtc.toISOString()}`)
      .order("issue_key", { ascending: true })
      .range(from, to)
  );
}

function countOpenAsOf(rows: OpenAsOfRow[], asOfIso: string): { count: number; ageDaysAsc: number[] } {
  const ageDaysAsc: number[] = [];
  for (const r of rows) {
    const createdIso = toManilaDateString(r.created);
    if (!createdIso || createdIso > asOfIso) continue;
    const resolvedIso = toManilaDateString(r.resolved_datetime);
    if (resolvedIso && resolvedIso <= asOfIso) continue;
    ageDaysAsc.push(Math.max(0, isoDateDiffDays(createdIso, asOfIso)));
  }
  ageDaysAsc.sort((a, b) => a - b);
  return { count: ageDaysAsc.length, ageDaysAsc };
}

// ----------------------------------------------------------------- metrics_daily (trend)

type BacklogMetricsDailyRow = {
  date: string;
  team_key: string;
  issue_type: string | null;
  tickets_created_count: number;
  tickets_resolved_on_date: number;
  overdue_resolved_on_date: number;
};

async function fetchBacklogMetricsDailyRows(teamKeys: string[], startDate: string, endDate: string, issueType?: string): Promise<BacklogMetricsDailyRow[]> {
  return fetchAllRows<BacklogMetricsDailyRow>((from, to) => {
    let q = getSupabaseClient()
      .from("metrics_daily")
      .select("date,team_key,issue_type,tickets_created_count,tickets_resolved_on_date,overdue_resolved_on_date")
      .in("team_key", teamKeys)
      .gte("date", startDate)
      .lte("date", endDate);
    if (issueType) q = q.eq("issue_type", issueType);
    return q.range(from, to);
  });
}

function aggregateMetricsDaily(rows: BacklogMetricsDailyRow[]) {
  let incoming = 0, completed = 0, resolvedInPeriod = 0, beyondDue = 0;
  for (const r of rows) {
    if (isExcludedIssueType(r.team_key, r.issue_type)) continue;
    incoming += Number(r.tickets_created_count) || 0;
    completed += Number(r.tickets_resolved_on_date) || 0;
    resolvedInPeriod += Number(r.tickets_resolved_on_date) || 0;
    beyondDue += Number(r.overdue_resolved_on_date) || 0;
  }
  return { incoming, completed, resolvedInPeriod, beyondDue };
}

export type BacklogTrendPoint = { bucket: string; incoming: number; completed: number; net: number };
export type AgeingRateTrendPoint = { bucket: string; resolved: number; beyondDue: number; rate: number | null };

/** Daily points for week/month; rolled up to monthly for quarter/year — same granularity rule
 * lib/metrics.ts's buildSeries and every other Phase-4 trend chart already use, kept local
 * rather than imported since metrics.ts doesn't export its version for reuse. */
function buildBacklogTrend(rows: BacklogMetricsDailyRow[], monthly: boolean): { trend: BacklogTrendPoint[]; ageingRateTrend: AgeingRateTrendPoint[] } {
  const byBucket = new Map<string, { incoming: number; completed: number; resolved: number; beyondDue: number }>();
  for (const r of rows) {
    if (isExcludedIssueType(r.team_key, r.issue_type)) continue;
    const bucket = monthly ? r.date.slice(0, 7) : r.date;
    if (!byBucket.has(bucket)) byBucket.set(bucket, { incoming: 0, completed: 0, resolved: 0, beyondDue: 0 });
    const b = byBucket.get(bucket)!;
    b.incoming += Number(r.tickets_created_count) || 0;
    b.completed += Number(r.tickets_resolved_on_date) || 0;
    b.resolved += Number(r.tickets_resolved_on_date) || 0;
    b.beyondDue += Number(r.overdue_resolved_on_date) || 0;
  }
  const buckets = Array.from(byBucket.keys()).sort();
  return {
    trend: buckets.map((k) => {
      const b = byBucket.get(k)!;
      return { bucket: k, incoming: b.incoming, completed: b.completed, net: b.incoming - b.completed };
    }),
    ageingRateTrend: buckets.map((k) => {
      const b = byBucket.get(k)!;
      return { bucket: k, resolved: b.resolved, beyondDue: b.beyondDue, rate: b.resolved ? round4(b.beyondDue / b.resolved) : null };
    }),
  };
}

// -------------------------------------------------------------------- Breakdown builders

export type BacklogBreakdownRow = {
  key: string;
  count: number;
  pctOfBacklog: number | null;
  medianAgeMinutes: number | null;
  p75AgeMinutes: number | null;
  p90AgeMinutes: number | null;
  oldestAgeMinutes: number | null;
  agingRiskCount: number;
  staleCount: number;
  /** SE only, "All SE Work" view only — e.g. "80% Backend / 20% Investigations," same
   * convention as lib/lead-cycle-time.ts's categoryMixLabel on the Individual breakdown. */
  workCategoryMixLabel?: string | null;
};

function buildBacklogBreakdown(tickets: BacklogOpenTicket[], keyOf: (t: BacklogOpenTicket) => string, withCategoryMix = false): BacklogBreakdownRow[] {
  const total = tickets.length;
  const groups = new Map<string, BacklogOpenTicket[]>();
  for (const t of tickets) {
    const k = keyOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const ages = rows.map((r) => r.ageDays).sort((a, b) => a - b);
      const stats = ageStats(ages);
      let workCategoryMixLabel: string | null = null;
      if (withCategoryMix) {
        const backend = rows.filter((r) => r.workCategory === "backend").length;
        const investigations = rows.filter((r) => r.workCategory === "investigations").length;
        const classified = backend + investigations;
        if (classified > 0) {
          workCategoryMixLabel = `${Math.round((backend / classified) * 100)}% Backend / ${Math.round((investigations / classified) * 100)}% Investigations`;
        }
      }
      return {
        key,
        count: rows.length,
        pctOfBacklog: total ? round4(rows.length / total) : null,
        medianAgeMinutes: stats.medianAgeDays === null ? null : stats.medianAgeDays * 1440,
        p75AgeMinutes: stats.p75AgeDays === null ? null : stats.p75AgeDays * 1440,
        p90AgeMinutes: stats.p90AgeDays === null ? null : stats.p90AgeDays * 1440,
        oldestAgeMinutes: stats.oldestAgeDays === null ? null : stats.oldestAgeDays * 1440,
        agingRiskCount: rows.filter((r) => r.riskTier === "atRisk" || r.riskTier === "critical").length,
        staleCount: rows.filter((r) => r.stale).length,
        workCategoryMixLabel,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export type AgeingRateBreakdownRow = { key: string; resolved: number; beyondDue: number; rate: number | null };

/** One row per resolved-in-period ticket (the SAME population getBacklogAgingReport counts for
 * its denominator), decorated with whether it was resolved beyond due date — the shared input
 * every Ageing-Rate-by-X breakdown groups from, so numerator and denominator can never drift
 * from the page's one Ageing Rate definition. */
type AgeingRateRow = { teamKey: string; issueType: string; overdue: boolean };

function buildAgeingRateBreakdown(rows: AgeingRateRow[], keyOf: (r: AgeingRateRow) => string | null): AgeingRateBreakdownRow[] {
  const groups = new Map<string, { resolved: number; beyondDue: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, { resolved: 0, beyondDue: 0 });
    const g = groups.get(key)!;
    g.resolved++;
    if (r.overdue) g.beyondDue++;
  }
  return Array.from(groups.entries())
    .map(([key, g]) => ({ key, resolved: g.resolved, beyondDue: g.beyondDue, rate: g.resolved ? round4(g.beyondDue / g.resolved) : null }))
    .sort((a, b) => b.resolved - a.resolved);
}

// ---------------------------------------------------------------------- Time in status

export type TimeInStatusRow = {
  status: string;
  openCount: number;
  medianDaysSinceUpdate: number | null;
  oldestDaysSinceUpdate: number | null;
  agingRiskCount: number;
};

function buildTimeInStatus(tickets: BacklogOpenTicket[]): TimeInStatusRow[] {
  const groups = new Map<string, BacklogOpenTicket[]>();
  for (const t of tickets) {
    if (!groups.has(t.status)) groups.set(t.status, []);
    groups.get(t.status)!.push(t);
  }
  return Array.from(groups.entries())
    .map(([status, rows]) => {
      const days = rows.map((r) => r.daysSinceUpdate).sort((a, b) => a - b);
      return {
        status,
        openCount: rows.length,
        medianDaysSinceUpdate: medianOfDays(days),
        oldestDaysSinceUpdate: days.length ? days[days.length - 1] : null,
        agingRiskCount: rows.filter((r) => r.riskTier === "atRisk" || r.riskTier === "critical").length,
      };
    })
    .sort((a, b) => b.openCount - a.openCount);
}

// -------------------------------------------------------------------------- Health

export type BacklogHealthStatus = "healthy" | "watch" | "atRisk";
export type BacklogHealthSignal = { text: { professional: string; gaby: string }; tone: "positive" | "watch" | "negative" };

function buildBacklogHealth(input: {
  backlogDelta: { current: number; previous: number };
  p90AgeDays: { current: number | null; previous: number | null };
  agingRiskShare: number | null;
  staleShare: number | null;
}): { status: BacklogHealthStatus; signals: BacklogHealthSignal[] } {
  const signals: BacklogHealthSignal[] = [];
  let worst: BacklogHealthStatus = "healthy";
  const escalate = (s: BacklogHealthStatus) => {
    if (s === "atRisk") worst = "atRisk";
    else if (s === "watch" && worst !== "atRisk") worst = "watch";
  };

  const backlogGrowthPct = input.backlogDelta.previous > 0 ? (input.backlogDelta.current - input.backlogDelta.previous) / input.backlogDelta.previous : null;
  if (backlogGrowthPct !== null && backlogGrowthPct >= 0.2) {
    escalate("atRisk");
    signals.push({
      text: {
        professional: `Backlog grew ${Math.round(backlogGrowthPct * 100)}% since the end of the previous period (${input.backlogDelta.previous} → ${input.backlogDelta.current}).`,
        gaby: `**🚨 Mission Queue is expanding fast.** Backlog grew **${Math.round(backlogGrowthPct * 100)}%** since last period (${input.backlogDelta.previous} → ${input.backlogDelta.current}).`,
      },
      tone: "negative",
    });
  } else if (backlogGrowthPct !== null && backlogGrowthPct >= 0.1) {
    escalate("watch");
    signals.push({
      text: {
        professional: `Backlog grew ${Math.round(backlogGrowthPct * 100)}% since the end of the previous period (${input.backlogDelta.previous} → ${input.backlogDelta.current}).`,
        gaby: `**👀 Mission Queue is growing.** Up **${Math.round(backlogGrowthPct * 100)}%** since last period (${input.backlogDelta.previous} → ${input.backlogDelta.current}).`,
      },
      tone: "watch",
    });
  } else if (backlogGrowthPct !== null && backlogGrowthPct <= -0.1) {
    signals.push({
      text: {
        professional: `Backlog shrank ${Math.round(Math.abs(backlogGrowthPct) * 100)}% since the end of the previous period (${input.backlogDelta.previous} → ${input.backlogDelta.current}).`,
        gaby: `**✅ Queue trajectory improving.** Down **${Math.round(Math.abs(backlogGrowthPct) * 100)}%** since last period.`,
      },
      tone: "positive",
    });
  }

  const p90GrowthPct =
    input.p90AgeDays.previous !== null && input.p90AgeDays.previous > 0 && input.p90AgeDays.current !== null
      ? (input.p90AgeDays.current - input.p90AgeDays.previous) / input.p90AgeDays.previous
      : null;
  if (p90GrowthPct !== null && p90GrowthPct >= 0.2) {
    escalate("watch");
    signals.push({
      text: {
        professional: `P90 backlog age increased ${Math.round(p90GrowthPct * 100)}% since the end of the previous period (${input.p90AgeDays.previous}d → ${input.p90AgeDays.current}d).`,
        gaby: `**👀 The tail is getting longer.** P90 Mission Age is up **${Math.round(p90GrowthPct * 100)}%** since last period.`,
      },
      tone: "watch",
    });
  }

  if (input.agingRiskShare !== null && input.agingRiskShare >= 0.3) {
    escalate("atRisk");
    signals.push({
      text: {
        professional: `${Math.round(input.agingRiskShare * 100)}% of open backlog is currently in Aging Risk or Critical.`,
        gaby: `**🚨 A big chunk of the queue is at risk.** **${Math.round(input.agingRiskShare * 100)}%** of open Missions are Aging Risk or Critical.`,
      },
      tone: "negative",
    });
  } else if (input.agingRiskShare !== null && input.agingRiskShare >= 0.15) {
    escalate("watch");
    signals.push({
      text: {
        professional: `${Math.round(input.agingRiskShare * 100)}% of open backlog is currently in Aging Risk or Critical.`,
        gaby: `**👀 Some Missions need attention.** **${Math.round(input.agingRiskShare * 100)}%** of the queue is Aging Risk or Critical.`,
      },
      tone: "watch",
    });
  }

  if (input.staleShare !== null && input.staleShare >= 0.3) {
    escalate("atRisk");
    signals.push({
      text: {
        professional: `${Math.round(input.staleShare * 100)}% of open backlog has had no update in ${STALE_DAYS_THRESHOLD}+ days.`,
        gaby: `**🚨 Lots of stalled Missions.** **${Math.round(input.staleShare * 100)}%** of the queue hasn't moved in ${STALE_DAYS_THRESHOLD}+ days.`,
      },
      tone: "negative",
    });
  } else if (input.staleShare !== null && input.staleShare >= 0.15) {
    escalate("watch");
    signals.push({
      text: {
        professional: `${Math.round(input.staleShare * 100)}% of open backlog has had no update in ${STALE_DAYS_THRESHOLD}+ days.`,
        gaby: `**👀 A few stalled Missions.** **${Math.round(input.staleShare * 100)}%** of the queue hasn't moved in ${STALE_DAYS_THRESHOLD}+ days.`,
      },
      tone: "watch",
    });
  }

  if (!signals.length) {
    signals.push({
      text: {
        professional: "Backlog is stable, most open work is young, and aging risk/stale counts are low.",
        gaby: "**✅ All systems nominal.** Mission Queue is stable and healthy.",
      },
      tone: "positive",
    });
  }

  return { status: worst, signals };
}

// ------------------------------------------------------------------------ Insights

export type BacklogInsight = { text: { professional: string; gaby: string }; tone: "positive" | "watch" | "negative" };

function buildBacklogInsights(input: {
  backlogDelta: { current: number; previous: number };
  currentAge: BacklogAgeStats;
  staleCount: number;
  backlogCount: number;
  byStatus: TimeInStatusRow[];
  ageingRate: { current: number | null; previous: number | null };
  byWorkCategory: BacklogBreakdownRow[];
  byOwner: BacklogBreakdownRow[];
  ownerLabel: string;
}): BacklogInsight[] {
  const insights: BacklogInsight[] = [];

  if (input.backlogDelta.previous > 0) {
    const deltaPct = (input.backlogDelta.current - input.backlogDelta.previous) / input.backlogDelta.previous;
    if (Math.abs(deltaPct) >= 0.1) {
      const growing = deltaPct > 0;
      insights.push({
        text: {
          professional: `Backlog ${growing ? "grew" : "shrank"} ${Math.round(Math.abs(deltaPct) * 100)}% since the end of the previous period (${input.backlogDelta.previous} → ${input.backlogDelta.current}).`,
          gaby: growing
            ? `**Mission Queue is expanding.** ${input.backlogDelta.previous} → ${input.backlogDelta.current} since last period.`
            : `**Queue trajectory improving.** ${input.backlogDelta.previous} → ${input.backlogDelta.current} since last period.`,
        },
        tone: growing ? "negative" : "positive",
      });
    }
  }

  if (input.currentAge.medianAgeDays !== null && input.currentAge.p90AgeDays !== null && input.currentAge.p90AgeDays > input.currentAge.medianAgeDays * 3 && input.currentAge.count >= 5) {
    insights.push({
      text: {
        professional: `Aging tail: P90 open-ticket age is ${input.currentAge.p90AgeDays}d against a ${input.currentAge.medianAgeDays}d median — most backlog is young, but a long tail is dragging the top end.`,
        gaby: `**👀 A long tail in the queue.** Median Mission Age is **${input.currentAge.medianAgeDays}d**, but P90 sits at **${input.currentAge.p90AgeDays}d** — a handful of old Missions are skewing things.`,
      },
      tone: "watch",
    });
  }

  if (input.backlogCount > 0 && input.staleCount / input.backlogCount >= 0.1) {
    const pct = Math.round((input.staleCount / input.backlogCount) * 100);
    insights.push({
      text: {
        professional: `${input.staleCount} tickets (${pct}% of open backlog) have had no update in ${STALE_DAYS_THRESHOLD}+ days.`,
        gaby: `**Stalled Missions detected.** ${input.staleCount} tickets (${pct}%) haven't moved in ${STALE_DAYS_THRESHOLD}+ days.`,
      },
      tone: "watch",
    });
  }

  const topStatus = input.byStatus[0];
  if (topStatus && input.backlogCount > 0 && topStatus.openCount / input.backlogCount >= 0.3) {
    const pct = Math.round((topStatus.openCount / input.backlogCount) * 100);
    insights.push({
      text: {
        professional: `${pct}% of current backlog sits in "${topStatus.status}."`,
        gaby: `**Holding pattern detected.** ${pct}% of the Mission Queue is sitting in "${topStatus.status}."`,
      },
      tone: "watch",
    });
  }

  if (input.ageingRate.current !== null && input.ageingRate.previous !== null) {
    const deltaPts = Math.round((input.ageingRate.current - input.ageingRate.previous) * 1000) / 10;
    if (Math.abs(deltaPts) >= 3) {
      const worse = deltaPts > 0;
      insights.push({
        text: {
          professional: `Ageing Rate ${worse ? "worsened" : "improved"} from ${Math.round(input.ageingRate.previous * 1000) / 10}% to ${Math.round(input.ageingRate.current * 1000) / 10}% vs the previous period (${worse ? "+" : ""}${deltaPts} pts).`,
          gaby: worse
            ? `**Mission timeliness is slipping.** Ageing Rate moved **${Math.round(input.ageingRate.previous * 1000) / 10}% → ${Math.round(input.ageingRate.current * 1000) / 10}%** vs last period.`
            : `**Mission timeliness improving.** Ageing Rate moved **${Math.round(input.ageingRate.previous * 1000) / 10}% → ${Math.round(input.ageingRate.current * 1000) / 10}%** vs last period.`,
        },
        tone: worse ? "negative" : "positive",
      });
    }
  }

  const topCategory = input.byWorkCategory[0];
  if (topCategory && input.backlogCount > 0 && topCategory.pctOfBacklog !== null && topCategory.pctOfBacklog >= 0.5) {
    const label = topCategory.key === "backend" ? "Backend Changes" : "Investigations";
    insights.push({
      text: {
        professional: `${label} represents ${Math.round(topCategory.pctOfBacklog * 100)}% of current SE backlog.`,
        gaby: `**${label === "Backend Changes" ? "Backend Missions" : "Recon Missions"} accumulating.** ${Math.round(topCategory.pctOfBacklog * 100)}% of the SE queue.`,
      },
      tone: "watch",
    });
  }

  const topOwner = input.byOwner[0];
  if (topOwner && topOwner.pctOfBacklog !== null && topOwner.pctOfBacklog >= 0.3) {
    insights.push({
      text: {
        professional: `${input.ownerLabel} workload is concentrated: ${topOwner.key} holds ${Math.round(topOwner.pctOfBacklog * 100)}% of open backlog, with ${topOwner.agingRiskCount} flagged as aging risk.`,
        gaby: `**Mission Operator workload is concentrated.** ${topOwner.key} holds **${Math.round(topOwner.pctOfBacklog * 100)}%** of open backlog, ${topOwner.agingRiskCount} flagged as Mission Risk.`,
      },
      tone: "watch",
    });
  }

  return insights.slice(0, 5);
}

// ---------------------------------------------------------------------- The report

export type BacklogAgingDeepDiveReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  workCategory: CycleTimeWorkCategory | null;
  hasWorkCategorySplit: boolean;
  assigneeLabel: string;

  summary: {
    openingBacklog: number;
    incoming: number;
    completed: number;
    endingBacklog: number;
    netChange: number;
    backlogDelta: { current: number; previous: number; deltaPct: number | null };
  };

  currentAge: BacklogAgeStats & {
    oldestTicketKey: string | null;
    comparison: {
      medianAgeDays: { current: number | null; previous: number | null };
      p90AgeDays: { current: number | null; previous: number | null };
      oldestAgeDays: { current: number | null; previous: number | null };
    };
  };

  resolutionTimeliness: {
    ageingRate: number | null;
    resolved: number;
    beyondDue: number;
    comparison: { current: number | null; previous: number | null; deltaPts: number | null };
  };

  health: { status: BacklogHealthStatus; signals: BacklogHealthSignal[] };

  trend: BacklogTrendPoint[];
  ageingRateTrend: AgeingRateTrendPoint[];
  ageDistribution: { label: string; minDays: number; maxDays: number | null; count: number; share: number | null }[];

  agingRiskSummary: { critical: number; atRisk: number; watch: number; healthy: number };

  byWorkCategory: BacklogBreakdownRow[];
  byIssueType: BacklogBreakdownRow[];
  byPriority: BacklogBreakdownRow[];
  byProduct: BacklogBreakdownRow[];
  byOwner: BacklogBreakdownRow[];

  ageingRateByWorkCategory: AgeingRateBreakdownRow[];
  ageingRateByIssueType: AgeingRateBreakdownRow[];

  timeInStatus: TimeInStatusRow[];

  oldestTickets: BacklogOpenTicket[];
  attention: {
    criticalAging: BacklogOpenTicket[];
    dueDateRisk: BacklogOpenTicket[];
    stalled: BacklogOpenTicket[];
    /** A narrative pointer, not a ticket list — "Concentrated Backlog" (brief section 20) is an
     * aggregate statement about a dimension, not a set of tickets; the reader follows it to the
     * matching breakdown table already on the page. */
    concentration: { text: { professional: string; gaby: string } } | null;
  };
  staleTickets: BacklogOpenTicket[];
  staleTotalCount: number;

  insights: BacklogInsight[];

  tickets: BacklogOpenTicket[];
  ticketsTotalCount: number;

  /** The existing Ageing Rate ticket-detail table's population (resolved beyond due date) —
   * same shape/definition as getBacklogAgingReport's own `tickets`. */
  overdueTickets: BacklogAgingTicket[];
};

const EMPTY_DEEP_DIVE_STATS: BacklogAgeStats = { count: 0, medianAgeDays: null, avgAgeDays: null, p75AgeDays: null, p90AgeDays: null, oldestAgeDays: null };

function emptyDeepDive(team: string, range: string, period: string, issueType?: string, workCategory?: CycleTimeWorkCategory): BacklogAgingDeepDiveReport {
  return {
    team, range, period, issueType: issueType ?? null, workCategory: workCategory ?? null, hasWorkCategorySplit: false, assigneeLabel: "Assignee",
    summary: { openingBacklog: 0, incoming: 0, completed: 0, endingBacklog: 0, netChange: 0, backlogDelta: { current: 0, previous: 0, deltaPct: null } },
    currentAge: { ...EMPTY_DEEP_DIVE_STATS, oldestTicketKey: null, comparison: { medianAgeDays: { current: null, previous: null }, p90AgeDays: { current: null, previous: null }, oldestAgeDays: { current: null, previous: null } } },
    resolutionTimeliness: { ageingRate: null, resolved: 0, beyondDue: 0, comparison: { current: null, previous: null, deltaPts: null } },
    health: { status: "healthy", signals: [] },
    trend: [], ageingRateTrend: [], ageDistribution: [],
    agingRiskSummary: { critical: 0, atRisk: 0, watch: 0, healthy: 0 },
    byWorkCategory: [], byIssueType: [], byPriority: [], byProduct: [], byOwner: [],
    ageingRateByWorkCategory: [], ageingRateByIssueType: [],
    timeInStatus: [],
    oldestTickets: [],
    attention: { criticalAging: [], dueDateRisk: [], stalled: [], concentration: null },
    staleTickets: [], staleTotalCount: 0,
    insights: [],
    tickets: [], ticketsTotalCount: 0,
    overdueTickets: [],
  };
}

export async function getBacklogAgingDeepDive(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  workCategory?: CycleTimeWorkCategory
): Promise<BacklogAgingDeepDiveReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const prevPeriod = shiftPeriod(range as RangeType, period, -1);
    const { startDate: prevStart, endDate: prevEnd } = resolvePeriodToDateRange(range, prevPeriod);
    const todayIso = toManilaDateString(new Date().toISOString())!;

    const allTeams = await getTeams();
    const teams = team === "ALL" ? allTeams : allTeams.filter((t) => t.team_key === team);
    if (!teams.length) throw new Error(`Unknown team: ${team}`);
    const teamKeys = teams.map((t) => t.team_key);
    const teamByKey = new Map(teams.map((t) => [t.team_key, t]));
    const singleTeam = teams.length === 1 ? teams[0] : null;
    const hasWorkCategorySplit = Boolean(singleTeam?.has_peer_review_tracking);
    const effectiveWorkCategory = hasWorkCategorySplit ? workCategory : undefined;

    const [openRowsRaw, resolvedRows, prevResolvedRows, metricsDailyRows, openAsOfRows] = await Promise.all([
      fetchOpenTickets(teamKeys),
      fetchResolvedTickets(teamKeys, startDate, endDate, issueType),
      fetchResolvedTickets(teamKeys, prevStart, prevEnd, issueType),
      fetchBacklogMetricsDailyRows(teamKeys, startDate, endDate, issueType),
      fetchTicketsOpenAsOf(teamKeys, prevEnd, endDate),
    ]);

    // ---- Filter open rows by issueType / workCategory (mirrors every other Phase-4 report's
    // per-issueType filter, plus the SE-only workCategory re-scope already established for
    // Lead/Cycle Time) and excluded issue types (SE: Technical Story).
    const openRows = openRowsRaw.filter((r) => {
      if (isExcludedIssueType(r.team_key, r.issue_type)) return false;
      if (issueType && r.issue_type !== issueType) return false;
      if (effectiveWorkCategory && cycleTimeWorkCategoryFor(r.issue_type) !== effectiveWorkCategory) return false;
      return true;
    });

    // ---- Current backlog age stats + decorated open tickets (population P90 computed first so
    // undated tickets can be tiered against it — see decorateOpenTicket).
    const rawAgesDays = openRows
      .map((r) => {
        const createdIso = toManilaDateString(r.created);
        return createdIso ? Math.max(0, isoDateDiffDays(createdIso, todayIso)) : null;
      })
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    const currentStatsRaw = ageStats(rawAgesDays);

    const tickets: BacklogOpenTicket[] = openRows
      .map((r) => {
        const teamConfig = teamByKey.get(r.team_key);
        if (!teamConfig) return null;
        return decorateOpenTicket(r, teamConfig, todayIso, currentStatsRaw.p90AgeDays);
      })
      .filter((t): t is BacklogOpenTicket => t !== null)
      .sort((a, b) => b.ageDays - a.ageDays);

    const oldestTicketKey = tickets.length ? tickets[0].issueKey : null;

    // ---- Point-in-time backlog size (Opening/Ending, current + previous-period-end for the
    // age comparison) — reconstructed from tickets, not a snapshot table (see fetchTicketsOpenAsOf).
    const openingAsOf = countOpenAsOf(openAsOfRows, addDaysIso(startDate, -1));
    const endingAsOf = countOpenAsOf(openAsOfRows, endDate);
    const prevEndingAsOf = countOpenAsOf(openAsOfRows, prevEnd);
    const prevEndAgeStats = ageStats(prevEndingAsOf.ageDaysAsc);

    // ---- metrics_daily trend + aggregates (Incoming/Completed for the current period; the
    // previous period's totals come from resolvedRows/prevResolvedRows below for Ageing Rate,
    // and from a second lightweight metrics_daily fetch is unnecessary since Incoming/Completed
    // deltas aren't part of the summary card set the brief asks for — only Backlog/Age/Ageing
    // Rate get an explicit previous-period comparison, per section 13).
    const monthly = range === "year" || range === "quarter";
    const { trend, ageingRateTrend } = buildBacklogTrend(metricsDailyRows, monthly);
    const currentAgg = aggregateMetricsDaily(metricsDailyRows);

    // ---- Ageing Rate (current + previous period) — same overdue/resolved definition as
    // getBacklogAgingReport, computed independently here so the deep-dive doesn't need a second
    // call into that function (it already has the resolved rows fetched above).
    const classifyResolved = (rows: ResolvedTicketRow[], rangeStart: string, rangeEnd: string) => {
      const overdueTickets: BacklogAgingTicket[] = [];
      const ageingRateRows: AgeingRateRow[] = [];
      let resolvedInPeriod = 0;
      for (const r of rows) {
        if (isExcludedIssueType(r.team_key, r.issue_type)) continue;
        if (issueType && r.issue_type !== issueType) continue;
        if (effectiveWorkCategory && cycleTimeWorkCategoryFor(r.issue_type) !== effectiveWorkCategory) continue;
        const resolvedIso = toManilaDateString(r.resolved_datetime);
        // fetchResolvedTickets' UTC prefilter is deliberately widened ±1-2 days to safely cover
        // the +8h Manila shift — this exact-day re-check (same as getBacklogAgingReport's own
        // loop) is what actually narrows to the requested period; skipping it double-counted
        // borderline tickets from the widened window and inflated Resolved/Ageing Rate above
        // what the team-overview scorecard reports for the identical team/period.
        if (!resolvedIso || resolvedIso < rangeStart || resolvedIso > rangeEnd) continue;
        resolvedInPeriod++;
        const overdue = Boolean(r.due_date && resolvedIso > r.due_date);
        ageingRateRows.push({ teamKey: r.team_key, issueType: r.issue_type || "", overdue });
        if (overdue) {
          const teamConfig = teamByKey.get(r.team_key);
          if (teamConfig) {
            overdueTickets.push({
              teamKey: r.team_key,
              issueKey: r.issue_key,
              issueType: r.issue_type || "",
              assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
              dueDate: r.due_date as string,
              resolvedDate: resolvedIso,
              daysOverdue: isoDateDiffDays(r.due_date as string, resolvedIso),
            });
          }
        }
      }
      overdueTickets.sort((a, b) => b.daysOverdue - a.daysOverdue || a.issueKey.localeCompare(b.issueKey));
      return { overdueTickets, ageingRateRows, resolvedInPeriod };
    };
    const current = classifyResolved(resolvedRows, startDate, endDate);
    const previous = classifyResolved(prevResolvedRows, prevStart, prevEnd);
    const currentAgeingRate = current.resolvedInPeriod ? round4(current.overdueTickets.length / current.resolvedInPeriod) : null;
    const previousAgeingRate = previous.resolvedInPeriod ? round4(previous.overdueTickets.length / previous.resolvedInPeriod) : null;

    // ---- Breakdown tables (current open backlog)
    const byIssueType = buildBacklogBreakdown(tickets, (t) => t.issueType);
    const byPriority = buildBacklogBreakdown(tickets, (t) => t.priority);
    const byProduct = buildBacklogBreakdown(tickets, (t) => t.product);
    const byOwner = buildBacklogBreakdown(tickets, (t) => t.assignee, hasWorkCategorySplit && !effectiveWorkCategory);
    const byWorkCategory = hasWorkCategorySplit
      ? buildBacklogBreakdown(
          tickets.filter((t) => t.workCategory !== null),
          (t) => t.workCategory ?? ""
        )
      : [];

    const ageingRateByIssueType = buildAgeingRateBreakdown(current.ageingRateRows, (r) => r.issueType || null);
    const ageingRateByWorkCategory = hasWorkCategorySplit
      ? buildAgeingRateBreakdown(current.ageingRateRows, (r) => cycleTimeWorkCategoryFor(r.issueType))
      : [];

    const timeInStatus = buildTimeInStatus(tickets);

    // ---- Age distribution buckets
    const ageDistribution = BACKLOG_AGE_BUCKETS.map((b) => {
      const count = tickets.filter((t) => t.ageDays >= b.minDays && (b.maxDays === null || t.ageDays < b.maxDays)).length;
      return { ...b, count, share: tickets.length ? round4(count / tickets.length) : null };
    });

    // ---- Aging risk summary + What Needs My Attention + Stale
    const agingRiskSummary = {
      critical: tickets.filter((t) => t.riskTier === "critical").length,
      atRisk: tickets.filter((t) => t.riskTier === "atRisk").length,
      watch: tickets.filter((t) => t.riskTier === "watch").length,
      healthy: tickets.filter((t) => t.riskTier === "healthy").length,
    };
    const staleTicketsAll = tickets.filter((t) => t.stale).sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
    const criticalAging = tickets.filter((t) => t.riskTier === "critical").slice(0, 10);
    const dueDateRisk = tickets
      .filter((t) => t.dueDate && (t.riskTier === "atRisk" || t.riskTier === "critical"))
      .sort((a, b) => (b.consumedFraction ?? 0) - (a.consumedFraction ?? 0))
      .slice(0, 10);
    const stalled = staleTicketsAll.slice(0, 10);

    const concentrationCandidate = [...(hasWorkCategorySplit ? byWorkCategory : []), ...byIssueType, ...timeInStatus.map((s) => ({ key: s.status, count: s.openCount, pctOfBacklog: tickets.length ? s.openCount / tickets.length : null }))]
      .filter((c) => c.pctOfBacklog !== null && c.pctOfBacklog >= 0.4)
      .sort((a, b) => (b.pctOfBacklog ?? 0) - (a.pctOfBacklog ?? 0))[0];
    const concentration = concentrationCandidate
      ? {
          text: {
            professional: `"${concentrationCandidate.key}" accounts for ${Math.round((concentrationCandidate.pctOfBacklog ?? 0) * 100)}% of current backlog.`,
            gaby: `**Concentration detected.** "${concentrationCandidate.key}" is **${Math.round((concentrationCandidate.pctOfBacklog ?? 0) * 100)}%** of the current Mission Queue.`,
          },
        }
      : null;

    const insights = buildBacklogInsights({
      backlogDelta: { current: endingAsOf.count, previous: prevEndingAsOf.count },
      currentAge: currentStatsRaw,
      staleCount: staleTicketsAll.length,
      backlogCount: tickets.length,
      byStatus: timeInStatus,
      ageingRate: { current: currentAgeingRate, previous: previousAgeingRate },
      byWorkCategory,
      byOwner,
      ownerLabel: singleTeam ? backlogAgingAssigneeLabel(singleTeam) : "Owner",
    });

    return {
      team, range, period, issueType: issueType ?? null, workCategory: effectiveWorkCategory ?? null, hasWorkCategorySplit,
      assigneeLabel: singleTeam ? backlogAgingAssigneeLabel(singleTeam) : "Assigned Owner",

      summary: {
        openingBacklog: openingAsOf.count,
        incoming: currentAgg.incoming,
        completed: currentAgg.completed,
        endingBacklog: endingAsOf.count,
        netChange: currentAgg.incoming - currentAgg.completed,
        backlogDelta: {
          current: endingAsOf.count,
          previous: prevEndingAsOf.count,
          deltaPct: prevEndingAsOf.count ? round4((endingAsOf.count - prevEndingAsOf.count) / prevEndingAsOf.count) : null,
        },
      },

      currentAge: {
        ...currentStatsRaw,
        oldestTicketKey,
        comparison: {
          medianAgeDays: { current: currentStatsRaw.medianAgeDays, previous: prevEndAgeStats.medianAgeDays },
          p90AgeDays: { current: currentStatsRaw.p90AgeDays, previous: prevEndAgeStats.p90AgeDays },
          oldestAgeDays: { current: currentStatsRaw.oldestAgeDays, previous: prevEndAgeStats.oldestAgeDays },
        },
      },

      resolutionTimeliness: {
        ageingRate: currentAgeingRate,
        resolved: current.resolvedInPeriod,
        beyondDue: current.overdueTickets.length,
        comparison: {
          current: currentAgeingRate,
          previous: previousAgeingRate,
          deltaPts: currentAgeingRate !== null && previousAgeingRate !== null ? Math.round((currentAgeingRate - previousAgeingRate) * 1000) / 10 : null,
        },
      },

      health: buildBacklogHealth({
        backlogDelta: { current: endingAsOf.count, previous: prevEndingAsOf.count },
        p90AgeDays: { current: currentStatsRaw.p90AgeDays, previous: prevEndAgeStats.p90AgeDays },
        agingRiskShare: tickets.length ? (agingRiskSummary.critical + agingRiskSummary.atRisk) / tickets.length : null,
        staleShare: tickets.length ? staleTicketsAll.length / tickets.length : null,
      }),

      trend,
      ageingRateTrend,
      ageDistribution,
      agingRiskSummary,

      byWorkCategory,
      byIssueType,
      byPriority,
      byProduct,
      byOwner,

      ageingRateByWorkCategory,
      ageingRateByIssueType,

      timeInStatus,

      oldestTickets: tickets.slice(0, 20),
      attention: { criticalAging, dueDateRisk, stalled, concentration },
      staleTickets: staleTicketsAll.slice(0, 20),
      staleTotalCount: staleTicketsAll.length,

      insights,

      tickets: tickets.slice(0, BREAKDOWN_TICKET_LIMIT),
      ticketsTotalCount: tickets.length,

      overdueTickets: current.overdueTickets,
    };
  } catch {
    return emptyDeepDive(team, range, period, issueType, workCategory);
  }
}
