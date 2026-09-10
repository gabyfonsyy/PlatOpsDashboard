/**
 * Capacity & Health — data + calculation layer.
 *
 * Every number here traces to a real query (roster, leave, metrics_by_assignee_monthly, tickets,
 * projects) except where a value is explicitly an assumption from lib/capacity-config.ts, in
 * which case the copy layer (capacity-view.ts) must say so. See the build's plan for the full
 * data-availability audit: 8 of the brief's 13 requested dimensions (on-call duty, per-person
 * project assignment/deadline/phase/effort, specialized skills, rework, ticket complexity,
 * unplanned-work flags, meeting/admin overhead) do not exist anywhere in this app and are
 * deliberately NOT modeled here — components must render "Insufficient data" for them, not a
 * fabricated number.
 *
 * ── The model ───────────────────────────────────────────────────────────────────────────────
 * Available Capacity (days) = working days in period − Approved leave days − an operational-
 *   overhead assumption (capacity-config.ts; no meeting data exists to measure this).
 * Demand Load (days) is calibrated from ticket VOLUME against the team's own recent throughput,
 *   not from cycle time. An earlier version of this model multiplied ticketsResolved ×
 *   avgCycleTimeMinutes, treating cycle time as "hands-on effort per ticket" — but cycle time is
 *   ELAPSED wall-clock time a ticket sits in progress, and people work multiple tickets
 *   concurrently, so summing it produced days figures many times larger than the team's actual
 *   available time (a >150% "demand" that wasn't real). Instead: getBaselineTicketsPerAvailableDay
 *   computes how many tickets this team has typically resolved per available day over the trailing
 *   3 months, and demandDaysForTickets converts the CURRENT period's ticket count into days at that
 *   same real, team-specific pace — "how many days would this period's volume have taken at this
 *   team's own recent normal rate." avgCycleTimeMinutes is still carried on PersonCapacity for
 *   display (it's a genuinely useful number), just no longer used to derive Demand Days.
 * Demand Load, team level, adds one more term: activeProjectCount × an assumed team-days-per-
 *   project constant (capacity-config.ts) — clearly an assumption, kept OUT of any individual's
 *   own demandDays since there's no per-person project-assignment data to split it by.
 * Capacity Gap = Available − Demand, tiered via capacity-config.ts's tierForGapPct/bumpTier.
 */
import { getTeams, isExcludedIssueType, backlogAgingAssignee, type TeamConfig } from "@/lib/teams";
import { getRoster } from "@/lib/roster";
import { fetchGas } from "@/lib/gas-client";
import { getAssigneeMetrics, getTicketMetrics, type AssigneeMetric } from "@/lib/metrics";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { defaultPeriodForRange } from "@/lib/date-ranges";
import { toManilaDateString } from "@/lib/manila-date";
import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import type { RosterMember, LeaveRecord, ProjectRecord } from "@/lib/types";
import {
  CAPACITY_CONFIG,
  tierForGapPct,
  bumpTier,
  backlogRateTier,
  projectCountTier,
  type CapacityTier,
  type ThreeTier,
  type ConfidenceLevel,
} from "@/lib/capacity-config";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function tierSeverity(t: CapacityTier): number {
  return { healthy: 0, watch: 1, highLoad: 2, unsustainable: 3 }[t];
}

function rosterKey(m: RosterMember): string {
  return (m.jira_display_name_alias || m.employee_name).trim().toLowerCase();
}

