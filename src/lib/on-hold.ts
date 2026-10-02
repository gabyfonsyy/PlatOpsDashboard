import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, excludedIssueTypes, isExcludedIssueType, backlogAgingAssignee, backlogAgingAssigneeLabel, type TeamConfig } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString } from "@/lib/manila-date";
import { basisFor } from "@/lib/lead-cycle-time";
import { BREAKDOWN_TICKET_LIMIT } from "@/lib/ticket-breakdowns";
import { defaultGrainFor, bucketKey, enumerateBuckets, classifyReviewCycle, type ReviewWaitGrain, type PeerReviewCycleRaw } from "@/lib/review-wait";
import { fetchResolved, segmentKey, FCR_SEGMENT_DIMENSIONS, type FcrSegmentDimension } from "@/lib/fcr";
import type { KpiBaselineRow } from "@/lib/kpi-baselines";
import type { Insight } from "@/components/dashboard/InsightsPanel";
import { holdText } from "@/lib/on-hold-view";
import { median } from "@/lib/stats";

/**
 * On-Hold Wait Time deep-dive (SE Team Stats item 5).
 *
 *   On-Hold Wait Time = time from entering On Hold to leaving it, per hold episode
 *
 * Each time a ticket goes On Hold is its own episode (on_hold_cycles_json, written by
 * extractHoldingCyclesWithReasons_ in gas/JiraSync.gs). An episode counts once it has ENDED in one
 * of ON_HOLD_EXIT_STATUSES. Holds still open are the Current On-Hold Queue and never enter the
 * averages. Calendar time, the same basis as SE Cycle Time.
 *
 * Population (Gaby, 2026-10-02): episodes on tickets RESOLVED in the period (Manila day), so
 * "% of resolved tickets that went On Hold" and the ticket counts reconcile with FCR, Escalation and
 * Ticket Volume. Each episode keeps its own Ticket Holding Reason. A blank one is "Not specified",
 * never inferred. "Ticket break" is an SE pausing their own work: it counts as waiting like every
 * other reason, tagged so it can be told apart from outside dependencies.
 *
 * Tickets synced before on_hold_cycles_json existed only carry total_on_hold_minutes. They count as
 * held, but their time can't be split into episodes, so they sit outside the episode statistics
 * (see `coverage`). If NO ticket in a period has episode data yet, the headline falls back to the
 * per-ticket totals and says so.
 */

export const ON_HOLD_EXIT_STATUSES = ["in progress", "for checking", "for peer review", "for product team", "archived", "rejected"] as const;
const TERMINAL_EXITS = ["archived", "rejected"];
export const NOT_SPECIFIED = "Not specified";
/** Holding reasons that are the SE pausing their own work rather than waiting on someone else. */
const SE_PAUSE_REASONS = ["ticket break"];
export const isSePause = (reason: string) => SE_PAUSE_REASONS.includes(reason.trim().toLowerCase());

const SMALL = 10;
const HEADLINE_SMALL_SAMPLE = 30;
const BASELINE_START = "2026-01-01";
const BASELINE_END = "2026-06-30";
export const ON_HOLD_BASELINE_LABEL = "2026-Q1+Q2";

// ------------------------------------------------------------------------------ Episode definition

export type HoldCycleRaw = {
  enteredAt?: string | null;
  exitedAt?: string | null;
  exitedToStatus?: string | null;
  reason?: string | null;
  assigneeAtEntry?: string | null;
};

export type HoldEpisodeKind = "completed" | "open" | "otherExit" | "invalid";

const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

export function classifyHoldEpisode(c: HoldCycleRaw): { kind: HoldEpisodeKind; minutes: number | null } {
  if (!c.enteredAt || !isFinite(new Date(c.enteredAt).getTime())) return { kind: "invalid", minutes: null };
  if (!c.exitedAt) return { kind: "open", minutes: null };
  const m = minutesBetween(c.enteredAt, c.exitedAt);
  if (!isFinite(m) || m < 0) return { kind: "invalid", minutes: null };
  const exit = (c.exitedToStatus || "").trim().toLowerCase();
  if (!(ON_HOLD_EXIT_STATUSES as readonly string[]).includes(exit)) return { kind: "otherExit", minutes: m };
  return { kind: "completed", minutes: m };
}

const reasonOf = (c: HoldCycleRaw) => (c.reason || "").trim() || NOT_SPECIFIED;

// ------------------------------------------------------------------------------ Types

export type HoldStats = {
  episodes: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p75Minutes: number | null;
  p90Minutes: number | null;
  totalMinutes: number;
  maxMinutes: number | null;
};

export type OnHoldSummary = {
  /** Tickets resolved in the period. */
  resolved: number;
  /** Resolved tickets that went On Hold at least once (episode data or legacy total). */
  heldTickets: number;
  heldShare: number | null;
  /** Completed-episode statistics — the headline. */
  wait: HoldStats;
  /** Total completed hold time per held ticket. */
  perTicketAvgMinutes: number | null;
  perTicketMedianMinutes: number | null;
  totalMinutes: number;
  avgEpisodesPerTicket: number | null;
  /** True when no ticket in the period has episode data: `wait` then describes per-ticket totals. */
  legacyMode: boolean;
};

export type OnHoldThreshold = {
  minutes: number | null;
  source: "override" | "baseline" | "live-baseline" | "none";
  baseline: { avgMinutes: number | null; p75Minutes: number | null; sampleCount: number; periodLabel: string; fromStore: boolean };
};

export type ReasonRow = {
  key: string;
  sePause: boolean;
  tickets: number;
  stats: HoldStats;
  shareOfHeldTickets: number;
  shareOfResolved: number;
  shareOfEpisodes: number;
  shareOfTime: number;
  previous: { episodes: number; avgMinutes: number | null } | null;
};

