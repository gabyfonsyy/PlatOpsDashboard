import { getTeams, backlogAgingAssignee, backlogAgingAssigneeLabel } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString } from "@/lib/manila-date";
import { basisFor } from "@/lib/lead-cycle-time";
import { escalationTargets, BREAKDOWN_TICKET_LIMIT } from "@/lib/ticket-breakdowns";
import { defaultGrainFor, bucketKey, enumerateBuckets, classifyReviewCycle, type ReviewWaitGrain, type PeerReviewCycleRaw } from "@/lib/review-wait";
import { fetchResolved, fcrValueOf, segmentKey, type FcrSegmentDimension, type FcrValue } from "@/lib/fcr";
import type { Insight } from "@/components/dashboard/InsightsPanel";
import { median } from "@/lib/stats";

/**
 * Escalation Rate deep-dive (SE Team Stats item 3).
 *
 *   Escalation Rate = tickets with First Contact Resolution = No ÷ tickets resolved in the period
 *
 * — the exact inverse of FCR Rate (lib/fcr.ts), on the same population: resolved-date bucketed,
 * blank FCR excluded from both sides, Archived/Rejected included. FCR is the source of truth for
 * the RATE; the Ticket Escalation multi-select only answers WHO the SE needed help from, counted
 * once per destination (so destination shares can sum past 100%). An FCR = No ticket with no real
 * destination is "Not specified"; an FCR = Yes ticket with one is flagged, never reinterpreted.
 */

export const NOT_SPECIFIED = "Not specified";
const SMALL = 10;

// ------------------------------------------------------------------------------ Types

export type EscCounts = { resolved: number; escalated: number; fcr: number; rate: number | null; unknown: number };

export type SpanStats = {
  tickets: number;
  cycleAvgMinutes: number | null;
  cycleMedianMinutes: number | null;
  cycleP90Minutes: number | null;
  /** Average total completed peer-review wait, over tickets that went through review. */
  reviewWaitAvgMinutes: number | null;
  reviewedTickets: number;
  /** Resolved on or before the due date ÷ tickets with a due date. */
  slaMetRate: number | null;
};

export type DestinationRow = {
  key: string;
  /** Escalated (FCR = No) tickets that list this destination. */
  tickets: number;
  shareOfEscalated: number;
  shareOfResolved: number;
  stats: SpanStats;
  /** FCR rate across every ticket naming this destination (FCR = Yes ones are data-quality cases). */
  fcrRate: number | null;
  distinctSes: number;
  previousTickets: number | null;
  change: number | null;
};

export type ComplexityRow = { key: "1" | "2" | "3+" | "Not specified"; tickets: number; share: number; stats: SpanStats; smallSample: boolean };

export type EscSegmentRow = {
  key: string;
  resolved: number;
  escalated: number;
  rate: number | null;
  cycleAvgMinutes: number | null;
  previous: { resolved: number; rate: number | null } | null;
  deltaPts: number | null;
  smallSample: boolean;
  topDestination: string | null;
  distinctDestinations: number;
};

export type EscTrendPoint = { bucket: string; resolved: number; escalated: number; rate: number | null; byDestination: Record<string, number> };

export type EscTicket = {
  issueKey: string;
  issueType: string;
  assignedSe: string;
  reporter: string;
  product: string;
  priority: string;
  fcr: FcrValue;
  destinations: string[];
  createdAt: string;
  firstContactAt: string | null;
  resolvedAt: string;
  dueDate: string | null;
  slaMet: boolean | null;
  cycleMinutes: number | null;
  reviewWaitMinutes: number | null;
  status: string;
  outcomeReason: string;
};

