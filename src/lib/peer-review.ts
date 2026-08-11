import { fetchGas } from "@/lib/gas-client";

export type PeerReviewCycle = {
  issueKey: string;
  reviewer: string;
  enteredAt: string;
  exitedAt: string;
  exitedToStatus: string;
  waitMinutes: number;
};

export type PeerReviewInReview = {
  issueKey: string;
  reviewer: string;
  enteredAt: string;
};

export type PeerReviewByReviewer = {
  reviewerName: string;
  cycleCount: number;
  avgWaitMinutes: number;
  maxWaitMinutes: number;
};

export type PeerReviewWaitReport = {
  team: string;
  range: string;
  period: string;
  byReviewer: PeerReviewByReviewer[];
  cycles: PeerReviewCycle[];
  inReview: PeerReviewInReview[];
};

const EMPTY_REPORT: PeerReviewWaitReport = {
  team: "ST", range: "month", period: "",
  byReviewer: [], cycles: [], inReview: [],
};

/** Falls back to an empty report rather than throwing — same convention as getTicketMetrics/getAssigneeMetrics in metrics.ts. */
export async function getPeerReviewWaitReport(range: string, period: string): Promise<PeerReviewWaitReport> {
  return fetchGas<PeerReviewWaitReport>("peer-review-wait-report", { range, period }, { next: { revalidate: 300 } })
    .catch(() => ({ ...EMPTY_REPORT, range, period }));
}