function workingDaysInRange(startDate: string, endDate: string): number {
  let count = 0;
  const cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function availableDaysFor(workingDays: number, leaveDaysApproved: number): number {
  const raw = Math.max(0, workingDays - leaveDaysApproved);
  return round2(raw * (1 - CAPACITY_CONFIG.operationalOverheadPct));
}

function demandDaysForTickets(ticketsResolvedInPeriod: number, ticketsPerAvailableDay: number | null): number {
  if (!ticketsPerAvailableDay || !ticketsResolvedInPeriod) return 0;
  return round2(ticketsResolvedInPeriod / ticketsPerAvailableDay);
}

function monthLabel(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

/**
 * How many tickets this team has typically resolved per available capacity-day, over the 3
 * calendar months immediately before the current period — the real, team-specific conversion
 * rate demandDaysForTickets uses to turn a ticket count into a days figure. Returns null when
 * there's no usable baseline (e.g. zero available days in that window), in which case ticket-
 * volume demand falls back to 0 rather than a divide-by-zero or an invented rate.
 */
async function getBaselineTicketsPerAvailableDay(teamKey: string, currentStartDate: string, headcount: number): Promise<number | null> {
  if (headcount <= 0) return null;
  const anchor = new Date(`${currentStartDate}T00:00:00Z`);
  const months: string[] = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1));
    months.push(monthLabel(d.getUTCFullYear(), d.getUTCMonth()));
  }

  let totalTickets = 0;
  let totalAvailableDays = 0;
  for (const m of months) {
    const { startDate, endDate } = resolvePeriodToDateRange("month", m);
    const [assigneeResult, leaveByEmployee] = await Promise.all([
      getAssigneeMetrics(teamKey, "month", m),
      fetchLeaveDaysByEmployee(teamKey, startDate, endDate),
    ]);
    totalTickets += assigneeResult.assignees.reduce((s, a) => s + a.ticketsResolvedInPeriod, 0);
    const workingDays = workingDaysInRange(startDate, endDate);
    const totalLeave = Array.from(leaveByEmployee.values()).reduce((s, d) => s + d, 0);
    const rawAvailable = Math.max(0, workingDays * headcount - totalLeave);
    totalAvailableDays += rawAvailable * (1 - CAPACITY_CONFIG.operationalOverheadPct);
  }

  return totalAvailableDays > 0 ? totalTickets / totalAvailableDays : null;
}

type LeaveListResult = { records: LeaveRecord[] };

async function fetchLeaveDaysByEmployee(teamKey: string, startDate: string, endDate: string): Promise<Map<string, number>> {
  const result = await fetchGas<LeaveListResult>("leave", { team: teamKey, startDate, endDate }, { next: { revalidate: 300 } }).catch(
    () => ({ records: [] as LeaveRecord[] })
  );
  const map = new Map<string, number>();
  for (const r of result.records) {
    if (r.status !== "Approved") continue;
    const key = r.employee_name.trim().toLowerCase();
    map.set(key, (map.get(key) ?? 0) + (Number(r.num_days) || 0));
  }
  return map;
}

async function fetchActiveProjectCount(teamKey: string): Promise<number> {
  const records = await fetchGas<ProjectRecord[]>("projects", {}, { next: { revalidate: 300 } }).catch(() => [] as ProjectRecord[]);
  return records.filter((p) => {
    if (p.status === "Done") return false;
    const involved = new Set(
      [p.owning_team, ...String(p.teams_involved || "").split(",").map((s) => s.trim())].filter(Boolean)
    );
    return involved.has(teamKey);
  }).length;
}

export type PersonCapacity = {
  name: string;
  roleTitle: string;
  availableDays: number;
  demandDays: number;
  /** Available/Demand as a % of NOMINAL capacity (working days × 1 person, no leave/overhead
   * subtracted) — this is the "82%"/"91%" framing the brief's cards use, not Available-minus-
   * Demand-over-Available. */
  availablePct: number;
  demandPct: number;
  gapDays: number;
  gapPct: number | null;
  tier: CapacityTier;
  leaveDaysApproved: number;
  ticketsAssigned: number;
  ticketsResolvedInPeriod: number;
  slaOverdueRate: number | null;
  escalationRate: number | null;
  avgCycleTimeMinutes: number | null;
  /** No AssigneeMetric row at all this period — the roster member had zero resolved-ticket
   * activity, so demandDays is 0 by absence of data, not by measurement of a quiet period. */
  hasWorkloadData: boolean;
};

export type TeamCapacity = {
  teamKey: string;
  teamName: string;
  headcount: number;
  availableDays: number;
  demandDays: number;
  availablePct: number;
  demandPct: number;
  gapDays: number;
  gapPct: number | null;
  tier: CapacityTier;
  backlogAgingRate: number | null;
  backlogTier: ThreeTier;
  escalationRate: number | null;
  hasFcrEscalation: boolean;
  activeProjectCount: number;
  projectLoadTier: ThreeTier;
  /** Plain-language drivers behind this team's demand, for the interpretation narrative. */
  drivers: string[];
  people: PersonCapacity[];
  /** Working days in the period × headcount — the org rollup's nominal-capacity denominator. */
  nominalDays: number;
};

export type CapacityOverview = {
  range: string;
  period: string;
  startDate: string;
  endDate: string;
  headcount: number;
  availableDays: number;
  demandDays: number;
  availablePct: number;
  demandPct: number;
  gapDays: number;
  gapPct: number | null;
  tier: CapacityTier;
  nominalDays: number;
  avgAvailableDaysPerHeadcount: number;
  avgNominalDaysPerHeadcount: number;
  activeProjectCount: number;
  projectCapacityTier: ThreeTier;
  teams: TeamCapacity[];
};