export type EpisodeView = {
  issueKey: string;
  issueType: string;
  product: string;
  priority: string;
  assignedSe: string;
  seAtEntry: string;
  reporter: string;
  reason: string;
  sePause: boolean;
  enteredAt: string;
  exitedAt: string | null;
  minutes: number | null;
  exitStatus: string;
  episodeIndex: number;
  episodeCount: number;
  ticketHoldMinutes: number;
  cycleMinutes: number | null;
  /** This ticket's hold time inside its Cycle Time window ÷ its Cycle Time. */
  cycleHoldShare: number | null;
  leadMinutes: number | null;
  status: string;
};

export type QueueTicket = {
  issueKey: string;
  issueType: string;
  product: string;
  assignedSe: string;
  reporter: string;
  priority: string;
  reason: string;
  sePause: boolean;
  enteredAt: string | null;
  ageMinutes: number | null;
  lastActivityAt: string | null;
  dueDate: string | null;
  sla: "overdue" | "dueSoon" | "onTrack" | "noDue";
  stale: boolean;
  episodes: number;
};

export type ExitRow = { key: string; terminal: boolean; episodes: number; share: number; avgMinutes: number | null; medianMinutes: number | null };

export type HoldSegmentRow = {
  key: string;
  resolved: number;
  held: number;
  holdRate: number | null;
  stats: HoldStats;
  topReason: string | null;
  previous: { resolved: number; held: number; avgMinutes: number | null } | null;
  /** Average episode minutes, current − previous. */
  deltaAvgMinutes: number | null;
  smallSample: boolean;
};

export type HoldTrendPoint = {
  bucket: string;
  resolved: number;
  held: number;
  heldShare: number | null;
  episodes: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  totalMinutes: number;
  byReason: Record<string, { episodes: number; totalMinutes: number; avgMinutes: number | null }>;
};

export type TimeSplit = { tickets: number; leadAvgMinutes: number | null; inProgress: number | null; onHold: number | null; review: number | null; other: number | null };

export type OnHoldReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  grain: ReviewWaitGrain;
  assigneeLabel: string;
  current: OnHoldSummary;
  previous: (OnHoldSummary & { period: string }) | null;
  smallSample: boolean;
  threshold: OnHoldThreshold;
  coverage: { heldTickets: number; withEpisodes: number; legacyTickets: number };
  efficiency: {
    resolutionRate: number | null;
    repeatHoldRate: number | null;
    repeatTickets: number;
    repeatTotalMinutes: number;
    maxEpisodes: number;
    longHoldRate: number | null;
    longHolds: number;
    currentStaleRate: number | null;
  };
  reasons: ReasonRow[];
  leaders: { byVolume: ReasonRow | null; byTime: ReasonRow | null; byAvg: ReasonRow | null; longest: EpisodeView | null };
  queue: { asOf: string; count: number; avgAgeMinutes: number | null; medianAgeMinutes: number | null; oldest: QueueTicket | null; overThreshold: number; overThresholdShare: number | null; unknownAge: number; tickets: QueueTicket[] };
  longest: EpisodeView[];
  exits: ExitRow[];
  matrix: { exits: string[]; rows: { reason: string; episodes: number; counts: Record<string, number> }[] };
  cycleImpact: {
    tickets: number;
    cycleAvgMinutes: number | null;
    holdInCycleAvgMinutes: number | null;
    shareOfCycle: number | null;
    leadTickets: number;
    leadAvgMinutes: number | null;
    holdAvgMinutes: number | null;
    shareOfLead: number | null;
  };
  timeSplit: { held: TimeSplit; notHeld: TimeSplit };
  segments: Record<FcrSegmentDimension, HoldSegmentRow[]>;
  trend: HoldTrendPoint[];
  trendReasons: string[];
  dataQuality: {
    legacyTickets: number;
    notSpecifiedEpisodes: number;
    otherExitCount: number;
    otherExits: EpisodeView[];
    invalidCount: number;
    invalid: { issueKey: string; detail: string }[];
    openOnResolvedCount: number;
    openOnResolved: EpisodeView[];
  };
  insights: Insight[];
  ticketFilter: { reason: string | null; exit: string | null; segment: { dim: FcrSegmentDimension; key: string } | null; longOnly: boolean };
  episodes: EpisodeView[];
  episodeTotal: number;
  allReasons: string[];
  allExits: string[];
};

