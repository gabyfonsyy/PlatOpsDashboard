import { fetchGas } from "@/lib/gas-client";

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

/** Falls back to an empty report rather than throwing — same convention as getBacklogAgingReport. */
export async function getLeadCycleTimeReport(
  team: string,
  range: string,
  period: string,
  metric: LeadCycleTimeMetric,
  issueType?: string
): Promise<LeadCycleTimeReport> {
  return fetchGas<LeadCycleTimeReport>(
    "lead-cycle-time-report", { team, range, period, metric, issueType }, { next: { revalidate: 300 } }
  ).catch(() => ({ ...EMPTY_REPORT, team, range, period, metric, issueType: issueType ?? null }));
}