function computePerson(
  member: RosterMember,
  metric: AssigneeMetric | undefined,
  leaveDaysApproved: number,
  workingDays: number,
  team: TeamConfig,
  ticketsPerAvailableDay: number | null
): PersonCapacity {
  const availableDays = availableDaysFor(workingDays, leaveDaysApproved);
  const ticketsResolvedInPeriod = metric?.ticketsResolvedInPeriod ?? 0;
  const avgCycleTimeMinutes = metric?.avgCycleTimeMinutes ?? null;
  const demandDays = demandDaysForTickets(ticketsResolvedInPeriod, ticketsPerAvailableDay);
  const gapDays = round2(availableDays - demandDays);
  const availablePct = workingDays > 0 ? round4(availableDays / workingDays) : 0;
  const demandPct = workingDays > 0 ? round4(demandDays / workingDays) : 0;
  const gapPct = workingDays > 0 ? round4(availablePct - demandPct) : null;
  const elevated =
    (metric?.backlogAgingRate ?? 0) >= CAPACITY_CONFIG.elevated.backlogAgingRate ||
    (team.has_fcr_escalation && (metric?.escalationRate ?? 0) >= CAPACITY_CONFIG.elevated.escalationRate);

  return {
    name: member.employee_name,
    roleTitle: member.role_title,
    availableDays,
    demandDays,
    availablePct,
    demandPct,
    gapDays,
    gapPct,
    tier: bumpTier(tierForGapPct(gapPct), elevated),
    leaveDaysApproved: round2(leaveDaysApproved),
    ticketsAssigned: metric?.ticketsAssigned ?? 0,
    ticketsResolvedInPeriod,
    slaOverdueRate: metric?.backlogAgingRate ?? null,
    escalationRate: team.has_fcr_escalation ? (metric?.escalationRate ?? null) : null,
    avgCycleTimeMinutes,
    hasWorkloadData: Boolean(metric),
  };
}

function driversFor(team: TeamConfig, personDemandDays: number, teamMetrics: { backlogAgingRate: number | null; escalationRate: number | null }, activeProjectCount: number): string[] {
  const drivers: string[] = [];
  if (personDemandDays > 0) drivers.push("ticket volume and resolution effort");
  if (team.has_fcr_escalation && (teamMetrics.escalationRate ?? 0) >= CAPACITY_CONFIG.elevated.escalationRate) {
    drivers.push("escalation-sensitive work");
  }
  if ((teamMetrics.backlogAgingRate ?? 0) >= CAPACITY_CONFIG.elevated.backlogAgingRate) {
    drivers.push("an aging backlog");
  }
  if (activeProjectCount > 0) {
    drivers.push(`${activeProjectCount} concurrent project${activeProjectCount === 1 ? "" : "s"}`);
  }
  return drivers;
}

