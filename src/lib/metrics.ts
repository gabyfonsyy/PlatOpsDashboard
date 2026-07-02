import { fetchGas } from "@/lib/gas-client";

export type TicketMetrics = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  leadTimeAvgMinutes: number | null;
  cycleTimeAvgMinutes: number | null;
  fcrRate: number | null;
  escalationRate: number | null;
  backlogAgingRate: number | null;
  ticketVolume: number;
  ticketsCreated: number;
  ticketsResolved: number;
  holdingReasonBreakdown: { reason: string; count: number }[];
  rejectionCategoryBreakdown: { category: string; count: number }[];
  cancellationReasonBreakdown: { reason: string; count: number }[];
  onHoldAvgPickupMinutes: number | null;
  series: { date: string; created: number; resolved: number; leadTimeAvgMinutes: number | null }[];
};

export type AssigneeMetric = {
  name: string;
  ticketsAssigned: number;
  ticketsResolved: number;
  escalationRate: number | null;
  fcrRate: number | null;
  backlogAgingRate: number | null;
  avgLeadTimeMinutes: number | null;
  avgCycleTimeMinutes: number | null;
  flags: string[];
};

export type InsightFlag = { employee: string; metric: string; severity: string; detail: string; code?: string };

export type CachedInsight = {
  scope: string;
  period: string;
  narrative: string;
  flags: InsightFlag[];
  generatedAt: string;
  status: "SUCCESS" | "FAILED";
} | null;

const EMPTY_METRICS: TicketMetrics = {
  team: "", range: "month", period: "", issueType: null,
  leadTimeAvgMinutes: null, cycleTimeAvgMinutes: null, fcrRate: null,
  escalationRate: null, backlogAgingRate: null, ticketVolume: 0,
  ticketsCreated: 0, ticketsResolved: 0, holdingReasonBreakdown: [],
  rejectionCategoryBreakdown: [], cancellationReasonBreakdown: [],
  onHoldAvgPickupMinutes: null, series: [],
};

/** Falls back to empty metrics rather than throwing — GAS may not be deployed yet, or the period may have no data. */
export async function getTicketMetrics(team: string, range: string, period: string, issueType?: string): Promise<TicketMetrics> {
  return fetchGas<TicketMetrics>("metrics", { team, range, period, issueType }, { next: { revalidate: 300 } })
    .catch(() => ({ ...EMPTY_METRICS, team, range, period, issueType: issueType ?? null }));
}

export async function getAssigneeMetrics(team: string, range: string, period: string): Promise<{ team: string; period: string; assignees: AssigneeMetric[] }> {
  return fetchGas<{ team: string; period: string; assignees: AssigneeMetric[] }>(
    "assignee-metrics", { team, range, period }, { next: { revalidate: 300 } }
  ).catch(() => ({ team, period, assignees: [] as AssigneeMetric[] }));
}

export async function getInsight(scope: string): Promise<CachedInsight> {
  return fetchGas<CachedInsight>("insight", { scope }, { next: { revalidate: 300 } }).catch(() => null);
}
