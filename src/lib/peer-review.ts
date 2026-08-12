import { getSupabaseClient } from "@/lib/supabase";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString } from "@/lib/manila-date";

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type PeerReviewCycleRaw = {
  enteredAt?: string;
  exitedAt?: string;
  exitedToStatus?: string;
  reviewer?: string;
};

type TicketRow = {
  issue_key: string;
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

/**
 * Mirrors gas/PeerReviewApi.gs's own looseness: GAS reads every RAW_ST_<year> tab the period's
 * years span (getRawRowsForYears_), not a tight per-row filter, since the JSON payload's cycle
 * dates aren't queryable at that granularity anyway — the exact enteredAt/exitedAt check happens
 * in JS regardless. Filtering by `created` year here gives Postgres a real bound without
 * pretending to be more precise than the source data allows.
 */
async function fetchPeerReviewTickets(startDate: string, endDate: string): Promise<TicketRow[]> {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));

  const { data, error } = await getSupabaseClient()
    .from("tickets")
    .select("issue_key,peer_review_cycles_json")
    .eq("team_key", "ST")
    .not("peer_review_cycles_json", "is", null)
    .gte("created", `${startYear}-01-01T00:00:00Z`)
    .lte("created", `${endYear}-12-31T23:59:59Z`);
  if (error) throw new Error(`Supabase tickets query failed: ${error.message}`);
  return (data ?? []) as TicketRow[];
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `peer-review-wait-report` route. Ported from
 * gas/PeerReviewApi.gs's getPeerReviewWaitReport_ — peer_review_cycles_json is jsonb in
 * Postgres, so it comes back already parsed (no JSON.parse needed, unlike the Sheets version).
 */
export async function getPeerReviewWaitReport(range: string, period: string): Promise<PeerReviewWaitReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchPeerReviewTickets(startDate, endDate);

    const byReviewer: Record<string, { reviewerName: string; cycleCount: number; sumWaitMinutes: number; maxWaitMinutes: number }> = {};
    const cycles: PeerReviewCycle[] = [];
    const inReview: PeerReviewInReview[] = [];

    for (const r of rows) {
      if (!r.peer_review_cycles_json) continue;

      for (const c of r.peer_review_cycles_json) {
        if (!c.enteredAt) continue;
        const enteredDate = toManilaDateString(c.enteredAt);
        if (!enteredDate || enteredDate < startDate || enteredDate > endDate) continue;

        if (!c.exitedAt) {
          inReview.push({ issueKey: r.issue_key, reviewer: c.reviewer || "", enteredAt: c.enteredAt });
          continue;
        }

        // Business rule only cares about exits to On Hold / For Checking — cycles that exit
        // some other way (e.g. cancelled) are still recorded by the extractor but excluded
        // here rather than dropped at extraction time, so no data is silently lost upstream.
        const exitedToStatus = (c.exitedToStatus || "").toLowerCase();
        if (exitedToStatus !== "on hold" && exitedToStatus !== "for checking") continue;

        const waitMinutes = round2((new Date(c.exitedAt).getTime() - new Date(c.enteredAt).getTime()) / 60000);
        const reviewer = c.reviewer || "(unassigned)";

        cycles.push({
          issueKey: r.issue_key,
          reviewer,
          enteredAt: c.enteredAt,
          exitedAt: c.exitedAt,
          exitedToStatus: c.exitedToStatus || "",
          waitMinutes,
        });

        if (!byReviewer[reviewer]) byReviewer[reviewer] = { reviewerName: reviewer, cycleCount: 0, sumWaitMinutes: 0, maxWaitMinutes: 0 };
        const b = byReviewer[reviewer];
        b.cycleCount++;
        b.sumWaitMinutes += waitMinutes;
        b.maxWaitMinutes = Math.max(b.maxWaitMinutes, waitMinutes);
      }
    }

    const byReviewerList: PeerReviewByReviewer[] = Object.values(byReviewer)
      .map((b) => ({
        reviewerName: b.reviewerName,
        cycleCount: b.cycleCount,
        avgWaitMinutes: round2(b.sumWaitMinutes / b.cycleCount),
        maxWaitMinutes: b.maxWaitMinutes,
      }))
      .sort((a, b) => b.avgWaitMinutes - a.avgWaitMinutes);

    return { team: "ST", range, period, byReviewer: byReviewerList, cycles, inReview };
  } catch {
    return { ...EMPTY_REPORT, range, period };
  }
}