export async function getTeamCapacityDetail(teamKey: string, range: string, period: string): Promise<TeamCapacity | null> {
  const teams = await getTeams();
  const team = teams.find((t) => t.team_key === teamKey);
  if (!team) return null;

  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const workingDays = workingDaysInRange(startDate, endDate);

  const roster = await getRoster().catch(() => [] as RosterMember[]);
  const teamRoster = roster.filter((m) => m.team_key === teamKey);

  const [leaveByEmployee, assigneeResult, teamMetrics, activeProjectCount, ticketsPerAvailableDay] = await Promise.all([
    fetchLeaveDaysByEmployee(teamKey, startDate, endDate),
    getAssigneeMetrics(teamKey, range, period),
    getTicketMetrics(teamKey, range, period),
    fetchActiveProjectCount(teamKey),
    getBaselineTicketsPerAvailableDay(teamKey, startDate, teamRoster.length).catch(() => null as number | null),
  ]);

  const metricByKey = new Map(assigneeResult.assignees.map((a) => [a.name.trim().toLowerCase(), a]));

  const people: PersonCapacity[] = teamRoster.map((m) => {
    const metric = metricByKey.get(rosterKey(m));
    const leaveDays = leaveByEmployee.get(m.employee_name.trim().toLowerCase()) ?? 0;
    return computePerson(m, metric, leaveDays, workingDays, team, ticketsPerAvailableDay);
  });

  const availableDays = round2(people.reduce((s, p) => s + p.availableDays, 0));
  const personDemandDays = people.reduce((s, p) => s + p.demandDays, 0);
  const projectDemandDays = activeProjectCount * CAPACITY_CONFIG.assumedTeamDaysPerActiveProjectPerMonth;
  const demandDays = round2(personDemandDays + projectDemandDays);
  const gapDays = round2(availableDays - demandDays);
  const nominalDays = workingDays * teamRoster.length;
  const availablePct = nominalDays > 0 ? round4(availableDays / nominalDays) : 0;
  const demandPct = nominalDays > 0 ? round4(demandDays / nominalDays) : 0;
  const gapPct = nominalDays > 0 ? round4(availablePct - demandPct) : null;

  const elevated =
    (teamMetrics.backlogAgingRate ?? 0) >= CAPACITY_CONFIG.elevated.backlogAgingRate ||
    (team.has_fcr_escalation && (teamMetrics.escalationRate ?? 0) >= CAPACITY_CONFIG.elevated.escalationRate);

  return {
    teamKey: team.team_key,
    teamName: team.team_name,
    headcount: teamRoster.length,
    availableDays,
    demandDays,
    availablePct,
    demandPct,
    gapDays,
    gapPct,
    tier: bumpTier(tierForGapPct(gapPct), elevated),
    backlogAgingRate: teamMetrics.backlogAgingRate,
    backlogTier: backlogRateTier(teamMetrics.backlogAgingRate),
    escalationRate: team.has_fcr_escalation ? teamMetrics.escalationRate : null,
    hasFcrEscalation: team.has_fcr_escalation,
    activeProjectCount,
    projectLoadTier: projectCountTier(activeProjectCount),
    drivers: driversFor(team, personDemandDays, teamMetrics, activeProjectCount),
    people: people.sort((a, b) => b.demandDays - a.demandDays),
    nominalDays,
  };
}

function projectCapacityFromGapTier(tier: CapacityTier): ThreeTier {
  if (tier === "healthy") return "high";
  if (tier === "watch") return "medium";
  return "low";
}

export async function getCapacityOverview(range: string, period: string): Promise<CapacityOverview> {
  const teams = await getTeams();
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const results = await Promise.all(teams.map((t) => getTeamCapacityDetail(t.team_key, range, period)));
  const teamCapacities = results.filter((t): t is TeamCapacity => t !== null);

  const headcount = teamCapacities.reduce((s, t) => s + t.headcount, 0);
  const availableDays = round2(teamCapacities.reduce((s, t) => s + t.availableDays, 0));
  const demandDays = round2(teamCapacities.reduce((s, t) => s + t.demandDays, 0));
  const gapDays = round2(availableDays - demandDays);
  const nominalDays = teamCapacities.reduce((s, t) => s + t.nominalDays, 0);
  const availablePct = nominalDays > 0 ? round4(availableDays / nominalDays) : 0;
  const demandPct = nominalDays > 0 ? round4(demandDays / nominalDays) : 0;
  const gapPct = nominalDays > 0 ? round4(availablePct - demandPct) : null;
  const activeProjectCount = teamCapacities.reduce((s, t) => s + t.activeProjectCount, 0);

  const baseTier = tierForGapPct(gapPct);
  const worstTeamTier = teamCapacities.reduce<CapacityTier>((worst, t) => (tierSeverity(t.tier) > tierSeverity(worst) ? t.tier : worst), "healthy");
  const tier = tierSeverity(worstTeamTier) > tierSeverity(baseTier) ? worstTeamTier : baseTier;

  return {
    range,
    period,
    startDate,
    endDate,
    headcount,
    availableDays,
    demandDays,
    availablePct,
    demandPct,
    gapDays,
    gapPct,
    tier,
    nominalDays,
    avgAvailableDaysPerHeadcount: headcount > 0 ? round2(availableDays / headcount) : 0,
    avgNominalDaysPerHeadcount: headcount > 0 ? round2(nominalDays / headcount) : 0,
    activeProjectCount,
    projectCapacityTier: projectCapacityFromGapTier(tier),
    teams: teamCapacities,
  };
}

// =====================================================================================
// Knowledge & Ownership Risk — a product-concentration PROXY (no stored ownership record
// exists anywhere in this app). Always labelled Medium/Low confidence wherever it's shown.
// =====================================================================================