// ------------------------------------------------------------------------------ Helpers

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const rateOf = (n: number, d: number) => (d ? round4(n / d) : null);
const avgOf = (a: number[]) => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null);
const medOf = (a: number[]) => {
  const m = median(a);
  return m === null ? null : round2(m);
};
function pctile(a: number[], q: number): number | null {
  if (a.length < SMALL) return null;
  const s = a.slice().sort((x, y) => x - y);
  const idx = (q / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return round2(s[lo] + (s[hi] - s[lo]) * (idx - lo));
}
function statsOf(minutes: number[]): HoldStats {
  return {
    episodes: minutes.length,
    avgMinutes: avgOf(minutes),
    medianMinutes: medOf(minutes),
    p75Minutes: pctile(minutes, 75),
    p90Minutes: pctile(minutes, 90),
    totalMinutes: round2(minutes.reduce((a, b) => a + b, 0)),
    maxMinutes: minutes.length ? round2(Math.max(...minutes)) : null,
  };
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

type Row = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  priority: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
  reporter_display_name: string | null;
  created: string;
  resolved_datetime: string;
  first_out_of_backlog_todo: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string | null;
  total_on_hold_minutes: number | string | null;
  total_in_progress_minutes: number | string | null;
  on_hold_cycles_json: HoldCycleRaw[] | null;
  peer_review_cycles_json?: PeerReviewCycleRaw[] | null;
  fcr_value?: string | null;
};

const FULL_SELECT =
  "issue_key,issue_type,status,priority,product,labels,assigned_se,assigned_cod,reporter_display_name,created," +
  "resolved_datetime,first_out_of_backlog_todo,cycle_time_start,cycle_time_end,total_on_hold_minutes," +
  "total_in_progress_minutes,on_hold_cycles_json,peer_review_cycles_json";
const PREV_SELECT =
  "issue_key,issue_type,status,priority,product,labels,assigned_se,assigned_cod,reporter_display_name,created," +
  "resolved_datetime,first_out_of_backlog_todo,cycle_time_start,cycle_time_end,total_on_hold_minutes," +
  "total_in_progress_minutes,on_hold_cycles_json";

/**
 * Whether supabase/add-on-hold-cycles.sql has run. Until it has, every select drops the column and
 * every ticket reads as legacy (no episode data), so the page and the baseline recompute keep
 * working instead of failing. Checked with a one-row GET (a HEAD count request carries no error
 * text to tell a missing column apart), and re-checked every few minutes once it's missing so the
 * page picks the column up without a restart.
 */
let holdColumnCheck: { ok: boolean; at: number } | null = null;
async function hasHoldCyclesColumn(): Promise<boolean> {
  if (holdColumnCheck && (holdColumnCheck.ok || Date.now() - holdColumnCheck.at < 5 * 60000)) return holdColumnCheck.ok;
  const { error } = await getSupabaseClient().from("tickets").select("on_hold_cycles_json").limit(1);
  if (error && !/on_hold_cycles_json/.test(error.message)) throw new Error(`Supabase query failed: ${error.message}`);
  holdColumnCheck = { ok: !error, at: Date.now() };
  return holdColumnCheck.ok;
}

const withoutHoldColumn = (columns: string) => columns.replace(",on_hold_cycles_json", "");

async function fetchHoldRows(teamKey: string, startDate: string, endDate: string, issueType: string | undefined, columns: string): Promise<Row[]> {
  if (await hasHoldCyclesColumn()) return fetchResolved<Row>(teamKey, startDate, endDate, issueType, columns);
  const rows = await fetchResolved<Row>(teamKey, startDate, endDate, issueType, withoutHoldColumn(columns));
  return rows.map((r) => ({ ...r, on_hold_cycles_json: null }));
}

type Ep = { row: Row; raw: HoldCycleRaw; index: number; count: number; kind: HoldEpisodeKind; minutes: number | null; reason: string; exitKey: string };

/** Per ticket: its episodes (if synced), and whether it was ever held. */
type TicketHold = { row: Row; hasEpisodeData: boolean; episodes: Ep[]; completed: Ep[]; held: boolean; holdMinutes: number };

function ticketHoldOf(row: Row): TicketHold {
  const cycles = Array.isArray(row.on_hold_cycles_json) ? row.on_hold_cycles_json : null;
  if (!cycles) {
    const legacy = Number(row.total_on_hold_minutes) || 0;
    return { row, hasEpisodeData: false, episodes: [], completed: [], held: legacy > 0, holdMinutes: round2(legacy) };
  }
  const episodes: Ep[] = cycles.map((raw, i) => {
    const k = classifyHoldEpisode(raw);
    return { row, raw, index: i + 1, count: cycles.length, kind: k.kind, minutes: k.minutes === null ? null : round2(k.minutes), reason: reasonOf(raw), exitKey: (raw.exitedToStatus || "").trim().toLowerCase() };
  });
  const completed = episodes.filter((e) => e.kind === "completed");
  return { row, hasEpisodeData: true, episodes, completed, held: episodes.length > 0, holdMinutes: round2(completed.reduce((n, e) => n + e.minutes!, 0)) };
}

function summarize(holds: TicketHold[]): OnHoldSummary {
  const held = holds.filter((h) => h.held);
  const withEpisodes = holds.some((h) => h.hasEpisodeData && h.episodes.length > 0);
  const legacyMode = held.length > 0 && !withEpisodes;
  const episodeMinutes = holds.flatMap((h) => h.completed.map((e) => e.minutes!));
  const perTicket = held.map((h) => h.holdMinutes).filter((m) => m > 0);
  const episodeTickets = held.filter((h) => h.hasEpisodeData);
  return {
    resolved: holds.length,
    heldTickets: held.length,
    heldShare: rateOf(held.length, holds.length),
    wait: legacyMode ? statsOf(perTicket) : statsOf(episodeMinutes),
    perTicketAvgMinutes: avgOf(perTicket),
    perTicketMedianMinutes: medOf(perTicket),
    totalMinutes: round2(held.reduce((n, h) => n + h.holdMinutes, 0)),
    avgEpisodesPerTicket: episodeTickets.length ? round2(episodeTickets.reduce((n, h) => n + h.episodes.length, 0) / episodeTickets.length) : null,
    legacyMode,
  };
}

function overlapMinutes(e: Ep, start: string | null, end: string | null): number {
  if (!start || !end || !e.raw.enteredAt || !e.raw.exitedAt) return 0;
  const s = Math.max(new Date(start).getTime(), new Date(e.raw.enteredAt).getTime());
  const t = Math.min(new Date(end).getTime(), new Date(e.raw.exitedAt).getTime());
  return t > s ? (t - s) / 60000 : 0;
}

/** Average completed episode + P75 over tickets resolved in Q1+Q2 2026 — the stored baseline and the default threshold. */
function baselineOf(holds: TicketHold[]): { avgMinutes: number | null; p75Minutes: number | null; sampleCount: number } {
  const m = holds.flatMap((h) => h.completed.map((e) => e.minutes!));
  return { avgMinutes: avgOf(m), p75Minutes: pctile(m, 75), sampleCount: m.length };
}

const BASELINE_SELECT = "issue_key,issue_type,resolved_datetime,total_on_hold_minutes,on_hold_cycles_json";

/** For lib/kpi-baselines.ts's recompute, so the stored rows and the live fallback are the same numbers. */
export async function computeOnHoldBaseline(teamKey: string): Promise<{ avgMinutes: number | null; p75Minutes: number | null; sampleCount: number }> {
  const rows = await fetchHoldRows(teamKey, BASELINE_START, BASELINE_END, undefined, BASELINE_SELECT);
  return baselineOf(rows.map(ticketHoldOf));
}

// ------------------------------------------------------------------------------ Current queue

const QUEUE_SELECT =
  "issue_key,issue_type,status,priority,product,assigned_se,assigned_cod,reporter_display_name,updated,due_date,on_hold_cycles_json";

type QueueRow = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  priority: string | null;
  product: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
  reporter_display_name: string | null;
  updated: string | null;
  due_date: string | null;
  on_hold_cycles_json: HoldCycleRaw[] | null;
};

