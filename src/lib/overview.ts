import { getMyWork, manilaToday } from "@/lib/work-store";
import { getTeams } from "@/lib/teams";
import { getTicketMetrics, getInsight, type CachedInsight, type TicketMetrics } from "@/lib/metrics";
import { fetchGas } from "@/lib/gas-client";
import { isOpen, type MyWorkData, type WorkProject } from "@/lib/work";
import type { LeaveRecord, RtoRecord } from "@/lib/types";

/**
 * The Overview's AGGREGATION LAYER.
 *
 * This page owns no data of its own. Every number on it is read from a module that already
 * computes it, and every card links back to the module it came from — so the Overview can never
 * disagree with the page it links to, and fixing a metric means fixing it in one place.
 *
 * ── How to connect a new module ────────────────────────────────────────────────────────────────
 * Modules contribute through ONE shape, `OverviewContribution`. To wire up Projects, Incident Logs
 * or Ticket Monitoring later:
 *
 *   1. Add a `load` to its entry in MODULE_REGISTRY and flip `state` to "live".
 *   2. Return whatever of { attention, pulse, stable, operations } that module can answer for.
 *   3. Nothing else changes. The page renders whatever the registry yields, and a module that
 *      returns an empty contribution simply contributes nothing.
 *
 * A module that is still "planned" renders as an explicit, linked placeholder rather than being
 * hidden — a silently absent section reads as "nothing to worry about here", which is a claim this
 * page has no evidence for.
 *
 * ── The rule this page is built around ─────────────────────────────────────────────────────────
 * NOTHING here is invented. If a module has no data source yet, it says so. If a number cannot be
 * computed, it is absent rather than zero. "No incidents" and "incidents not connected yet" are
 * completely different statements to put in front of someone deciding what to worry about.
 */

// ---------------------------------------------------------------------------- modules

export type ModuleKey =
  | "my-work"
  | "team-stats"
  | "leave"
  | "rto"
  | "projects"
  | "incidents"
  | "ticket-monitoring";

export type ModuleState = "live" | "planned";

export type OverviewModule = {
  key: ModuleKey;
  label: string;
  href: string;
  state: ModuleState;
  /** Shown on the placeholder for a planned module — what it WILL contribute, stated as future. */
  plannedContribution?: string;
};

/**
 * Every module the Overview knows about, live or not. Order is the order they appear in the
 * Operations section.
 */
export const MODULE_REGISTRY: Record<ModuleKey, OverviewModule> = {
  "my-work": { key: "my-work", label: "My Work", href: "/my-work", state: "live" },
  "team-stats": { key: "team-stats", label: "Team Stats", href: "/teams", state: "live" },
  leave: { key: "leave", label: "Leave", href: "/leave", state: "live" },
  rto: { key: "rto", label: "RTO", href: "/rto", state: "live" },
  projects: {
    key: "projects",
    label: "Projects",
    href: "/projects",
    state: "planned",
    plannedContribution: "Project status, upcoming milestones and at-risk projects",
  },
  incidents: {
    key: "incidents",
    label: "Incident Logs",
    href: "/incident-logs",
    state: "planned",
    plannedContribution: "Open incidents and anything awaiting escalation",
  },
  "ticket-monitoring": {
    key: "ticket-monitoring",
    label: "Ticket Monitoring",
    href: "/monitoring",
    state: "planned",
    plannedContribution: "Tickets breaching pickup or review SLAs",
  },
};

// ---------------------------------------------------------------------------- contribution shapes

export type Priority = "high" | "medium" | "low";

/**
 * One thing that wants a decision. The fields are deliberately prescriptive: a title alone is a
 * metric, and this page is explicitly not a metrics list. `why` has to carry the evidence and
 * `action` has to name something doable, or the item does not belong here.
 */
export type AttentionItem = {
  id: string;
  priority: Priority;
  title: string;
  /** The evidence. Always the module's own numbers, never a characterisation of them. */
  why: string;
  /** What to actually do. A verb, not "review" or "monitor". */
  action: string;
  href: string;
  source: ModuleKey;
};

