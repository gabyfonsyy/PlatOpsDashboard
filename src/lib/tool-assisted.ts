import { fetchGas } from "@/lib/gas-client";

export type ToolAssistedTicket = {
  issueKey: string;
  issueType: string;
  assignee: string;
  labels: string;
  hasLabel: boolean;
  created: string;
  todoExitAt: string;
  peerReviewAt: string;
  cycleTimeMinutes: number;
};

export type ToolAssistedReport = {
  team: string;
  range: string;
  period: string;
  label: string;
  toolAssisted: { count: number; avgCycleTimeMinutes: number | null; tickets: ToolAssistedTicket[] };
  others: { count: number; avgCycleTimeMinutes: number | null };
};

const EMPTY_REPORT: ToolAssistedReport = {
  team: "ST", range: "month", period: "", label: "tool-assisted",
  toolAssisted: { count: 0, avgCycleTimeMinutes: null, tickets: [] },
  others: { count: 0, avgCycleTimeMinutes: null },
};

/** Falls back to an empty report rather than throwing — same convention as getLatePickupReport. */
export async function getToolAssistedCycleTimeReport(range: string, period: string): Promise<ToolAssistedReport> {
  return fetchGas<ToolAssistedReport>("tool-assisted-cycle-time", { range, period }, { next: { revalidate: 300 } })
    .catch(() => ({ ...EMPTY_REPORT, range, period }));
}