async function fetchQueue(teamKey: string, issueType: string | undefined): Promise<QueueRow[]> {
  if (await hasHoldCyclesColumn()) return fetchQueueWith(teamKey, issueType, QUEUE_SELECT);
  const rows = await fetchQueueWith(teamKey, issueType, withoutHoldColumn(QUEUE_SELECT));
  return rows.map((r) => ({ ...r, on_hold_cycles_json: null }));
}

async function fetchQueueWith(teamKey: string, issueType: string | undefined, columns: string): Promise<QueueRow[]> {
  const excluded = excludedIssueTypes(teamKey);
  const rows = await fetchAllRows<QueueRow>((from, to) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let q: any = getSupabaseClient().from("tickets").select(columns).eq("team_key", teamKey).ilike("status", "on hold");
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return q.order("issue_key").range(from, to);
  });
  return rows.filter((r) => !isExcludedIssueType(teamKey, r.issue_type));
}

function buildQueue(rows: QueueRow[], team: TeamConfig, thresholdMinutes: number | null, nowMs: number) {
  const today = toManilaDateString(new Date(nowMs).toISOString())!;
  const soon = toManilaDateString(new Date(nowMs + 2 * 86400000).toISOString())!;
  const tickets: QueueTicket[] = rows.map((r) => {
    const cycles = Array.isArray(r.on_hold_cycles_json) ? r.on_hold_cycles_json : [];
    const open = cycles.filter((c) => !c.exitedAt && c.enteredAt).slice(-1)[0];
    const ageMinutes = open ? round2((nowMs - new Date(open.enteredAt!).getTime()) / 60000) : null;
    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
    const reason = open ? reasonOf(open) : NOT_SPECIFIED;
    return {
      issueKey: r.issue_key,
      issueType: r.issue_type || "",
      product: r.product || "(none)",
      assignedSe: backlogAgingAssignee(team, r).trim(),
      reporter: (r.reporter_display_name || "").trim(),
      priority: r.priority || "",
      reason,
      sePause: isSePause(reason),
      enteredAt: open?.enteredAt ?? null,
      ageMinutes,
      lastActivityAt: r.updated,
      dueDate: due,
      sla: !due ? "noDue" : due < today ? "overdue" : due <= soon ? "dueSoon" : "onTrack",
      stale: ageMinutes !== null && thresholdMinutes !== null && ageMinutes > thresholdMinutes,
      episodes: cycles.length,
    };
  });
  tickets.sort((a, b) => (b.ageMinutes ?? -1) - (a.ageMinutes ?? -1));
  const ages = tickets.map((t) => t.ageMinutes).filter((m): m is number => m !== null);
  const over = tickets.filter((t) => t.stale).length;
  return {
    asOf: new Date(nowMs).toISOString(),
    count: tickets.length,
    avgAgeMinutes: avgOf(ages),
    medianAgeMinutes: medOf(ages),
    oldest: tickets.find((t) => t.ageMinutes !== null) ?? null,
    overThreshold: over,
    overThresholdShare: rateOf(over, ages.length),
    unknownAge: tickets.length - ages.length,
    tickets,
  };
}

// ------------------------------------------------------------------------------ Insights

const pct = (n: number | null, d = 0) => (n === null ? "—" : `${(n * 100).toFixed(d)}%`);

