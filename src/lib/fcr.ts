import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { getTeams, excludedIssueTypes, isExcludedIssueType, backlogAgingAssignee, backlogAgingAssigneeLabel } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { shiftPeriod, type RangeType } from "@/lib/date-ranges";
import { toManilaDateString } from "@/lib/manila-date";
import { basisFor } from "@/lib/lead-cycle-time";
import { isRealEscalation, escalationTargets, meaningfulLabels, BREAKDOWN_TICKET_LIMIT } from "@/lib/ticket-breakdowns";
import { defaultGrainFor, bucketKey, enumerateBuckets, type ReviewWaitGrain } from "@/lib/review-wait";
import type { KpiBaselineRow } from "@/lib/kpi-baselines";
import type { Insight } from "@/components/dashboard/InsightsPanel";
import { median } from "@/lib/stats";

/**
 * FCR Rate deep-dive (SE Team Stats item 2). Definition, unchanged from the scorecard:
 *
 *   FCR Rate = tickets with First Contact Resolution = Yes ÷ tickets resolved in the period
 *
 * by RESOLVED date (Manila day), so an unresolved ticket can never reach the denominator. One
 * deliberate refinement (Gaby, 2026-10-01): a BLANK FCR value is "unknown", not "No" — it is left
 * out of both sides and surfaced under Data quality instead of silently lowering the rate.
 * Archived and Rejected tickets stay in (they are resolved, and the stored baseline includes them).
 */

// ------------------------------------------------------------------------------ Definition

export type FcrValue = "Yes" | "No" | "Unknown";

/** Case/whitespace-insensitive: Jira only ever writes "Yes"/"No", but a blank must not read as No. */
export function fcrValueOf(raw: string | null | undefined): FcrValue {
  const v = (raw || "").trim().toLowerCase();
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "Unknown";
}

/** Below this many known tickets the headline shows "Small sample". */
export const HEADLINE_SMALL_SAMPLE = 30;
/** Below this many tickets a segment row is marked small and can be hidden by the min-sample filter. */
export const SEGMENT_SMALL_SAMPLE = 10;
/** Minimum tickets for a combination to count as an opportunity. */
const OPPORTUNITY_MIN = 10;

// ------------------------------------------------------------------------------ Types

export type FcrCounts = {
  /** Yes + No — the denominator. */
  resolved: number;
  fcr: number;
  nonFcr: number;
  rate: number | null;
  /** Blank FCR value — excluded from the rate. */
  unknown: number;
  /** Every ticket resolved in the period, unknown included. */
  resolvedAll: number;
};

export type FcrSegmentDimension = "se" | "issueType" | "reporter" | "priority" | "product" | "month" | "week" | "dow";

export type FcrSegmentRow = {
  key: string;
  resolved: number;
  fcr: number;
  nonFcr: number;
  rate: number | null;
  /** This segment's tickets ÷ all known tickets in the period. */
  volumeShare: number;
  /** This segment's non-FCR ÷ all non-FCR in the period — its share of the repeat work. */
  nonFcrShare: number;
  previous: { resolved: number; rate: number | null } | null;
  /** Percentage points, current - previous. Null when either side is missing. */
  deltaPts: number | null;
  smallSample: boolean;
};

export type FcrOpportunityRow = {
  product: string;
  label: string;
  resolved: number;
  nonFcr: number;
  rate: number | null;
  previousRate: number | null;
  /** nonFcr minus what the team-wide rate would predict — repeat work beyond the norm. */
  excessNonFcr: number;
  /** Below the team rate in BOTH this period and the previous one (previous needs 5+ tickets). */
  consistentlyLower: boolean;
  /** Where its non-FCR tickets most often went (escalation target). */
  topTarget: string | null;
};

export type FcrTrendPoint = { bucket: string; resolved: number; fcr: number; rate: number | null };