/** A compact figure for Team Pulse. `delta` is only ever set when a real prior period was read. */
export type PulseMetric = {
  id: string;
  label: string;
  value: string;
  sublabel?: string;
  delta?: { direction: "up" | "down" | "flat"; label: string; good: boolean | null };
  tone: "neutral" | "good" | "warn";
  href?: string;
  source: ModuleKey;
};

/** Something confirmed healthy. Only emitted when the underlying check actually ran. */
export type StableStatement = {
  id: string;
  text: string;
  source: ModuleKey;
};

/** A row in the Projects / Operations section. */
export type OperationsRow = {
  id: string;
  label: string;
  detail: string;
  href: string;
  source: ModuleKey;
};

export type OverviewContribution = {
  attention?: AttentionItem[];
  pulse?: PulseMetric[];
  stable?: StableStatement[];
  operations?: OperationsRow[];
};

// ---------------------------------------------------------------------------- the assembled page

export type MyDaySummary = {
  workdayOpen: boolean;
  startedAt: string | null;
  loggedMinutesToday: number;
  openTasks: number;
  doneToday: number;
  focusTasks: { id: string; title: string; done: boolean }[];
  overdueCount: number;
  /** Today's tasks that belong to a project, with the project's name resolved. */
  projectTasks: { id: string; title: string; project: string; done: boolean }[];
  daysNeedingReview: number;
};

export type TeamPulseSummary = {
  teams: {
    key: string;
    name: string;
    href: string;
    resolvedInPeriod: number;
    escalationRate: number | null;
    backlogAgingRate: number | null;
    /** Previous month's resolved count, for the only delta we can honestly compute here. */
    previousResolved: number | null;
    insight: CachedInsight;
  }[];
  onLeaveToday: { name: string; team: string; type: string; halfDay: string }[];
  inOfficeToday: { name: string; team: string }[];
  /** Null when the module could not be read at all — distinct from an empty list. */
  leaveAvailable: boolean;
  rtoAvailable: boolean;
};

export type OverviewData = {
  today: string;
  myDay: MyDaySummary;
  pulse: TeamPulseSummary;
  attention: AttentionItem[];
  metrics: PulseMetric[];
  stable: StableStatement[];
  operations: OperationsRow[];
  /** Modules with no data source yet — rendered as placeholders, never as zeros. */
  planned: OverviewModule[];
};

// ---------------------------------------------------------------------------- assembly