function buildInsights(r: Omit<OnHoldReport, "insights">): Insight[] {
  const out: Insight[] = [];
  const c = r.current;
  if (!c.resolved) return out;
  const p = r.previous;

  if (p && c.wait.avgMinutes !== null && p.wait.avgMinutes !== null && p.wait.episodes > 0 && !c.legacyMode && !p.legacyMode) {
    const diff = c.wait.avgMinutes - p.wait.avgMinutes;
    if (Math.abs(diff) >= Math.max(30, p.wait.avgMinutes * 0.05)) {
      const up = diff > 0;
      out.push({
        tone: up ? "watch" : "positive",
        text: {
          professional: `Average hold ${up ? "rose" : "fell"} ${holdText(Math.abs(diff))} (${holdText(p.wait.avgMinutes)} → ${holdText(c.wait.avgMinutes)}) over ${p.wait.episodes} → ${c.wait.episodes} completed holds.`,
          gaby: `**Waiting ${up ? "longer" : "less"}: ${up ? "+" : "−"}${holdText(Math.abs(diff))} per hold.** ${holdText(p.wait.avgMinutes)} → ${holdText(c.wait.avgMinutes)}.`,
        },
      });
    }
  }

  const { byVolume, byTime } = r.leaders;
  if (byVolume && byTime && byVolume.key !== byTime.key && c.wait.episodes >= SMALL) {
    out.push({
      tone: "watch",
      text: {
        professional: `${byVolume.key} is the most frequent reason (${pct(byVolume.shareOfEpisodes)} of holds), but ${byTime.key} consumes the most time (${pct(byTime.shareOfTime)} of hold time from ${pct(byTime.shareOfEpisodes)} of holds).`,
        gaby: `**${byTime.key} costs the most time** (${pct(byTime.shareOfTime)} of waiting), even though ${byVolume.key} comes up more often.`,
      },
    });
  } else if (byTime && c.wait.episodes >= SMALL) {
    out.push({
      tone: "watch",
      text: {
        professional: `${byTime.key} is both the most frequent reason and the largest share of hold time (${pct(byTime.shareOfEpisodes)} of holds, ${pct(byTime.shareOfTime)} of time).`,
        gaby: `**${byTime.key} leads on both counts:** ${pct(byTime.shareOfEpisodes)} of holds, ${pct(byTime.shareOfTime)} of the time.`,
      },
    });
  }

  const pause = r.reasons.filter((x) => x.sePause).reduce((a, x) => ({ ep: a.ep + x.stats.episodes, t: a.t + x.stats.totalMinutes }), { ep: 0, t: 0 });
  if (pause.ep > 0 && c.wait.totalMinutes > 0) {
    const share = round4(pause.t / c.wait.totalMinutes);
    out.push({
      tone: "watch",
      text: {
        professional: `SE-side pauses (Ticket break) make up ${pct(share)} of completed hold time across ${pause.ep} hold${pause.ep === 1 ? "" : "s"}. The rest is waiting on others.`,
        gaby: `**${pct(share)} of the waiting is our own pauses** (Ticket break). The rest is waiting on others.`,
      },
    });
  }

  const ci = r.cycleImpact;
  if (ci.shareOfCycle !== null && ci.tickets >= SMALL) {
    out.push({
      tone: "watch",
      text: {
        professional: `On held tickets, ${pct(ci.shareOfCycle, 1)} of Cycle Time was spent On Hold (${holdText(ci.holdInCycleAvgMinutes)} of ${holdText(ci.cycleAvgMinutes)} on average).`,
        gaby: `**${pct(ci.shareOfCycle)} of a held ticket's cycle is waiting:** ${holdText(ci.holdInCycleAvgMinutes)} of ${holdText(ci.cycleAvgMinutes)}.`,
      },
    });
  }

  if (r.queue.overThreshold > 0 && r.threshold.minutes !== null) {
    const n = r.queue.overThreshold;
    out.push({
      tone: "negative",
      text: {
        professional: `${n} ticket${n === 1 ? " has" : "s have"} been On Hold longer than ${holdText(r.threshold.minutes)}. The oldest has been waiting ${holdText(r.queue.oldest?.ageMinutes)}.`,
        gaby: `**${n} ticket${n === 1 ? "" : "s"} could use a nudge.** Waiting longer than ${holdText(r.threshold.minutes)}; oldest ${holdText(r.queue.oldest?.ageMinutes)}.`,
      },
    });
  }

  if (r.efficiency.repeatHoldRate !== null && r.efficiency.repeatTickets >= 3) {
    out.push({
      tone: "watch",
      text: {
        professional: `${pct(r.efficiency.repeatHoldRate)} of held tickets went On Hold more than once (${r.efficiency.repeatTickets} tickets, up to ${r.efficiency.maxEpisodes} holds each).`,
        gaby: `**${pct(r.efficiency.repeatHoldRate)} went back on hold again** (${r.efficiency.repeatTickets} tickets).`,
      },
    });
  }

  if (r.coverage.legacyTickets > 0) {
    const n = r.coverage.legacyTickets;
    out.push({
      tone: "watch",
      text: {
        professional: `${n} held ticket${n === 1 ? " has" : "s have"} no per-hold history synced yet, so ${n === 1 ? "it is" : "they are"} counted as held but left out of hold durations, reasons and exits. See Data quality.`,
        gaby: `**${n} ticket${n === 1 ? "" : "s"} still waiting on the history sync.** Counted as held, but not in the timings yet.`,
      },
    });
  }

  return out.slice(0, 6);
}

// ------------------------------------------------------------------------------ Main report

export type OnHoldOptions = {
  issueType?: string;
  grain?: ReviewWaitGrain;
  baseline?: KpiBaselineRow;
  baselineP75?: KpiBaselineRow;
  thresholdOverrideMinutes?: number | null;
  reason?: string | null;
  exit?: string | null;
  segment?: { dim: FcrSegmentDimension; key: string } | null;
  longOnly?: boolean;
};

const TIME_DIMS: FcrSegmentDimension[] = ["month", "week", "dow"];

