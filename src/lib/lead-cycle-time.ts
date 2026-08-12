import { getSupabaseClient } from "@/lib/supabase";
import { getTeams, backlogAgingAssignee, backlogAgingAssigneeLabel } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";

export type LeadCycleTimeMetric = "lead" | "cycle";

export type LeadCycleTimeTicket = {
  issueKey: string;
  issueType: string;
  /** The team's configured owner — Assigned COD for DBA/DevOps. */
  assignee: string;
  product: string;
  labels: string;
  minutes: number;
  createdAt: string;
  /** "" for Lead Time (not applicable — Lead Time starts at creation). */
  startedAt: string;
  resolvedAt: string;
};

export type LeadCycleTimeRankRow = { key: string; avgMinutes: number; count: number };

export type LeadCycleTimeReport = {
  team: string;
  range: string;
  period: string;
  metric: LeadCycleTimeMetric;
  issueType: string | null;
  /** Column header for ranked-by-assignee — "Assigned COD" or "Assigned SE", per the team's config. */
  assigneeLabel: string;
  count: number;
  avgMinutes: number | null;
  topTickets: LeadCycleTimeTicket[];
  byAssignee: LeadCycleTimeRankRow[];
  byProduct: LeadCycleTimeRankRow[];
  byLabel: LeadCycleTimeRankRow[];
};

const EMPTY_REPORT: LeadCycleTimeReport = {
  team: "", range: "month", period: "", metric: "lead", issueType: null, assigneeLabel: "Assignee",
  count: 0, avgMinutes: null, topTickets: [], byAssignee: [], byProduct: [], byLabel: [],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type TicketRow = {
  issue_key: string;
  issue_type: string | null;
  created: string;
  first_out_of_backlog_todo: string | null;
  resolved_datetime: string;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
};

/** Same coarse-UTC-prefilter + exact-Manila-day-check split as lib/backlog-aging.ts. */
async function fetchResolvedTickets(teamKey: string, startDate: string, endDate: string, issueType?: string): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  let query = getSupabaseClient()
    .from("tickets")
    .select("issue_key,issue_type,created,first_out_of_backlog_todo,resolved_datetime,product,labels,assigned_se,assigned_cod")
    .eq("team_key", teamKey)
    .not("resolved_datetime", "is", null)
    .gte("resolved_datetime", rangeStartUtc.toISOString())
    .lte("resolved_datetime", rangeEndUtc.toISOString());
  if (issueType) query = query.eq("issue_type", issueType);

  const { data, error } = await query;
  if (error) throw new Error(`Supabase tickets query failed: ${error.message}`);
  return (data ?? []) as TicketRow[];
}

function rankBy(withDuration: { row: TicketRow; minutes: number }[], keyFn: (r: TicketRow) => string): LeadCycleTimeRankRow[] {
  const buckets: Record<string, { sum: number; count: number }> = {};
  for (const x of withDuration) {
    const key = keyFn(x.row);
    if (!key) continue;
    if (!buckets[key]) buckets[key] = { sum: 0, count: 0 };
    buckets[key].sum += x.minutes;
    buckets[key].count++;
  }
  return Object.entries(buckets)
    .map(([key, b]) => ({ key, avgMinutes: round2(b.sum / b.count), count: b.count }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes);
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `lead-cycle-time-report` route. Ported from
 * gas/LeadCycleTimeApi.gs's getLeadCycleTimeDrilldownReport_.
 */
export async function getLeadCycleTimeReport(
  team: string,
  range: string,
  period: string,
  metric: LeadCycleTimeMetric,
  issueType?: string
): Promise<LeadCycleTimeReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    const rows = await fetchResolvedTickets(team, startDate, endDate, issueType);

    const durationMinutesFor = (r: TicketRow): number | null => {
      if (!r.resolved_datetime) return null;
      if (metric === "cycle") {
        if (!r.first_out_of_backlog_todo) return null;
        return minutesBetween(r.first_out_of_backlog_todo, r.resolved_datetime);
      }
      if (!r.created) return null;
      return minutesBetween(r.created, r.resolved_datetime);
    };

    const withDuration = rows
      .filter((r) => {
        const resolvedIso = toManilaDateString(r.resolved_datetime);
        return resolvedIso && resolvedIso >= startDate && resolvedIso <= endDate;
      })
      .map((r) => ({ row: r, minutes: durationMinutesFor(r) }))
      .filter((x): x is { row: TicketRow; minutes: number } => x.minutes !== null && isFinite(x.minutes));

    const topTickets: LeadCycleTimeTicket[] = withDuration
      .slice()
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)
      .map((x) => ({
        issueKey: x.row.issue_key,
        issueType: x.row.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, x.row) || "(unassigned)",
        product: x.row.product || "(none)",
        labels: x.row.labels || "",
        minutes: round2(x.minutes),
        createdAt: x.row.created,
        startedAt: x.row.first_out_of_backlog_todo || "",
        resolvedAt: x.row.resolved_datetime,
      }));

    const byAssignee = rankBy(withDuration, (r) => backlogAgingAssignee(teamConfig, r) || "(unassigned)");
    const byProduct = rankBy(withDuration, (r) => r.product || "(none)");

    // Labels: a ticket's labels are a CSV of tags — expand to individual tokens and attribute
    // this ticket's duration to each one, excluding department/team tags like se-ops, hr-ops,
    // payroll-ops (anything containing "-ops") since those aren't a meaningful task classification.
    const labelBuckets: Record<string, { sum: number; count: number }> = {};
    for (const x of withDuration) {
      const labels = (x.row.labels || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const label of labels) {
        if (label.toLowerCase().includes("-ops")) continue;
        if (!labelBuckets[label]) labelBuckets[label] = { sum: 0, count: 0 };
        labelBuckets[label].sum += x.minutes;
        labelBuckets[label].count++;
      }
    }
    const byLabel = Object.entries(labelBuckets)
      .map(([key, b]) => ({ key, avgMinutes: round2(b.sum / b.count), count: b.count }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes);

    return {
      team, range, period, metric, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      count: withDuration.length,
      avgMinutes: withDuration.length
        ? round2(withDuration.reduce((sum, x) => sum + x.minutes, 0) / withDuration.length)
        : null,
      topTickets,
      byAssignee,
      byProduct,
      byLabel,
    };
  } catch {
    return { ...EMPTY_REPORT, team, range, period, metric, issueType: issueType ?? null };
  }
}
