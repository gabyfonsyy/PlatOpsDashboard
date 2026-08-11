import { fetchGas } from "@/lib/gas-client";

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

/** Falls back to an empty report rather than throwing — same convention as getTicketMetrics. */
export async function getBacklogAgingReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<BacklogAgingReport> {
  return fetchGas<BacklogAgingReport>(
    "backlog-aging-report", { team, range, period, issueType }, { next: { revalidate: 300 } }
  ).catch(() => ({ ...EMPTY_REPORT, team, range, period, issueType: issueType ?? null }));
}