export async function getOnHoldReport(team: string, range: string, period: string, opts: OnHoldOptions = {}): Promise<OnHoldReport> {
  const teamConfig = (await getTeams()).find((t) => t.team_key === team);
  if (!teamConfig) throw new Error(`Unknown team: ${team}`);
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const grain = opts.grain ?? defaultGrainFor(range);
  const cycleBasis = basisFor("cycle", teamConfig.has_peer_review_tracking);
  const leadBasis = basisFor("lead", teamConfig.has_peer_review_tracking);
  const nowMs = Date.now();

  let prevPeriod: string | null = null;
  try {
    prevPeriod = shiftPeriod(range as RangeType, period, -1);
  } catch {
    prevPeriod = null;
  }
  const prevRange = prevPeriod ? resolvePeriodToDateRange(range, prevPeriod) : null;
  const needLiveBaseline = !opts.baseline || opts.baseline.value === null || !opts.baselineP75 || opts.baselineP75.value === null;

  const [rows, prevRows, queueRows, liveBaseline] = await Promise.all([
    fetchHoldRows(team, startDate, endDate, opts.issueType, FULL_SELECT),
    prevRange ? fetchHoldRows(team, prevRange.startDate, prevRange.endDate, opts.issueType, PREV_SELECT) : Promise.resolve(null),
    fetchQueue(team, opts.issueType),
    needLiveBaseline ? computeOnHoldBaseline(team) : Promise.resolve(null),
  ]);

  const holds = rows.map(ticketHoldOf);
  const prevHolds = prevRows ? prevRows.map(ticketHoldOf) : null;
  const current = summarize(holds);
  const previous = prevHolds && prevPeriod ? { ...summarize(prevHolds), period: prevPeriod } : null;

  // ---- Threshold: cookie override, else the Q1+Q2 P75 hold (stored, else live)
  const stored = opts.baseline && opts.baseline.value !== null && opts.baselineP75 && opts.baselineP75.value !== null;
  const base = stored
    ? { avgMinutes: Number(opts.baseline!.value), p75Minutes: Number(opts.baselineP75!.value), sampleCount: opts.baseline!.sample_count, periodLabel: opts.baseline!.period_label, fromStore: true }
    : { ...(liveBaseline ?? { avgMinutes: null, p75Minutes: null, sampleCount: 0 }), periodLabel: ON_HOLD_BASELINE_LABEL, fromStore: false };
  const override = opts.thresholdOverrideMinutes ?? null;
  const threshold: OnHoldThreshold =
    override !== null && override > 0
      ? { minutes: override, source: "override", baseline: base }
      : base.p75Minutes !== null
        ? { minutes: base.p75Minutes, source: base.fromStore ? "baseline" : "live-baseline", baseline: base }
        : { minutes: null, source: "none", baseline: base };

  // ---- Per-ticket derived values
  const finite = (n: number | null) => (n !== null && isFinite(n) ? round2(n) : null);
  const cycleOf = new Map<string, number | null>();
  const leadOf = new Map<string, number | null>();
  const holdInCycleOf = new Map<string, number>();
  const holdByKey = new Map<string, TicketHold>();
  for (const h of holds) {
    const r = h.row;
    holdByKey.set(r.issue_key, h);
    cycleOf.set(r.issue_key, finite(cycleBasis.duration(r)));
    leadOf.set(r.issue_key, finite(leadBasis.duration(r)));
    // Only the part of each hold inside the ticket's own Cycle Time window counts toward it.
    holdInCycleOf.set(r.issue_key, round2(h.completed.reduce((n, e) => n + overlapMinutes(e, cycleBasis.startedAt(r) || null, cycleBasis.endedAt(r) || null), 0)));
  }

  const toView = (e: Ep): EpisodeView => {
    const r = e.row;
    const h = holdByKey.get(r.issue_key);
    const cyc = cycleOf.get(r.issue_key) ?? null;
    const inCycle = holdInCycleOf.get(r.issue_key) ?? 0;
    return {
      issueKey: r.issue_key,
      issueType: r.issue_type || "",
      product: r.product || "(none)",
      priority: r.priority || "",
      assignedSe: backlogAgingAssignee(teamConfig, r).trim(),
      seAtEntry: (e.raw.assigneeAtEntry || "").trim(),
      reporter: (r.reporter_display_name || "").trim(),
      reason: e.reason,
      sePause: isSePause(e.reason),
      enteredAt: e.raw.enteredAt || "",
      exitedAt: e.raw.exitedAt || null,
      minutes: e.minutes,
      exitStatus: e.raw.exitedToStatus || "",
      episodeIndex: e.index,
      episodeCount: e.count,
      ticketHoldMinutes: h?.holdMinutes ?? 0,
      cycleMinutes: cyc,
      cycleHoldShare: cyc && cyc > 0 ? round4(Math.min(1, inCycle / cyc)) : null,
      leadMinutes: leadOf.get(r.issue_key) ?? null,
      status: r.status || "",
    };
  };

  const completed = holds.flatMap((h) => h.completed);
  const allEpisodes = holds.flatMap((h) => h.episodes);
  const heldWithEpisodes = holds.filter((h) => h.hasEpisodeData && h.episodes.length > 0);
  const totalHoldMinutes = completed.reduce((n, e) => n + e.minutes!, 0);

  // ---- Reasons (per completed episode; a ticket counts once per reason it was held for)
  const prevReasonEps = new Map<string, number[]>();
  if (prevHolds) for (const h of prevHolds) for (const e of h.completed) {
    if (!prevReasonEps.has(e.reason)) prevReasonEps.set(e.reason, []);
    prevReasonEps.get(e.reason)!.push(e.minutes!);
  }
  const byReason = new Map<string, Ep[]>();
  for (const e of completed) {
    if (!byReason.has(e.reason)) byReason.set(e.reason, []);
    byReason.get(e.reason)!.push(e);
  }
  const reasons: ReasonRow[] = Array.from(byReason.entries())
    .map(([key, eps]) => {
      const tickets = new Set(eps.map((e) => e.row.issue_key)).size;
      const stats = statsOf(eps.map((e) => e.minutes!));
      const prev = prevHolds ? prevReasonEps.get(key) ?? [] : null;
      return {
        key,
        sePause: isSePause(key),
        tickets,
        stats,
        shareOfHeldTickets: rateOf(tickets, heldWithEpisodes.length) ?? 0,
        shareOfResolved: rateOf(tickets, current.resolved) ?? 0,
        shareOfEpisodes: rateOf(eps.length, completed.length) ?? 0,
        shareOfTime: rateOf(stats.totalMinutes, totalHoldMinutes) ?? 0,
        previous: prev ? { episodes: prev.length, avgMinutes: avgOf(prev) } : null,
      };
    })
    .sort((a, b) => b.stats.totalMinutes - a.stats.totalMinutes || a.key.localeCompare(b.key));

  const longestEp = completed.slice().sort((a, b) => b.minutes! - a.minutes!)[0];
  const leaders = {
    byVolume: reasons.slice().sort((a, b) => b.stats.episodes - a.stats.episodes)[0] ?? null,
    byTime: reasons[0] ?? null,
    byAvg: reasons.filter((x) => x.stats.episodes >= 5).sort((a, b) => (b.stats.avgMinutes ?? 0) - (a.stats.avgMinutes ?? 0))[0] ?? null,
    longest: longestEp ? toView(longestEp) : null,
  };

  // ---- Queue
  const queue = buildQueue(queueRows, teamConfig, threshold.minutes, nowMs);

  // ---- Efficiency
  const longHolds = threshold.minutes === null ? 0 : completed.filter((e) => e.minutes! > threshold.minutes!).length;
  const repeat = heldWithEpisodes.filter((h) => h.episodes.length > 1);
  const efficiency = {
    resolutionRate: rateOf(completed.length, allEpisodes.length),
    repeatHoldRate: rateOf(repeat.length, heldWithEpisodes.length),
    repeatTickets: repeat.length,
    repeatTotalMinutes: round2(repeat.reduce((n, h) => n + h.holdMinutes, 0)),
    maxEpisodes: heldWithEpisodes.reduce((m, h) => Math.max(m, h.episodes.length), 0),
    longHoldRate: threshold.minutes === null ? null : rateOf(longHolds, completed.length),
    longHolds,
    currentStaleRate: queue.overThresholdShare,
  };

  // ---- Exits + reason × exit
  const byExit = new Map<string, { label: string; eps: Ep[] }>();
  for (const e of completed) {
    if (!byExit.has(e.exitKey)) byExit.set(e.exitKey, { label: titleCase(e.exitKey), eps: [] });
    byExit.get(e.exitKey)!.eps.push(e);
  }
  const exits: ExitRow[] = Array.from(byExit.entries())
    .map(([k, v]) => {
      const m = v.eps.map((e) => e.minutes!);
      return { key: v.label, terminal: TERMINAL_EXITS.includes(k), episodes: v.eps.length, share: rateOf(v.eps.length, completed.length) ?? 0, avgMinutes: avgOf(m), medianMinutes: medOf(m) };
    })
    .sort((a, b) => b.episodes - a.episodes);
  const exitLabels = exits.map((x) => x.key);
  const matrix = {
    exits: exitLabels,
    rows: reasons.map((rr) => {
      const counts: Record<string, number> = {};
      for (const e of byReason.get(rr.key) ?? []) {
        const l = titleCase(e.exitKey);
        counts[l] = (counts[l] || 0) + 1;
      }
      return { reason: rr.key, episodes: rr.stats.episodes, counts };
    }),
  };

  // ---- Cycle / lead impact (pooled: average hold ÷ average span, over held tickets with episode data)
  const cycTickets = heldWithEpisodes.filter((h) => (cycleOf.get(h.row.issue_key) ?? 0) > 0);
  const cycSum = cycTickets.reduce((n, h) => n + cycleOf.get(h.row.issue_key)!, 0);
  const inCycSum = cycTickets.reduce((n, h) => n + (holdInCycleOf.get(h.row.issue_key) ?? 0), 0);
  const leadTickets = heldWithEpisodes.filter((h) => (leadOf.get(h.row.issue_key) ?? 0) > 0);
  const leadSum = leadTickets.reduce((n, h) => n + leadOf.get(h.row.issue_key)!, 0);
  const leadHoldSum = leadTickets.reduce((n, h) => n + h.holdMinutes, 0);
  const cycleImpact = {
    tickets: cycTickets.length,
    cycleAvgMinutes: cycTickets.length ? round2(cycSum / cycTickets.length) : null,
    holdInCycleAvgMinutes: cycTickets.length ? round2(inCycSum / cycTickets.length) : null,
    shareOfCycle: cycSum ? round4(Math.min(1, inCycSum / cycSum)) : null,
    leadTickets: leadTickets.length,
    leadAvgMinutes: leadTickets.length ? round2(leadSum / leadTickets.length) : null,
    holdAvgMinutes: leadTickets.length ? round2(leadHoldSum / leadTickets.length) : null,
    shareOfLead: leadSum ? round4(Math.min(1, leadHoldSum / leadSum)) : null,
  };

  // ---- Where does ticket time go? (lead time split, held vs never held)
  const reviewMinutesOf = (r: Row) => {
    const cycles = Array.isArray(r.peer_review_cycles_json) ? r.peer_review_cycles_json : [];
    return cycles.reduce((n, c) => {
      const k = classifyReviewCycle(c);
      return k.kind === "completed" ? n + k.waitMinutes! : n;
    }, 0);
  };
  const splitOf = (hs: TicketHold[]): TimeSplit => {
    const xs = hs.filter((h) => (leadOf.get(h.row.issue_key) ?? 0) > 0);
    if (!xs.length) return { tickets: 0, leadAvgMinutes: null, inProgress: null, onHold: null, review: null, other: null };
    const n = xs.length;
    const lead = xs.reduce((a, h) => a + leadOf.get(h.row.issue_key)!, 0) / n;
    const ip = xs.reduce((a, h) => a + (Number(h.row.total_in_progress_minutes) || 0), 0) / n;
    const oh = xs.reduce((a, h) => a + h.holdMinutes, 0) / n;
    const rv = xs.reduce((a, h) => a + reviewMinutesOf(h.row), 0) / n;
    return { tickets: n, leadAvgMinutes: round2(lead), inProgress: round2(ip), onHold: round2(oh), review: round2(rv), other: round2(Math.max(0, lead - ip - oh - rv)) };
  };
  const timeSplit = { held: splitOf(heldWithEpisodes), notHeld: splitOf(holds.filter((h) => !h.held)) };

  // ---- Segments
  const segOf = (dim: FcrSegmentDimension, r: Row) => segmentKey(dim, { ...r, fcr_value: r.fcr_value ?? null }, teamConfig);
  const groupHolds = (hs: TicketHold[], dim: FcrSegmentDimension) => {
    const m = new Map<string, TicketHold[]>();
    for (const h of hs) {
      const k = segOf(dim, h.row);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(h);
    }
    return m;
  };
  const segments = Object.fromEntries(
    FCR_SEGMENT_DIMENSIONS.map((dim) => {
      const cur = groupHolds(holds, dim);
      const prev = prevHolds && !TIME_DIMS.includes(dim) ? groupHolds(prevHolds, dim) : null;
      const list: HoldSegmentRow[] = Array.from(cur.entries()).map(([key, hs]) => {
        const eps = hs.flatMap((h) => h.completed);
        const stats = statsOf(eps.map((e) => e.minutes!));
        const rc = new Map<string, number>();
        for (const e of eps) rc.set(e.reason, (rc.get(e.reason) || 0) + 1);
        const top = Array.from(rc.entries()).sort((a, b) => b[1] - a[1])[0];
        const held = hs.filter((h) => h.held).length;
        const p = prev ? prev.get(key) ?? [] : null;
        const pAvg = p ? avgOf(p.flatMap((h) => h.completed.map((e) => e.minutes!))) : null;
        return {
          key,
          resolved: hs.length,
          held,
          holdRate: rateOf(held, hs.length),
          stats,
          topReason: top ? top[0] : null,
          previous: p ? { resolved: p.length, held: p.filter((h) => h.held).length, avgMinutes: pAvg } : null,
          deltaAvgMinutes: pAvg !== null && stats.avgMinutes !== null ? round2(stats.avgMinutes - pAvg) : null,
          smallSample: held < SMALL,
        };
      });
      list.sort((a, b) => (TIME_DIMS.includes(dim) ? a.key.localeCompare(b.key) : b.stats.totalMinutes - a.stats.totalMinutes || b.held - a.held || a.key.localeCompare(b.key)));
      return [dim, list];
    })
  ) as Record<FcrSegmentDimension, HoldSegmentRow[]>;

  // ---- Trend (bucketed by the ticket's resolved date, like the headline)
  const trendReasons = reasons.slice(0, 6).map((x) => x.key);
  const buckets = enumerateBuckets(grain, startDate, endDate);
  const acc = new Map(buckets.map((b) => [b.key, { holds: [] as TicketHold[] }]));
  for (const h of holds) {
    const a = acc.get(bucketKey(grain, toManilaDateString(h.row.resolved_datetime)!));
    if (a) a.holds.push(h);
  }
  const trend: HoldTrendPoint[] = buckets.map((b) => {
    const hs = acc.get(b.key)!.holds;
    const eps = hs.flatMap((h) => h.completed);
    const m = eps.map((e) => e.minutes!);
    const held = hs.filter((h) => h.held).length;
    const byR: HoldTrendPoint["byReason"] = {};
    for (const rk of trendReasons) {
      const rm = eps.filter((e) => e.reason === rk).map((e) => e.minutes!);
      byR[rk] = { episodes: rm.length, totalMinutes: round2(rm.reduce((x, y) => x + y, 0)), avgMinutes: avgOf(rm) };
    }
    return {
      bucket: b.key,
      resolved: hs.length,
      held,
      heldShare: rateOf(held, hs.length),
      episodes: eps.length,
      avgMinutes: avgOf(m),
      medianMinutes: medOf(m),
      p90Minutes: pctile(m, 90),
      totalMinutes: round2(m.reduce((x, y) => x + y, 0)),
      byReason: byR,
    };
  });

  // ---- Episode list (longest first)
  const reasonFilter = opts.reason || null;
  const exitFilter = opts.exit ? opts.exit.trim().toLowerCase() : null;
  const filtered = completed.filter((e) => {
    if (reasonFilter && e.reason !== reasonFilter) return false;
    if (exitFilter && e.exitKey !== exitFilter) return false;
    if (opts.segment && segOf(opts.segment.dim, e.row) !== opts.segment.key) return false;
    if (opts.longOnly && (threshold.minutes === null || e.minutes! <= threshold.minutes)) return false;
    return true;
  });
  const episodes = filtered.slice().sort((a, b) => b.minutes! - a.minutes!).slice(0, BREAKDOWN_TICKET_LIMIT).map(toView);

  // ---- Data quality
  const otherExits = allEpisodes.filter((e) => e.kind === "otherExit");
  const invalid = allEpisodes.filter((e) => e.kind === "invalid");
  // A hold with no exit on a ticket that is no longer On Hold: the transition out wasn't recorded.
  const openOnResolved = allEpisodes.filter((e) => e.kind === "open" && (e.row.status || "").trim().toLowerCase() !== "on hold");

  const partial: Omit<OnHoldReport, "insights"> = {
    team,
    range,
    period,
    issueType: opts.issueType ?? null,
    grain,
    assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
    current,
    previous,
    smallSample: current.wait.episodes > 0 && current.wait.episodes < HEADLINE_SMALL_SAMPLE,
    threshold,
    coverage: { heldTickets: current.heldTickets, withEpisodes: heldWithEpisodes.length, legacyTickets: holds.filter((h) => h.held && !h.hasEpisodeData).length },
    efficiency,
    reasons,
    leaders,
    queue,
    longest: completed.slice().sort((a, b) => b.minutes! - a.minutes!).slice(0, 10).map(toView),
    exits,
    matrix,
    cycleImpact,
    timeSplit,
    segments,
    trend,
    trendReasons,
    dataQuality: {
      legacyTickets: holds.filter((h) => h.held && !h.hasEpisodeData).length,
      notSpecifiedEpisodes: completed.filter((e) => e.reason === NOT_SPECIFIED).length,
      otherExitCount: otherExits.length,
      otherExits: otherExits.slice(0, 100).map(toView),
      invalidCount: invalid.length,
      invalid: invalid.slice(0, 100).map((e) => ({ issueKey: e.row.issue_key, detail: `Hold #${e.index}: entered ${e.raw.enteredAt || "?"}, exited ${e.raw.exitedAt || "?"}` })),
      openOnResolvedCount: openOnResolved.length,
      openOnResolved: openOnResolved.slice(0, 100).map(toView),
    },
    ticketFilter: { reason: reasonFilter, exit: opts.exit || null, segment: opts.segment ?? null, longOnly: !!opts.longOnly },
    episodes,
    episodeTotal: filtered.length,
    allReasons: reasons.map((x) => x.key),
    allExits: exitLabels,
  };
  return { ...partial, insights: buildInsights(partial) };
}