export type FcrTicket = {
  issueKey: string;
  issueType: string;
  assignedSe: string;
  reporter: string;
  product: string;
  priority: string;
  createdAt: string;
  /** first_out_of_backlog_todo — the closest synced field to "first response". */
  firstContactAt: string | null;
  resolvedAt: string;
  fcr: FcrValue;
  status: string;
  /** Archive reason / rejection category when the ticket ended that way. */
  outcomeReason: string;
  escalatedTo: string;
  leadMinutes: number | null;
  cycleMinutes: number | null;
};

export type FcrRelated = {
  escalationRate: number | null;
  escalated: number;
  leadMedianMinutes: number | null;
  cycleAvgMinutes: number | null;
  /** SE / Rejected / Archived share of the population, so the Archived+Rejected inclusion is visible. */
  archivedRejected: { count: number; fcrYes: number };
};

export type FcrDataQuality = {
  unknownCount: number;
  unknownTickets: FcrTicket[];
  /** FCR = Yes but escalated outside the team — the two fields disagree. */
  escalatedButFcrYes: FcrTicket[];
  escalatedButFcrYesCount: number;
  /** FCR = No but never escalated — follow-up stayed in-team, or the flag is wrong. */
  noButNotEscalatedCount: number;
};

export type FcrTicketFilter = { fcr: FcrValue | null; segment: { dim: FcrSegmentDimension; key: string } | null };

export type FcrDeepDiveReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  grain: ReviewWaitGrain;
  assigneeLabel: string;
  current: FcrCounts;
  previous: (FcrCounts & { period: string }) | null;
  baseline: { rate: number | null; sampleCount: number; periodLabel: string } | null;
  smallSample: boolean;
  segments: Record<FcrSegmentDimension, FcrSegmentRow[]>;
  /** Non-FCR tickets by escalation target — where the repeat work went. */
  nonFcrTargets: { key: string; count: number; share: number }[];
  opportunities: FcrOpportunityRow[];
  trend: FcrTrendPoint[];
  related: FcrRelated;
  dataQuality: FcrDataQuality;
  insights: Insight[];
  ticketFilter: FcrTicketFilter;
  tickets: FcrTicket[];
  ticketTotal: number;
};

// ------------------------------------------------------------------------------ Helpers

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
const rateOf = (fcr: number, resolved: number) => (resolved ? round4(fcr / resolved) : null);
const ptsOf = (cur: number | null, prev: number | null) => (cur === null || prev === null ? null : Math.round((cur - prev) * 1000) / 10);

// ------------------------------------------------------------------------------ Fetch

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
  archive_reason: string | null;
  rejection_category: string | null;
};

const FULL_SELECT =
  "issue_key,issue_type,status,fcr_value,escalation_value,priority,product,labels,assigned_se,assigned_cod," +
  "reporter_display_name,created,resolved_datetime,first_out_of_backlog_todo,cycle_time_start,cycle_time_end," +
  "archive_reason,rejection_category";

/** For the previous period and the scorecard: enough to count and to segment. */
const NARROW_SELECT = "issue_key,issue_type,fcr_value,priority,product,labels,assigned_se,assigned_cod,reporter_display_name,resolved_datetime";