export type EscalationReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  grain: ReviewWaitGrain;
  assigneeLabel: string;
  current: EscCounts;
  previous: (EscCounts & { period: string }) | null;
  smallSample: boolean;
  avgDestinationsPerEscalated: number | null;
  destinations: DestinationRow[];
  complexity: ComplexityRow[];
  impact: { fcr: SpanStats; escalated: SpanStats };
  segments: Record<FcrSegmentDimension, EscSegmentRow[]>;
  matrix: { destinations: string[]; rows: { issueType: string; escalated: number; counts: Record<string, number> }[] };
  trend: EscTrendPoint[];
  trendDestinations: string[];
  dataQuality: { unknownCount: number; notSpecified: EscTicket[]; notSpecifiedCount: number; fcrYesWithDestination: EscTicket[]; fcrYesWithDestinationCount: number };
  insights: Insight[];
  ticketFilter: { destinations: string[]; fcr: FcrValue | null; segment: { dim: FcrSegmentDimension; key: string } | null };
  tickets: EscTicket[];
  ticketTotal: number;
  allDestinations: string[];
};

// ------------------------------------------------------------------------------ Helpers

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const rateOf = (n: number, d: number) => (d ? round4(n / d) : null);
const ptsOf = (cur: number | null, prev: number | null) => (cur === null || prev === null ? null : Math.round((cur - prev) * 1000) / 10);
const avgOf = (a: number[]) => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null);
const medOf = (a: number[]) => {
  const m = median(a);
  return m === null ? null : round2(m);
};
function p90Of(a: number[]): number | null {
  if (a.length < SMALL) return null;
  const s = a.slice().sort((x, y) => x - y);
  const idx = (90 / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return round2(s[lo] + (s[hi] - s[lo]) * (idx - lo));
}

type Row = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  fcr_value: string | null;
  escalation_value: string | null;
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
  due_date: string | null;
  archive_reason: string | null;
  rejection_category: string | null;
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

const FULL_SELECT =
  "issue_key,issue_type,status,fcr_value,escalation_value,priority,product,labels,assigned_se,assigned_cod," +
  "reporter_display_name,created,resolved_datetime,first_out_of_backlog_todo,cycle_time_start,cycle_time_end," +
  "due_date,archive_reason,rejection_category,peer_review_cycles_json";

const PREV_SELECT = "issue_key,issue_type,fcr_value,escalation_value,priority,product,assigned_se,assigned_cod,reporter_display_name,resolved_datetime";
type PrevRow = Pick<Row, "issue_key" | "issue_type" | "fcr_value" | "escalation_value" | "priority" | "product" | "assigned_se" | "assigned_cod" | "reporter_display_name" | "resolved_datetime">;

/** Destinations for an escalated (FCR = No) ticket; "Not specified" when the field names none. */
export function destinationsOf(r: { escalation_value: string | null }): string[] {
  const t = escalationTargets(r.escalation_value);
  return t.length ? t : [NOT_SPECIFIED];
}

function escCounts(rows: { fcr_value: string | null }[]): EscCounts {
  let fcr = 0;
  let esc = 0;
  let unknown = 0;
  for (const r of rows) {
    const v = fcrValueOf(r.fcr_value);
    if (v === "Yes") fcr++;
    else if (v === "No") esc++;
    else unknown++;
  }
  return { resolved: fcr + esc, escalated: esc, fcr, rate: rateOf(esc, fcr + esc), unknown };
}

// ------------------------------------------------------------------------------ Insights

const pct = (n: number | null, d = 1) => (n === null ? "—" : `${(n * 100).toFixed(d)}%`);
function dur(minutes: number | null): string {
  if (minutes === null) return "—";
  const t = Math.round(minutes);
  const d = Math.floor(t / 1440);
  const h = Math.floor((t % 1440) / 60);
  const m = t % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function buildInsights(r: Omit<EscalationReport, "insights">): Insight[] {
  const out: Insight[] = [];
  const c = r.current;
  if (!c.resolved) return out;
  const p = r.previous;

  if (p && p.rate !== null && c.rate !== null && p.resolved > 0) {
    const d = ptsOf(c.rate, p.rate)!;
    if (Math.abs(d) >= 0.5) {
      const up = d > 0;
      out.push({
        tone: up ? "watch" : "positive",
        text: {
          professional: `Escalation rate ${up ? "rose" : "fell"} ${pct(p.rate)} → ${pct(c.rate)} (${up ? "+" : ""}${d} pts); escalated tickets ${p.escalated} → ${c.escalated} of ${p.resolved} → ${c.resolved} resolved.`,
          gaby: `**Escalating ${up ? "more" : "less"}: ${up ? "+" : ""}${d} pts.** ${pct(p.rate)} → ${pct(c.rate)} · ${p.escalated} → ${c.escalated} tickets.`,
        },
      });
    }
  }

  const top = r.destinations.find((d) => d.key !== NOT_SPECIFIED);
  if (top && c.escalated >= 5) {
    out.push({
      tone: "watch",
      text: {
        professional: `${top.key} receives the most escalations: ${top.tickets} tickets, ${pct(top.shareOfEscalated, 0)} of escalated work.`,
        gaby: `**We lean on ${top.key} most** — ${top.tickets} tickets (${pct(top.shareOfEscalated, 0)} of escalations).`,
      },
    });
  }

  const mover = r.destinations
    .filter((d) => d.change !== null && d.previousTickets !== null && d.key !== NOT_SPECIFIED && Math.max(d.tickets, d.previousTickets) >= SMALL)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))[0];
  if (mover && Math.abs(mover.change!) >= 5) {
    const up = mover.change! > 0;
    out.push({
      tone: "watch",
      text: {
        professional: `${mover.key} escalations ${up ? "rose" : "fell"} ${mover.previousTickets} → ${mover.tickets} vs the previous period.`,
        gaby: `**${mover.key} ${up ? "↑" : "↓"}** ${mover.previousTickets} → ${mover.tickets} escalations.`,
      },
    });
  }

  const f = r.impact.fcr;
  const e = r.impact.escalated;
  if (f.cycleMedianMinutes !== null && e.cycleMedianMinutes !== null && e.tickets >= SMALL && f.tickets >= SMALL) {
    out.push({
      tone: "watch",
      text: {
        professional: `Observed: escalated tickets have a median cycle time of ${dur(e.cycleMedianMinutes)} vs ${dur(f.cycleMedianMinutes)} for first-contact tickets.`,
        gaby: `**Escalated tickets run ${dur(e.cycleMedianMinutes)} (median)** vs ${dur(f.cycleMedianMinutes)} when solved first time.`,
      },
    });
  }

  const multi = r.complexity.filter((x) => x.key === "2" || x.key === "3+").reduce((n, x) => n + x.tickets, 0);
  if (multi > 0 && c.escalated >= SMALL) {
    out.push({
      tone: "watch",
      text: {
        professional: `${multi} escalated ticket${multi === 1 ? "" : "s"} (${pct(multi / c.escalated, 0)}) needed more than one team.`,
        gaby: `**${multi} needed more than one team** (${pct(multi / c.escalated, 0)} of escalations).`,
      },
    });
  }

  const dq = r.dataQuality;
  if (dq.notSpecifiedCount + dq.fcrYesWithDestinationCount > 0) {
    out.push({
      tone: "watch",
      text: {
        professional: `${dq.notSpecifiedCount} escalated ticket(s) have no destination and ${dq.fcrYesWithDestinationCount} FCR = Yes ticket(s) list one — see Data quality.`,
        gaby: `**A few records to tidy:** ${dq.notSpecifiedCount} with no destination, ${dq.fcrYesWithDestinationCount} FCR = Yes with one.`,
      },
    });
  }

  return out.slice(0, 6);
}

