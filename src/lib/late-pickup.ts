import { fetchGas } from "@/lib/gas-client";

export type LatePickupTicket = {
  issueKey: string;
  seName: string;
  created: string;
  day1End: string;
  day2End: string;
  pickedUpAt: string;
  isLate: boolean;
  isOverdue: boolean;
  resolvedDatetime: string | null;
};

export type LatePickupAtRiskTicket = {
  issueKey: string;
  seName: string;
  created: string;
  day1End: string;
};

export type LatePickupBySe = {
  seName: string;
  lateCount: number;
  lateAndOverdueCount: number;
};

export type LatePickupReport = {
  team: string;
  range: string;
  period: string;
  issueType: string;
  bySe: LatePickupBySe[];
  tickets: LatePickupTicket[];
  atRisk: LatePickupAtRiskTicket[];
};

const EMPTY_REPORT: LatePickupReport = {
  team: "ST", range: "month", period: "", issueType: "Account Creation",
  bySe: [], tickets: [], atRisk: [],
};

/** Falls back to an empty report rather than throwing — same convention as getTicketMetrics/getAssigneeMetrics in metrics.ts. */
export async function getLatePickupReport(range: string, period: string): Promise<LatePickupReport> {
  return fetchGas<LatePickupReport>("late-pickup-report", { range, period }, { next: { revalidate: 300 } })
    .catch(() => ({ ...EMPTY_REPORT, range, period }));
}