/** Resolved in [startDate, endDate] by Manila day — the same split as lib/ticket-breakdowns.ts. */
export async function fetchResolved<T extends { resolved_datetime: string; issue_type: string | null }>(
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

export function countsOf(rows: { fcr_value: string | null }[]): FcrCounts {
  let fcr = 0;
  let nonFcr = 0;
  let unknown = 0;
  for (const r of rows) {
    const v = fcrValueOf(r.fcr_value);
    if (v === "Yes") fcr++;
    else if (v === "No") nonFcr++;
    else unknown++;
  }
  const resolved = fcr + nonFcr;
  return { resolved, fcr, nonFcr, rate: rateOf(fcr, resolved), unknown, resolvedAll: rows.length };
}

// ------------------------------------------------------------------------------ Segments

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type SegRow = Pick<Row, "issue_type" | "priority" | "product" | "assigned_se" | "assigned_cod" | "reporter_display_name" | "resolved_datetime" | "fcr_value">;

export function segmentKey(dim: FcrSegmentDimension, r: SegRow, team: Parameters<typeof backlogAgingAssignee>[0]): string {
  switch (dim) {
    case "se":
      return backlogAgingAssignee(team, r).trim() || "(unassigned)";
    case "issueType":
      return r.issue_type || "(none)";
    case "reporter":
      return (r.reporter_display_name || "").trim() || "(none)";
    case "priority":
      return r.priority || "(none)";
    case "product":
      return r.product || "(none)";
    case "month":
      return toManilaDateString(r.resolved_datetime)!.slice(0, 7);
    case "week":
      return bucketKey("week", toManilaDateString(r.resolved_datetime)!);
    case "dow": {
      const d = new Date(`${toManilaDateString(r.resolved_datetime)!}T00:00:00Z`).getUTCDay();
      const idx = (d + 6) % 7;
      return `${idx + 1} · ${DOW[idx]}`;
    }
  }
}

const TIME_DIMS: FcrSegmentDimension[] = ["month", "week", "dow"];

function segmentBy(
  dim: FcrSegmentDimension,
  rows: SegRow[],
  prevRows: SegRow[] | null,
  team: Parameters<typeof backlogAgingAssignee>[0],
  totals: FcrCounts
): FcrSegmentRow[] {
  const group = (rs: SegRow[]) => {
    const m = new Map<string, SegRow[]>();
    for (const r of rs) {
      if (fcrValueOf(r.fcr_value) === "Unknown") continue;
      const k = segmentKey(dim, r, team);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const cur = group(rows);
  // Time buckets have no meaningful "same bucket last period".
  const prev = prevRows && !TIME_DIMS.includes(dim) ? group(prevRows) : null;
  const out = Array.from(cur.entries()).map(([key, rs]) => {
    const c = countsOf(rs);
    const p = prev ? countsOf(prev.get(key) ?? []) : null;
    const previous = p ? { resolved: p.resolved, rate: p.rate } : null;
    return {
      key,
      resolved: c.resolved,
      fcr: c.fcr,
      nonFcr: c.nonFcr,
      rate: c.rate,
      volumeShare: totals.resolved ? round4(c.resolved / totals.resolved) : 0,
      nonFcrShare: totals.nonFcr ? round4(c.nonFcr / totals.nonFcr) : 0,
      previous,
      deltaPts: previous && previous.resolved > 0 ? ptsOf(c.rate, previous.rate) : null,
      smallSample: c.resolved < SEGMENT_SMALL_SAMPLE,
    };
  });
  if (TIME_DIMS.includes(dim)) return out.sort((a, b) => a.key.localeCompare(b.key));
  return out.sort((a, b) => b.resolved - a.resolved || a.key.localeCompare(b.key));
}

// ------------------------------------------------------------------------------ Insights

function pct(n: number | null, digits = 1): string {
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
}
function pts(n: number): string {
  return `${n > 0 ? "+" : ""}${n} pts`;
}

function buildInsights(r: Omit<FcrDeepDiveReport, "insights">): Insight[] {
  const out: Insight[] = [];
  const c = r.current;
  if (!c.resolved) return out;
  const p = r.previous;

  if (p && p.rate !== null && c.rate !== null && p.resolved > 0) {
    const d = ptsOf(c.rate, p.rate)!;
    const volUp = c.resolved > p.resolved;
    const volText = `resolved volume ${volUp ? "rose" : c.resolved < p.resolved ? "fell" : "held"} ${p.resolved} → ${c.resolved}`;
    if (Math.abs(d) >= 0.5) {
      const up = d > 0;
      out.push({
        tone: up ? "positive" : "negative",
        text: {
          professional: `FCR ${up ? "rose" : "fell"} ${pct(p.rate)} → ${pct(c.rate)} (${pts(d)}) while ${volText}. First-contact tickets went ${p.fcr} → ${c.fcr}; follow-ups ${p.nonFcr} → ${c.nonFcr}.`,
          gaby: `**FCR ${up ? "up" : "down"} ${Math.abs(d)} pts** (${pct(p.rate)} → ${pct(c.rate)}). Volume ${p.resolved} → ${c.resolved}; follow-ups ${p.nonFcr} → ${c.nonFcr}.`,
        },
      });
    } else {
      out.push({
        tone: "watch",
        text: {
          professional: `FCR is steady at ${pct(c.rate)} (previous ${pct(p.rate)}) while ${volText}.`,
          gaby: `**FCR is holding steady** at ${pct(c.rate)} — volume ${p.resolved} → ${c.resolved}.`,
        },
      });
    }
  }

  if (r.baseline && r.baseline.rate !== null && c.rate !== null) {
    const d = ptsOf(c.rate, r.baseline.rate)!;
    if (Math.abs(d) >= 1) {
      out.push({
        tone: d > 0 ? "positive" : "watch",
        text: {
          professional: `${pct(c.rate)} is ${Math.abs(d)} pts ${d > 0 ? "above" : "below"} the ${r.baseline.periodLabel} baseline (${pct(r.baseline.rate)}).`,
          gaby: `**${d > 0 ? "Above" : "Below"} baseline by ${Math.abs(d)} pts** — ${pct(c.rate)} vs ${pct(r.baseline.rate)} in ${r.baseline.periodLabel}.`,
        },
      });
    }
  }

  const topType = r.segments.issueType.slice().sort((a, b) => b.nonFcr - a.nonFcr)[0];
  if (topType && topType.nonFcr > 0 && c.nonFcr >= 5) {
    out.push({
      tone: "watch",
      text: {
        professional: `${topType.key} accounts for ${pct(topType.nonFcrShare, 0)} of follow-up tickets (${topType.nonFcr} of ${c.nonFcr}) at ${pct(topType.rate)} FCR.`,
        gaby: `**Most follow-ups come from ${topType.key}** — ${topType.nonFcr} of ${c.nonFcr} (${pct(topType.nonFcrShare, 0)}).`,
      },
    });
  }

  const target = r.nonFcrTargets[0];
  if (target && c.nonFcr >= 5) {
    out.push({
      tone: "watch",
      text: {
        professional: `${pct(target.share, 0)} of follow-up tickets were escalated to ${target.key} (${target.count}).`,
        gaby: `**${target.key} receives ${pct(target.share, 0)} of the follow-ups** (${target.count} tickets).`,
      },
    });
  }

  const opp = r.opportunities[0];
  if (opp && opp.excessNonFcr >= 3) {
    out.push({
      tone: "watch",
      text: {
        professional: `Biggest repeat-work opportunity: ${opp.product} · ${opp.label} — ${opp.nonFcr} follow-ups at ${pct(opp.rate)} FCR, about ${opp.excessNonFcr} more than the team rate would predict${opp.consistentlyLower ? ", and below the team rate last period too" : ""}.`,
        gaby: `**${opp.product} · ${opp.label} keeps coming back.** ${opp.nonFcr} follow-ups, ~${opp.excessNonFcr} above normal${opp.consistentlyLower ? " — two periods running" : ""}.`,
      },
    });
  }

  if (r.smallSample) {
    out.push({
      tone: "watch",
      text: {
        professional: `Small sample: ${c.resolved} resolved tickets. Treat the rate and the per-segment splits as rough.`,
        gaby: `**Small sample (${c.resolved} tickets)** — read the % lightly.`,
      },
    });
  }

  if (r.dataQuality.unknownCount > 0) {
    const n = r.dataQuality.unknownCount;
    out.push({
      tone: "watch",
      text: {
        professional: `${n} resolved ticket${n === 1 ? " has" : "s have"} no FCR value and ${n === 1 ? "is" : "are"} left out of the rate — see Data quality.`,
        gaby: `**${n} ticket${n === 1 ? "" : "s"} missing an FCR value** — not counted either way. See Data health check.`,
      },
    });
  }

  return out.slice(0, 6);
}

// ------------------------------------------------------------------------------ Main report

export type FcrOptions = {
  issueType?: string;
  grain?: ReviewWaitGrain;
  baseline?: KpiBaselineRow;
  /** Ticket-list filters (URL-driven so Overview → Breakdown → Tickets keeps the period). */
  fcr?: FcrValue | null;
  segment?: { dim: FcrSegmentDimension; key: string } | null;
};

export const FCR_SEGMENT_DIMENSIONS: FcrSegmentDimension[] = ["se", "issueType", "reporter", "priority", "product", "month", "week", "dow"];

export async function getFcrDeepDive(team: string, range: string, period: string, opts: FcrOptions = {}): Promise<FcrDeepDiveReport> {
  const teamConfig = (await getTeams()).find((t) => t.team_key === team);
  if (!teamConfig) throw new Error(`Unknown team: ${team}`);
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const grain = opts.grain ?? defaultGrainFor(range);
  const leadBasis = basisFor("lead", teamConfig.has_peer_review_tracking);
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
    prevRange ? fetchResolved<SegRow & { issue_key: string; labels: string | null }>(team, prevRange.startDate, prevRange.endDate, opts.issueType, NARROW_SELECT) : Promise.resolve(null),
  ]);

  const current = countsOf(rows);
  const previous = prevRows && prevPeriod ? { ...countsOf(prevRows), period: prevPeriod } : null;
  const baseline = opts.baseline && opts.baseline.value !== null
    ? { rate: Number(opts.baseline.value), sampleCount: opts.baseline.sample_count, periodLabel: opts.baseline.period_label }
    : null;

  // ---- Segments
  const segments = Object.fromEntries(
    FCR_SEGMENT_DIMENSIONS.map((dim) => [dim, segmentBy(dim, rows, prevRows, teamConfig, current)])
  ) as Record<FcrSegmentDimension, FcrSegmentRow[]>;

  // ---- Where non-FCR went
  const known = rows.filter((r) => fcrValueOf(r.fcr_value) !== "Unknown");
  const nonFcrRows = known.filter((r) => fcrValueOf(r.fcr_value) === "No");
  const targetCounts = new Map<string, number>();
  for (const r of nonFcrRows) {
    const targets = escalationTargets(r.escalation_value);
    const keys = targets.length ? targets : ["(not escalated)"];
    for (const k of keys) targetCounts.set(k, (targetCounts.get(k) || 0) + 1);
  }
  const nonFcrTargets = Array.from(targetCounts.entries())
    .map(([key, count]) => ({ key, count, share: nonFcrRows.length ? round4(count / nonFcrRows.length) : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  // ---- Opportunities: product × label combos with more repeat work than the team rate predicts
  const comboOf = (rs: { product: string | null; labels: string | null; fcr_value: string | null }[]) => {
    const m = new Map<string, { product: string; label: string; rows: typeof rs }>();
    for (const r of rs) {
      if (fcrValueOf(r.fcr_value) === "Unknown") continue;
      const product = r.product || "(none)";
      for (const label of meaningfulLabels(r.labels)) {
        const k = `${product}\u0000${label.toLowerCase()}`;
        if (!m.has(k)) m.set(k, { product, label, rows: [] });
        m.get(k)!.rows.push(r);
      }
    }
    return m;
  };
  const curCombos = comboOf(rows);
  const prevCombos = prevRows ? comboOf(prevRows) : new Map();
  const teamRate = current.rate ?? 0;
  const prevTeamRate = previous?.rate ?? null;
  const opportunities: FcrOpportunityRow[] = Array.from(curCombos.entries())
    .filter(([, v]) => v.rows.length >= OPPORTUNITY_MIN)
    .map(([k, v]) => {
      const c = countsOf(v.rows);
      const pc = prevCombos.get(k) ? countsOf(prevCombos.get(k)!.rows) : null;
      const tgt = new Map<string, number>();
      for (const r of v.rows as Row[]) {
        if (fcrValueOf(r.fcr_value) !== "No") continue;
        for (const t of escalationTargets(r.escalation_value)) tgt.set(t, (tgt.get(t) || 0) + 1);
      }
      const topTarget = Array.from(tgt.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        product: v.product,
        label: v.label,
        resolved: c.resolved,
        nonFcr: c.nonFcr,
        rate: c.rate,
        previousRate: pc && pc.resolved >= 5 ? pc.rate : null,
        excessNonFcr: Math.round(c.nonFcr - c.resolved * (1 - teamRate)),
        consistentlyLower:
          c.rate !== null && c.rate < teamRate && pc !== null && pc.resolved >= 5 && pc.rate !== null && prevTeamRate !== null && pc.rate < prevTeamRate,
        topTarget,
      };
    })
    .filter((o) => o.nonFcr > 0)
    .sort((a, b) => b.excessNonFcr - a.excessNonFcr || b.nonFcr - a.nonFcr)
    .slice(0, 12);

  // ---- Trend
  const buckets = enumerateBuckets(grain, startDate, endDate);
  const trendMap = new Map(buckets.map((b) => [b.key, { bucket: b.key, resolved: 0, fcr: 0, rate: null as number | null }]));
  for (const r of known) {
    const p = trendMap.get(bucketKey(grain, toManilaDateString(r.resolved_datetime)!));
    if (!p) continue;
    p.resolved++;
    if (fcrValueOf(r.fcr_value) === "Yes") p.fcr++;
  }
  const trend = Array.from(trendMap.values()).map((p) => ({ ...p, rate: rateOf(p.fcr, p.resolved) }));

  // ---- Tickets
  const finite = (n: number | null) => (n !== null && isFinite(n) ? round2(n) : null);
  const toTicket = (r: Row): FcrTicket => ({
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    assignedSe: backlogAgingAssignee(teamConfig, r).trim(),
    reporter: (r.reporter_display_name || "").trim(),
    product: r.product || "(none)",
    priority: r.priority || "",
    createdAt: r.created,
    firstContactAt: r.first_out_of_backlog_todo,
    resolvedAt: r.resolved_datetime,
    fcr: fcrValueOf(r.fcr_value),
    status: r.status || "",
    outcomeReason: (r.archive_reason || r.rejection_category || "").trim(),
    escalatedTo: escalationTargets(r.escalation_value).join(", "),
    leadMinutes: finite(leadBasis.duration(r)),
    cycleMinutes: finite(cycleBasis.duration(r)),
  });
  const byResolvedDesc = (a: Row, b: Row) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1);
  const filtered = rows.filter(
    (r) => (!opts.fcr || fcrValueOf(r.fcr_value) === opts.fcr) && (!opts.segment || segmentKey(opts.segment.dim, r, teamConfig) === opts.segment.key)
  );
  const tickets = filtered.slice().sort(byResolvedDesc).slice(0, BREAKDOWN_TICKET_LIMIT).map(toTicket);

  // ---- Related metrics, same population
  const escalated = rows.filter((r) => isRealEscalation(r.escalation_value)).length;
  const leads = rows.map((r) => leadBasis.duration(r)).filter((m): m is number => m !== null && isFinite(m));
  const cycles = rows.map((r) => cycleBasis.duration(r)).filter((m): m is number => m !== null && isFinite(m));
  const archRej = rows.filter((r) => ["archived", "rejected"].includes((r.status || "").trim().toLowerCase()));
  const related: FcrRelated = {
    escalationRate: rows.length ? round4(escalated / rows.length) : null,
    escalated,
    leadMedianMinutes: (() => {
      const m = median(leads);
      return m === null ? null : round2(m);
    })(),
    cycleAvgMinutes: cycles.length ? round2(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    archivedRejected: { count: archRej.length, fcrYes: archRej.filter((r) => fcrValueOf(r.fcr_value) === "Yes").length },
  };

  // ---- Data quality
  const unknownRows = rows.filter((r) => fcrValueOf(r.fcr_value) === "Unknown");
  const escYes = rows.filter((r) => isRealEscalation(r.escalation_value) && fcrValueOf(r.fcr_value) === "Yes");
  const dataQuality: FcrDataQuality = {
    unknownCount: unknownRows.length,
    unknownTickets: unknownRows.slice().sort(byResolvedDesc).slice(0, 100).map(toTicket),
    escalatedButFcrYes: escYes.slice().sort(byResolvedDesc).slice(0, 100).map(toTicket),
    escalatedButFcrYesCount: escYes.length,
    noButNotEscalatedCount: rows.filter((r) => fcrValueOf(r.fcr_value) === "No" && !isRealEscalation(r.escalation_value)).length,
  };

  const partial: Omit<FcrDeepDiveReport, "insights"> = {
    team,
    range,
    period,
    issueType: opts.issueType ?? null,
    grain,
    assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
    current,
    previous,
    baseline,
    smallSample: current.resolved > 0 && current.resolved < HEADLINE_SMALL_SAMPLE,
    segments,
    nonFcrTargets,
    opportunities,
    trend,
    related,
    dataQuality,
    ticketFilter: { fcr: opts.fcr ?? null, segment: opts.segment ?? null },
    tickets,
    ticketTotal: filtered.length,
  };
  return { ...partial, insights: buildInsights(partial) };
}

// ------------------------------------------------------------------------------ Scorecard

export type FcrScorecard = { current: FcrCounts; previous: FcrCounts | null; smallSample: boolean };

/** Team Stats card — the same countsOf over the same fetch as the deep-dive, so they agree. */
export async function getFcrScorecard(team: string, range: string, period: string, issueType?: string): Promise<FcrScorecard | null> {
  try {
    const cur = resolvePeriodToDateRange(range, period);
    let prev: { startDate: string; endDate: string } | null = null;
    try {
      prev = resolvePeriodToDateRange(range, shiftPeriod(range as RangeType, period, -1));
    } catch {
      prev = null;
    }
    const cols = "issue_key,issue_type,fcr_value,resolved_datetime";
    const [c, p] = await Promise.all([
      fetchResolved<{ issue_key: string; issue_type: string | null; fcr_value: string | null; resolved_datetime: string }>(team, cur.startDate, cur.endDate, issueType, cols),
      prev ? fetchResolved<{ issue_key: string; issue_type: string | null; fcr_value: string | null; resolved_datetime: string }>(team, prev.startDate, prev.endDate, issueType, cols) : Promise.resolve(null),
    ]);
    const current = countsOf(c);
    return { current, previous: p ? countsOf(p) : null, smallSample: current.resolved > 0 && current.resolved < HEADLINE_SMALL_SAMPLE };
  } catch (err) {
    console.error("[getFcrScorecard] failed:", err);
    return null;
  }
}

// ------------------------------------------------------------------------------ URL params

export function parseFcrFilter(v: string | undefined): FcrValue | null {
  return v === "Yes" || v === "No" || v === "Unknown" ? v : null;
}

export function parseSegmentFilter(v: string | undefined): { dim: FcrSegmentDimension; key: string } | null {
  if (!v) return null;
  const i = v.indexOf(":");
  if (i < 0) return null;
  const dim = v.slice(0, i) as FcrSegmentDimension;
  if (!FCR_SEGMENT_DIMENSIONS.includes(dim)) return null;
  return { dim, key: v.slice(i + 1) };
}