// ------------------------------------------------------------------------------ Main report

export type EscalationOptions = {
  issueType?: string;
  grain?: ReviewWaitGrain;
  destinations?: string[];
  fcr?: FcrValue | null;
  segment?: { dim: FcrSegmentDimension; key: string } | null;
};

const SEGMENT_DIMS: FcrSegmentDimension[] = ["se", "issueType", "reporter", "priority", "product", "month", "week", "dow"];
const TIME_DIMS: FcrSegmentDimension[] = ["month", "week", "dow"];

export async function getEscalationReport(team: string, range: string, period: string, opts: EscalationOptions = {}): Promise<EscalationReport> {
  const teamConfig = (await getTeams()).find((t) => t.team_key === team);
  if (!teamConfig) throw new Error(`Unknown team: ${team}`);
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const grain = opts.grain ?? defaultGrainFor(range);
  const cycleBasis = basisFor("cycle", teamConfig.has_peer_review_tracking);

  let prevPeriod: string | null = null;
  try {
    prevPeriod = shiftPeriod(range as RangeType, period, -1);
  } catch {
    prevPeriod = null;
  }
  const prevRange = prevPeriod ? resolvePeriodToDateRange(range, prevPeriod) : null;

  const [rows, prevRows] = await Promise.all([
    fetchResolved<Row>(team, startDate, endDate, opts.issueType, FULL_SELECT),
    prevRange ? fetchResolved<PrevRow>(team, prevRange.startDate, prevRange.endDate, opts.issueType, PREV_SELECT) : Promise.resolve(null),
  ]);

  const current = escCounts(rows);
  const previous = prevRows && prevPeriod ? { ...escCounts(prevRows), period: prevPeriod } : null;

  // ---- Per-ticket derived values
  const finite = (n: number | null) => (n !== null && isFinite(n) ? round2(n) : null);
  const cycleOf = new Map<string, number | null>();
  const reviewOf = new Map<string, number | null>();
  const slaOf = new Map<string, boolean | null>();
  for (const r of rows) {
    cycleOf.set(r.issue_key, finite(cycleBasis.duration(r)));
    const cycles = Array.isArray(r.peer_review_cycles_json) ? r.peer_review_cycles_json : [];
    let total = 0;
    let any = false;
    for (const c of cycles) {
      const k = classifyReviewCycle(c);
      if (k.kind === "completed") {
        total += k.waitMinutes!;
        any = true;
      }
    }
    reviewOf.set(r.issue_key, any ? round2(total) : null);
    const resolvedIso = toManilaDateString(r.resolved_datetime);
    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
    slaOf.set(r.issue_key, due && resolvedIso ? resolvedIso <= due : null);
  }
  const spanStats = (rs: Row[]): SpanStats => {
    const cyc = rs.map((r) => cycleOf.get(r.issue_key)).filter((m): m is number => m !== null && m !== undefined);
    const rev = rs.map((r) => reviewOf.get(r.issue_key)).filter((m): m is number => m !== null && m !== undefined);
    const sla = rs.map((r) => slaOf.get(r.issue_key)).filter((b): b is boolean => b !== null && b !== undefined);
    return {
      tickets: rs.length,
      cycleAvgMinutes: avgOf(cyc),
      cycleMedianMinutes: medOf(cyc),
      cycleP90Minutes: p90Of(cyc),
      reviewWaitAvgMinutes: avgOf(rev),
      reviewedTickets: rev.length,
      slaMetRate: rateOf(sla.filter(Boolean).length, sla.length),
    };
  };

  const known = rows.filter((r) => fcrValueOf(r.fcr_value) !== "Unknown");
  const escalated = known.filter((r) => fcrValueOf(r.fcr_value) === "No");
  const fcrRows = known.filter((r) => fcrValueOf(r.fcr_value) === "Yes");

  // ---- Destinations
  const prevDestCounts = new Map<string, number>();
  if (prevRows) for (const r of prevRows) if (fcrValueOf(r.fcr_value) === "No") for (const d of destinationsOf(r)) prevDestCounts.set(d, (prevDestCounts.get(d) || 0) + 1);
  const byDest = new Map<string, Row[]>();
  for (const r of escalated) for (const d of destinationsOf(r)) {
    if (!byDest.has(d)) byDest.set(d, []);
    byDest.get(d)!.push(r);
  }
  const destinations: DestinationRow[] = Array.from(byDest.entries())
    .map(([key, rs]) => {
      const naming = known.filter((r) => escalationTargets(r.escalation_value).includes(key));
      const prevN = prevRows ? prevDestCounts.get(key) ?? 0 : null;
      return {
        key,
        tickets: rs.length,
        shareOfEscalated: rateOf(rs.length, escalated.length) ?? 0,
        shareOfResolved: rateOf(rs.length, current.resolved) ?? 0,
        stats: spanStats(rs),
        fcrRate: key === NOT_SPECIFIED ? 0 : rateOf(naming.filter((r) => fcrValueOf(r.fcr_value) === "Yes").length, naming.length),
        distinctSes: new Set(rs.map((r) => backlogAgingAssignee(teamConfig, r).trim() || "(unassigned)")).size,
        previousTickets: prevN,
        change: prevN === null ? null : rs.length - prevN,
      };
    })
    .sort((a, b) => b.tickets - a.tickets || a.key.localeCompare(b.key));
  const destEntries = escalated.reduce((n, r) => n + escalationTargets(r.escalation_value).length, 0);
  const withDest = escalated.filter((r) => escalationTargets(r.escalation_value).length > 0).length;

  // ---- Complexity
  const groups: Record<ComplexityRow["key"], Row[]> = { "1": [], "2": [], "3+": [], "Not specified": [] };
  for (const r of escalated) {
    const n = escalationTargets(r.escalation_value).length;
    groups[n === 0 ? "Not specified" : n === 1 ? "1" : n === 2 ? "2" : "3+"].push(r);
  }
  const complexity: ComplexityRow[] = (Object.keys(groups) as ComplexityRow["key"][])
    .filter((k) => k !== "Not specified" || groups[k].length > 0)
    .map((k) => ({ key: k, tickets: groups[k].length, share: rateOf(groups[k].length, escalated.length) ?? 0, stats: spanStats(groups[k]), smallSample: groups[k].length < SMALL }));

  // ---- Segments
  const group = <T extends { fcr_value: string | null }>(rs: T[], dim: FcrSegmentDimension) => {
    const m = new Map<string, T[]>();
    for (const r of rs) {
      if (fcrValueOf(r.fcr_value) === "Unknown") continue;
      const k = segmentKey(dim, r as unknown as Parameters<typeof segmentKey>[1], teamConfig);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const segments = Object.fromEntries(
    SEGMENT_DIMS.map((dim) => {
      const cur = group(rows, dim);
      const prev = prevRows && !TIME_DIMS.includes(dim) ? group(prevRows, dim) : null;
      const list: EscSegmentRow[] = Array.from(cur.entries()).map(([key, rs]) => {
        const c = escCounts(rs);
        const p = prev ? escCounts(prev.get(key) ?? []) : null;
        const destCount = new Map<string, number>();
        for (const r of rs) if (fcrValueOf(r.fcr_value) === "No") for (const d of destinationsOf(r)) destCount.set(d, (destCount.get(d) || 0) + 1);
        const top = Array.from(destCount.entries()).sort((a, b) => b[1] - a[1])[0];
        const cyc = rs.map((r) => cycleOf.get(r.issue_key)).filter((m): m is number => m !== null && m !== undefined);
        return {
          key,
          resolved: c.resolved,
          escalated: c.escalated,
          rate: c.rate,
          cycleAvgMinutes: avgOf(cyc),
          previous: p ? { resolved: p.resolved, rate: p.rate } : null,
          deltaPts: p && p.resolved > 0 ? ptsOf(c.rate, p.rate) : null,
          smallSample: c.resolved < SMALL,
          topDestination: top ? top[0] : null,
          distinctDestinations: destCount.size,
        };
      });
      list.sort((a, b) => (TIME_DIMS.includes(dim) ? a.key.localeCompare(b.key) : b.resolved - a.resolved || a.key.localeCompare(b.key)));
      return [dim, list];
    })
  ) as Record<FcrSegmentDimension, EscSegmentRow[]>;

  // ---- Destination × ticket type matrix
  const matrixDests = destinations.map((d) => d.key);
  const mm = new Map<string, { issueType: string; escalated: number; counts: Record<string, number> }>();
  for (const r of escalated) {
    const it = r.issue_type || "(none)";
    if (!mm.has(it)) mm.set(it, { issueType: it, escalated: 0, counts: {} });
    const e = mm.get(it)!;
    e.escalated++;
    for (const d of destinationsOf(r)) e.counts[d] = (e.counts[d] || 0) + 1;
  }
  const matrix = { destinations: matrixDests, rows: Array.from(mm.values()).sort((a, b) => b.escalated - a.escalated) };

  // ---- Trend (+ per-destination, top 6)
  const trendDestinations = destinations.filter((d) => d.key !== NOT_SPECIFIED).slice(0, 6).map((d) => d.key);
  const buckets = enumerateBuckets(grain, startDate, endDate);
  const tm = new Map(buckets.map((b) => [b.key, { bucket: b.key, resolved: 0, escalated: 0, rate: null as number | null, byDestination: Object.fromEntries(trendDestinations.map((d) => [d, 0])) as Record<string, number> }]));
  for (const r of known) {
    const p = tm.get(bucketKey(grain, toManilaDateString(r.resolved_datetime)!));
    if (!p) continue;
    p.resolved++;
    if (fcrValueOf(r.fcr_value) !== "No") continue;
    p.escalated++;
    for (const d of destinationsOf(r)) if (d in p.byDestination) p.byDestination[d]++;
  }
  const trend = Array.from(tm.values()).map((p) => ({ ...p, rate: rateOf(p.escalated, p.resolved) }));

  // ---- Tickets
  const toTicket = (r: Row): EscTicket => ({
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    assignedSe: backlogAgingAssignee(teamConfig, r).trim(),
    reporter: (r.reporter_display_name || "").trim(),
    product: r.product || "(none)",
    priority: r.priority || "",
    fcr: fcrValueOf(r.fcr_value),
    destinations: fcrValueOf(r.fcr_value) === "No" ? destinationsOf(r) : escalationTargets(r.escalation_value),
    createdAt: r.created,
    firstContactAt: r.first_out_of_backlog_todo,
    resolvedAt: r.resolved_datetime,
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    slaMet: slaOf.get(r.issue_key) ?? null,
    cycleMinutes: cycleOf.get(r.issue_key) ?? null,
    reviewWaitMinutes: reviewOf.get(r.issue_key) ?? null,
    status: r.status || "",
    outcomeReason: (r.archive_reason || r.rejection_category || "").trim(),
  });
  const byResolvedDesc = (a: Row, b: Row) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1);
  const destFilter = (opts.destinations ?? []).filter(Boolean);
  // Default view is the escalated tickets; fcr=Yes/Unknown or an explicit "all" (fcr null + dest) widen it.
  const fcrFilter: FcrValue | null = opts.fcr === undefined ? "No" : opts.fcr;
  const filtered = rows.filter((r) => {
    if (fcrFilter && fcrValueOf(r.fcr_value) !== fcrFilter) return false;
    if (opts.segment && segmentKey(opts.segment.dim, r, teamConfig) !== opts.segment.key) return false;
    if (destFilter.length) {
      const ds = fcrValueOf(r.fcr_value) === "No" ? destinationsOf(r) : escalationTargets(r.escalation_value);
      if (!ds.some((d) => destFilter.includes(d))) return false; // ANY (Gaby, 2026-10-01)
    }
    return true;
  });
  const tickets = filtered.slice().sort(byResolvedDesc).slice(0, BREAKDOWN_TICKET_LIMIT).map(toTicket);

  // ---- Data quality
  const notSpecified = escalated.filter((r) => escalationTargets(r.escalation_value).length === 0);
  const yesWithDest = fcrRows.filter((r) => escalationTargets(r.escalation_value).length > 0);

  const partial: Omit<EscalationReport, "insights"> = {
    team,
    range,
    period,
    issueType: opts.issueType ?? null,
    grain,
    assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
    current,
    previous,
    smallSample: current.resolved > 0 && current.resolved < 30,
    avgDestinationsPerEscalated: withDest ? round2(destEntries / withDest) : null,
    destinations,
    complexity,
    impact: { fcr: spanStats(fcrRows), escalated: spanStats(escalated) },
    segments,
    matrix,
    trend,
    trendDestinations,
    dataQuality: {
      unknownCount: current.unknown,
      notSpecified: notSpecified.slice().sort(byResolvedDesc).slice(0, 100).map(toTicket),
      notSpecifiedCount: notSpecified.length,
      fcrYesWithDestination: yesWithDest.slice().sort(byResolvedDesc).slice(0, 100).map(toTicket),
      fcrYesWithDestinationCount: yesWithDest.length,
    },
    ticketFilter: { destinations: destFilter, fcr: fcrFilter, segment: opts.segment ?? null },
    tickets,
    ticketTotal: filtered.length,
    allDestinations: matrixDests,
  };
  return { ...partial, insights: buildInsights(partial) };
}