const MONTH = (offset = 0): string => {
  const [y, m] = manilaToday().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Reads every live module in parallel and folds them into one page.
 *
 * Every module read is individually `.catch()`ed to a neutral value. One module being down must
 * degrade its own card and nothing else — an Overview that fails entirely because Leave timed out
 * is worse than no Overview, because it is the page you check when something is already wrong.
 */
export async function getOverview(email: string): Promise<OverviewData> {
  const today = manilaToday();
  const thisMonth = MONTH(0);
  const lastMonth = MONTH(-1);

  // Leave and RTO are Apps Script calls, which are the slowest thing on this page by an order of
  // magnitude. They are cached for five minutes rather than fetched no-store: both answer "who is
  // out TODAY", a day-granularity fact that does not change between two page loads a minute apart.
  // Uncached, every Overview render AND every press of the header compass paid two fresh GAS round
  // trips, which is most of what made a glance expensive.
  const leavePromise = fetchGas<{ records: LeaveRecord[] }>(
    "leave",
    { startDate: today, endDate: today },
    { next: { revalidate: 300 } }
  )
    .then((r) => r.records ?? [])
    .catch(() => null);

  const rtoPromise = fetchGas<{ records: RtoRecord[] }>(
    "rto",
    { startDate: today, endDate: today },
    { next: { revalidate: 300 } }
  )
    .then((r) => r.records ?? [])
    .catch(() => null);

  const workPromise = getMyWork(email).catch(() => null);

  // The per-team reads only need `teams`, NOT leave or RTO. Awaiting one combined Promise.all first
  // meant they sat behind the two slow GAS calls for no reason; chaining off getTeams lets both
  // halves run at once.
  const perTeamPromise = getTeams()
    .catch(() => [] as Awaited<ReturnType<typeof getTeams>>)
    .then((teams) =>
      Promise.all(
        teams.map(async (t) => {
          const [current, previous, insight] = await Promise.all([
            getTicketMetrics(t.team_key, "month", thisMonth).catch(() => null),
            getTicketMetrics(t.team_key, "month", lastMonth).catch(() => null),
            getInsight(`TEAM:${t.team_key}`).catch(() => null),
          ]);
          return { team: t, current, previous, insight };
        })
      )
    );

  const [work, leave, rto, perTeam] = await Promise.all([
    workPromise,
    leavePromise,
    rtoPromise,
    perTeamPromise,
  ]);

  const myDay = summariseMyDay(work);
  const pulse = summarisePulse(perTeam, leave, rto, today);

  const contributions: OverviewContribution[] = [
    myWorkContribution(work, myDay),
    teamStatsContribution(perTeam),
    coverageContribution(pulse),
  ];

  const attention = contributions
    .flatMap((c) => c.attention ?? [])
    .sort((a, b) => rank(a.priority) - rank(b.priority));

  return {
    today,
    myDay,
    pulse,
    attention,
    metrics: contributions.flatMap((c) => c.pulse ?? []),
    stable: contributions.flatMap((c) => c.stable ?? []),
    operations: contributions.flatMap((c) => c.operations ?? []),
    planned: Object.values(MODULE_REGISTRY).filter((m) => m.state === "planned"),
  };
}

const rank = (p: Priority) => (p === "high" ? 0 : p === "medium" ? 1 : 2);

// ---------------------------------------------------------------------------- My Work

function summariseMyDay(work: MyWorkData | null): MyDaySummary {
  if (!work) {
    return {
      workdayOpen: false, startedAt: null, loggedMinutesToday: 0, openTasks: 0, doneToday: 0,
      focusTasks: [], overdueCount: 0, projectTasks: [], daysNeedingReview: 0,
    };
  }

  const projectName = (id: string | null) =>
    id ? (work.projects.find((p: WorkProject) => p.project_id === id)?.name ?? null) : null;

  return {
    workdayOpen: Boolean(work.openSession),
    startedAt: work.openSession?.started_at ?? null,
    loggedMinutesToday: work.todaySessions
      .filter((s) => s.ended_at)
      .reduce(
        (sum, s) =>
          sum + (new Date(s.ended_at as string).getTime() - new Date(s.started_at).getTime()) / 60000,
        0
      ),
    openTasks: work.tasks.filter(isOpen).length,
    doneToday: work.tasks.filter((t) => t.status === "Done").length,
    focusTasks: work.tasks
      .filter((t) => t.lane === "Focus")
      .map((t) => ({ id: t.task_id, title: t.title, done: t.status === "Done" })),
    overdueCount: work.overdue.length,
    projectTasks: work.tasks
      .filter((t) => t.project_id)
      .map((t) => ({
        id: t.task_id,
        title: t.title,
        project: projectName(t.project_id) ?? "Unknown project",
        done: t.status === "Done",
      })),
    // Surfaced here because a broken workday log silently corrupts every duration statistic that
    // depends on it — and it is invisible unless you go looking on the My Work card.
    daysNeedingReview: work.recentDays.filter((d) => d.flags.length > 0).length,
  };
}

function myWorkContribution(work: MyWorkData | null, day: MyDaySummary): OverviewContribution {
  if (!work) return {};
  const attention: AttentionItem[] = [];
  const stable: StableStatement[] = [];

  if (day.overdueCount > 0) {
    attention.push({
      id: "overdue-tasks",
      priority: day.overdueCount >= 5 ? "high" : "medium",
      title: `${day.overdueCount} task${day.overdueCount === 1 ? "" : "s"} still open from earlier days`,
      why: "They were dated before today and never finished or deferred, so they are not on today's board.",
      action: "Pull them into today or push them to a real date",
      href: "/my-work",
      source: "my-work",
    });
  }

  if (day.daysNeedingReview > 0) {
    attention.push({
      id: "workday-log",
      priority: "medium",
      title: `${day.daysNeedingReview} workday${day.daysNeedingReview === 1 ? "" : "s"} need correcting`,
      why: "A session that was never ended, ran over 12 hours, or a weekday with nothing logged at all.",
      action: "Fix the times, or mark the day as Holiday / Leave",
      href: "/my-work",
      source: "my-work",
    });
  }

  const openFocus = day.focusTasks.filter((t) => !t.done).length;
  if (openFocus > 3) {
    attention.push({
      id: "focus-overloaded",
      priority: "low",
      title: `${openFocus} tasks claimed as Focus`,
      why: "Focus is meant to hold the one or two things that actually deserve today.",
      action: "Move the rest to To Do",
      href: "/my-work",
      source: "my-work",
    });
  }

  if (day.overdueCount === 0 && day.openTasks > 0) {
    stable.push({
      id: "nothing-overdue",
      text: "Nothing is overdue — today's board is the whole of your outstanding work.",
      source: "my-work",
    });
  }

  const operations: OperationsRow[] = work.projects
    .filter((p) => p.status === "Active")
    .map((p) => ({
      id: `project-${p.project_id}`,
      label: p.name,
      detail: p.currentFocus
        ? `${p.openTaskCount ?? 0} open · next: ${p.currentFocus}`
        : `${p.openTaskCount ?? 0} open`,
      href: "/my-work",
      source: "my-work" as ModuleKey,
    }));

  return { attention, stable, operations };
}

// ---------------------------------------------------------------------------- Team Stats

type TeamSlice = {
  team: Awaited<ReturnType<typeof getTeams>>[number];
  current: TicketMetrics | null;
  previous: TicketMetrics | null;
  insight: CachedInsight;
};

function teamStatsContribution(slices: TeamSlice[]): OverviewContribution {
  const attention: AttentionItem[] = [];
  const pulse: PulseMetric[] = [];
  const stable: StableStatement[] = [];

  const totalResolved = slices.reduce((n, s) => n + (s.current?.ticketsResolvedInPeriod ?? 0), 0);
  const previousResolved = slices.reduce((n, s) => n + (s.previous?.ticketsResolvedInPeriod ?? 0), 0);

  if (totalResolved > 0) {
    pulse.push({
      id: "resolved-mtd",
      label: "Resolved this month",
      value: String(totalResolved),
      sublabel: "across all teams",
      // Only compared when the previous month actually returned data — a missing month is not zero.
      delta:
        previousResolved > 0
          ? {
              direction:
                totalResolved === previousResolved ? "flat" : totalResolved > previousResolved ? "up" : "down",
              label: `${Math.abs(Math.round(((totalResolved - previousResolved) / previousResolved) * 100))}% vs last month`,
              good: null,
            }
          : undefined,
      tone: "neutral",
      href: "/teams",
      source: "team-stats",
    });
  }

  for (const s of slices) {
    const key = s.team.team_key;
    const label = teamShortName(s.team.team_name);
    const href = `/${key.toLowerCase()}`;

    // Recommendations already went through detectOpportunities_ in GAS, so each one is a
    // threshold a real number crossed. Promoting the top one avoids re-deriving that judgement
    // here and keeps the Overview agreeing with the team page it links to.
    const topRecommendation = s.insight?.recommendations?.[0];
    if (topRecommendation) {
      attention.push({
        id: `insight-${key}`,
        priority: "medium",
        title: `${label}: ${topRecommendation.title}`,
        why: topRecommendation.evidence,
        action: topRecommendation.action,
        href,
        source: "team-stats",
      });
    }

    for (const flag of s.insight?.flags ?? []) {
      if (flag.severity !== "warning") continue;
      attention.push({
        id: `flag-${key}-${flag.employee}-${flag.metric}`,
        priority: "medium",
        title: `${label}: ${flag.employee} flagged`,
        why: flag.detail,
        action: "Open the performance breakdown before your next 1:1",
        href: `${href}/performance`,
        source: "team-stats",
      });
    }

    if (s.current && (s.insight?.flags?.length ?? 0) === 0 && s.current.ticketsResolvedInPeriod > 0) {
      stable.push({
        id: `no-flags-${key}`,
        text: `${label}: nobody flagged for review this month.`,
        source: "team-stats",
      });
    }
  }

  return { attention, pulse, stable };
}

function teamShortName(name: string): string {
  const match = name.match(/\(([^)]+)\)/);
  return match ? match[1].trim() : name.trim();
}