export type OwnershipRiskFlag = {
  product: string;
  topAssignee: string;
  topAssigneeShare: number;
  sampleSize: number;
  confidence: ConfidenceLevel;
};

type OwnershipTicketRow = {
  issue_key: string;
  issue_type: string | null;
  product: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
  resolved_datetime: string;
};

async function fetchResolvedForOwnership(teamKey: string, sinceIso: string): Promise<OwnershipTicketRow[]> {
  return fetchAllRowsParallel<OwnershipTicketRow>(
    (head) =>
      getSupabaseClient()
        .from("tickets")
        .select("issue_key,issue_type,product,assigned_se,assigned_cod,resolved_datetime", head ? { count: "exact", head: true } : undefined)
        .eq("team_key", teamKey)
        .not("resolved_datetime", "is", null)
        .gte("resolved_datetime", sinceIso),
    "issue_key"
  );
}

/** 180-day lookback, independent of the page's period filter — ownership concentration is a
 * structural question, not a this-week-vs-last-week one. */
export async function getOwnershipRisk(teamKey: string): Promise<OwnershipRiskFlag[]> {
  const teams = await getTeams();
  const team = teams.find((t) => t.team_key === teamKey);
  if (!team) return [];

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 180);
  const rows = await fetchResolvedForOwnership(teamKey, since.toISOString()).catch(() => [] as OwnershipTicketRow[]);

  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (isExcludedIssueType(teamKey, r.issue_type)) continue;
    const product = String(r.product || "").trim();
    if (!product) continue;
    const assignee = String(backlogAgingAssignee(team, r) || "").trim();
    if (!assignee) continue;
    if (!byProduct.has(product)) byProduct.set(product, new Map());
    const m = byProduct.get(product) as Map<string, number>;
    m.set(assignee, (m.get(assignee) ?? 0) + 1);
  }

  const flags: OwnershipRiskFlag[] = [];
  for (const [product, counts] of Array.from(byProduct)) {
    const total = Array.from(counts.values()).reduce((s, c) => s + c, 0);
    if (total < CAPACITY_CONFIG.ownershipMinSampleSize) continue;
    const [topAssignee, topCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    const share = topCount / total;
    if (share < CAPACITY_CONFIG.ownershipConcentrationThreshold) continue;
    flags.push({
      product,
      topAssignee,
      topAssigneeShare: round4(share),
      sampleSize: total,
      confidence: total >= CAPACITY_CONFIG.ownershipMinSampleSize * 3 ? "medium" : "low",
    });
  }
  return flags.sort((a, b) => b.topAssigneeShare - a.topAssigneeShare);
}

// =====================================================================================
// 12-week Demand vs Capacity trend — org-wide. Deliberately simpler than the snapshot model:
// avg cycle time and headcount are held constant at TODAY's values across all 12 weeks (this app
// computes neither per-week, historically, anywhere else), leave days are assigned to the week
// containing a record's start_date rather than prorated across a multi-day span, and the
// assumption-based project-days term is left OUT entirely — this trend reflects only real
// per-week ticket-resolution and leave counts. Each simplification is surfaced in the UI copy.
// =====================================================================================

export type CapacityTrendPoint = {
  weekEnding: string;
  availableDays: number;
  demandDays: number;
  gapPct: number | null;
  tier: CapacityTier;
};

export type CapacityTrend = {
  points: CapacityTrendPoint[];
  consecutiveWeeksOverThreshold: number;
};

function toIsoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toIsoDateUtc(d);
}

type WeekBucket = { start: string; end: string };

function lastNWeeks(n: number): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  let end = toIsoDateUtc(new Date());
  for (let i = 0; i < n; i++) {
    const start = addDaysIso(end, -6);
    buckets.unshift({ start, end });
    end = addDaysIso(start, -1);
  }
  return buckets;
}

type TrendResolvedRow = { team_key: string; issue_type: string | null; resolved_datetime: string };

async function fetchResolvedInWindow(teamKeys: string[], startDate: string, endDate: string): Promise<TrendResolvedRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  return fetchAllRowsParallel<TrendResolvedRow & { issue_key: string }>(
    (head) =>
      getSupabaseClient()
        .from("tickets")
        .select("issue_key,team_key,issue_type,resolved_datetime", head ? { count: "exact", head: true } : undefined)
        .in("team_key", teamKeys)
        .not("resolved_datetime", "is", null)
        .gte("resolved_datetime", rangeStartUtc.toISOString())
        .lte("resolved_datetime", rangeEndUtc.toISOString()),
    "issue_key"
  );
}