// ------------------------------------------------------------------------------ Scorecard

export type OnHoldScorecard = { current: OnHoldSummary; previous: OnHoldSummary | null; currentQueue: number; smallSample: boolean };

/** Team Stats card: the same ticketHoldOf/summarize over the same fetch as the deep-dive, so they agree. */
export async function getOnHoldScorecard(team: string, range: string, period: string, issueType?: string): Promise<OnHoldScorecard | null> {
  try {
    const cur = resolvePeriodToDateRange(range, period);
    let prev: { startDate: string; endDate: string } | null = null;
    try {
      prev = resolvePeriodToDateRange(range, shiftPeriod(range as RangeType, period, -1));
    } catch {
      prev = null;
    }
    const [c, p, q] = await Promise.all([
      fetchHoldRows(team, cur.startDate, cur.endDate, issueType, BASELINE_SELECT),
      prev ? fetchHoldRows(team, prev.startDate, prev.endDate, issueType, BASELINE_SELECT) : Promise.resolve(null),
      fetchQueue(team, issueType),
    ]);
    const current = summarize(c.map(ticketHoldOf));
    return {
      current,
      previous: p ? summarize(p.map(ticketHoldOf)) : null,
      currentQueue: q.length,
      smallSample: current.wait.episodes > 0 && current.wait.episodes < HEADLINE_SMALL_SAMPLE,
    };
  } catch (err) {
    console.error("[getOnHoldScorecard] failed:", err);
    return null;
  }
}