// ---------------------------------------------------------------------------- Leave + RTO

function summarisePulse(
  slices: TeamSlice[],
  leave: LeaveRecord[] | null,
  rto: RtoRecord[] | null,
  today: string
): TeamPulseSummary {
  return {
    teams: slices.map((s) => ({
      key: s.team.team_key,
      name: teamShortName(s.team.team_name),
      href: `/${s.team.team_key.toLowerCase()}`,
      resolvedInPeriod: s.current?.ticketsResolvedInPeriod ?? 0,
      escalationRate: s.current?.escalationRate ?? null,
      backlogAgingRate: s.current?.backlogAgingRate ?? null,
      previousResolved: s.previous?.ticketsResolvedInPeriod ?? null,
      insight: s.insight,
    })),
    // A leave record spans a range, so "today" means today falls inside it — not that it starts today.
    onLeaveToday: (leave ?? [])
      .filter((r) => r.start_date <= today && r.end_date >= today && r.status !== "Cancelled")
      .map((r) => ({
        name: r.employee_name,
        team: r.team_key,
        type: r.leave_type,
        halfDay: r.half_day_period,
      })),
    inOfficeToday: (rto ?? [])
      .filter((r) => r.date === today)
      .map((r) => ({ name: r.employee_name, team: r.team_key })),
    leaveAvailable: leave !== null,
    rtoAvailable: rto !== null,
  };
}