export async function getCapacityTrend(): Promise<CapacityTrend> {
  const teams = await getTeams();
  const buckets = lastNWeeks(CAPACITY_CONFIG.trendWeeks);
  const windowStart = buckets[0].start;
  const windowEnd = buckets[buckets.length - 1].end;
  const teamKeys = teams.map((t) => t.team_key);
  const currentPeriod = defaultPeriodForRange("month");

  const [resolvedRows, leaveResult, roster, assigneeResults] = await Promise.all([
    fetchResolvedInWindow(teamKeys, windowStart, windowEnd),
    fetchGas<LeaveListResult>("leave", { startDate: windowStart, endDate: windowEnd }, { next: { revalidate: 300 } }).catch(
      () => ({ records: [] as LeaveRecord[] })
    ),
    getRoster().catch(() => [] as RosterMember[]),
    Promise.all(teams.map((t) => getAssigneeMetrics(t.team_key, "month", currentPeriod))),
  ]);

  const avgCycleByTeam = new Map<string, number>();
  teams.forEach((t, i) => {
    const assignees = assigneeResults[i].assignees;
    let sum = 0;
    let weight = 0;
    for (const a of assignees) {
      if (a.avgCycleTimeMinutes && a.ticketsResolvedInPeriod) {
        sum += a.avgCycleTimeMinutes * a.ticketsResolvedInPeriod;
        weight += a.ticketsResolvedInPeriod;
      }
    }
    avgCycleByTeam.set(t.team_key, weight ? sum / weight : 0);
  });

  const headcountByTeam = new Map<string, number>();
  teams.forEach((t) => headcountByTeam.set(t.team_key, roster.filter((m) => m.team_key === t.team_key).length));

  const resolvedCountByTeamWeek = new Map<string, number[]>();
  teams.forEach((t) => resolvedCountByTeamWeek.set(t.team_key, new Array(buckets.length).fill(0)));
  for (const row of resolvedRows) {
    if (isExcludedIssueType(row.team_key, row.issue_type)) continue;
    const d = toManilaDateString(row.resolved_datetime);
    if (!d) continue;
    const idx = buckets.findIndex((b) => d >= b.start && d <= b.end);
    if (idx === -1) continue;
    const arr = resolvedCountByTeamWeek.get(row.team_key);
    if (arr) arr[idx]++;
  }

  const leaveDaysByTeamWeek = new Map<string, number[]>();
  teams.forEach((t) => leaveDaysByTeamWeek.set(t.team_key, new Array(buckets.length).fill(0)));
  for (const r of leaveResult.records) {
    if (r.status !== "Approved") continue;
    if (!leaveDaysByTeamWeek.has(r.team_key)) continue;
    const idx = buckets.findIndex((b) => r.start_date >= b.start && r.start_date <= b.end);
    if (idx === -1) continue;
    const arr = leaveDaysByTeamWeek.get(r.team_key);
    if (arr) arr[idx] += Number(r.num_days) || 0;
  }

  const points: CapacityTrendPoint[] = buckets.map((b, idx) => {
    let availableDays = 0;
    let demandDays = 0;
    for (const t of teams) {
      const headcount = headcountByTeam.get(t.team_key) ?? 0;
      const leaveDays = leaveDaysByTeamWeek.get(t.team_key)?.[idx] ?? 0;
      const rawAvailable = Math.max(0, headcount * CAPACITY_CONFIG.workingDaysPerWeek - leaveDays);
      availableDays += rawAvailable * (1 - CAPACITY_CONFIG.operationalOverheadPct);
      const resolvedCount = resolvedCountByTeamWeek.get(t.team_key)?.[idx] ?? 0;
      const avgCycle = avgCycleByTeam.get(t.team_key) ?? 0;
      demandDays += (resolvedCount * avgCycle) / CAPACITY_CONFIG.minutesPerWorkday;
    }
    availableDays = round2(availableDays);
    demandDays = round2(demandDays);
    const gapDays = round2(availableDays - demandDays);
    const gapPct = availableDays > 0 ? round4(gapDays / availableDays) : null;
    return { weekEnding: b.end, availableDays, demandDays, gapPct, tier: tierForGapPct(gapPct) };
  });

  let consecutiveWeeksOverThreshold = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].tier === "highLoad" || points[i].tier === "unsustainable") consecutiveWeeksOverThreshold++;
    else break;
  }

  return { points, consecutiveWeeksOverThreshold };
}