/**
 * Coverage is the one place where Leave and RTO earn a spot on this page, and the honest framing
 * is "who is out", not "team capacity is N%". A percentage would need a headcount denominator this
 * page does not have, and inventing one is exactly the kind of confident-but-wrong number that
 * makes a command centre untrustworthy.
 */
function coverageContribution(pulse: TeamPulseSummary): OverviewContribution {
  const metrics: PulseMetric[] = [];
  const stable: StableStatement[] = [];

  if (pulse.leaveAvailable) {
    metrics.push({
      id: "leave-today",
      label: "On leave today",
      value: String(pulse.onLeaveToday.length),
      sublabel: pulse.onLeaveToday.length
        ? pulse.onLeaveToday.map((p) => p.name.split(" ")[0]).join(", ")
        : "full team available",
      tone: pulse.onLeaveToday.length >= 3 ? "warn" : "neutral",
      href: "/leave",
      source: "leave",
    });
    if (pulse.onLeaveToday.length === 0) {
      stable.push({
        id: "coverage",
        text: "Nobody is on leave today — coverage is whole.",
        source: "leave",
      });
    }
  }

  if (pulse.rtoAvailable) {
    metrics.push({
      id: "rto-today",
      label: "In office today",
      value: String(pulse.inOfficeToday.length),
      sublabel: pulse.inOfficeToday.length
        ? pulse.inOfficeToday.map((p) => p.name.split(" ")[0]).join(", ")
        : "nobody logged yet",
      tone: "neutral",
      href: "/rto",
      source: "rto",
    });
  }

  return { pulse: metrics, stable };
}
