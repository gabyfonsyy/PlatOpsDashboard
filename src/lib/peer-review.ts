import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString } from "@/lib/manila-date";
import { isExcludedIssueType } from "@/lib/teams";
import { classifyReviewCycle, UNASSIGNED_REVIEWER, type PeerReviewCycleRaw } from "@/lib/review-wait";

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


type TicketRow = {
  issue_key: string;
  issue_type: string | null;
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

/**
 * Every ST ticket that has ever been in review (~5k rows), filtered to the period by each cycle's
 * own enteredAt in JS below. This used to bound the query by the ticket's `created` year, which
 * silently dropped any review that happened in a later year than the ticket was created (e.g.
 * ST-66311: created 2025-03, reviewed 2026-07). `neq '[]'` is what keeps the fetch small — the
 * column is non-null on ~86k rows but a real array on only ~5k.
 */
async function fetchPeerReviewTickets(): Promise<TicketRow[]> {
  // Ordered by issue_key (the primary key) — MANDATORY for fetchAllRowsParallel's page offsets.
  return fetchAllRowsParallel<TicketRow>(
    (head) =>
      getSupabaseClient()
        .from("tickets")
        .select("issue_key,issue_type,peer_review_cycles_json", head ? { count: "exact", head: true } : undefined)
        .eq("team_key", "ST")
        .not("peer_review_cycles_json", "is", null)
        .neq("peer_review_cycles_json", "[]"),
    "issue_key"
  );
}

/**
 * Ported from gas/PeerReviewApi.gs's getPeerReviewWaitReport_ cycle-walking loop. Shared by
 * getPeerReviewWaitReport (the dedicated drill-down) and lib/metrics.ts's getAssigneeMetrics
 * (the Performance Breakdown's per-reviewer Review Wait Time column) so both agree on exactly
 * which cycles count.
 *
 * Attribution is `reviewerAtEntry` ONLY, never `reviewer` — the same basis as the Incident Logs
 * validator (buildIncidentValidatorIndex_ in gas/IncidentsApi.gs), and deliberately with no
 * fallback so the two reports can never disagree about who reviewed a ticket. `reviewer` is the
 * assignee when the cycle CLOSED, which is usually whoever picked the ticket up at the NEXT stage:
 * on ST-84873 Jasper Razo reviewed it but `reviewer` names Angelo Nico Ravilas, who was never the
 * reviewer at all. Falling back to `reviewer` when reviewerAtEntry is missing would reintroduce
 * exactly that error, invisibly and for the majority of rows, so a cycle without the field is
 * reported as "(unassigned)" instead.
 *
 * That means this metric depends on the field being populated. Only tickets re-synced since
 * extractPeerReviewCyclesWithReviewer_ started emitting reviewerAtEntry carry it, and ordinary
 * incremental sync only revisits tickets Jira has touched — run runStPeerReviewRebackfill
 * (gas/Backfill.gs) to re-derive the history, which is what that function is there for.
 */
export async function getCompletedPeerReviewCycles(
  range: string,
  period: string
): Promise<{ cycles: PeerReviewCycle[]; inReview: PeerReviewInReview[] }> {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const rows = await fetchPeerReviewTickets();

  const cycles: PeerReviewCycle[] = [];
  const inReview: PeerReviewInReview[] = [];

  for (const r of rows) {
    if (!r.peer_review_cycles_json) continue;
    // Technical Story is out of every SE metric (lib/teams.ts's excludedIssueTypes) — Cycle Time
    // already skipped it, this report didn't.
    if (isExcludedIssueType("ST", r.issue_type)) continue;

    for (const c of r.peer_review_cycles_json) {
      const enteredDate = toManilaDateString(c.enteredAt);
      if (!enteredDate || enteredDate < startDate || enteredDate > endDate) continue;

      // Shared with the Review Wait deep-dive (lib/review-wait.ts): a completed review exits to
      // On Hold, For Checking, Archived or Rejected. Other exits (For Execution, For Product Team)
      // and bad timestamps are real rows the deep-dive reports under Data Quality, not here.
      const { kind, waitMinutes } = classifyReviewCycle(c);
      if (kind === "open") {
        inReview.push({ issueKey: r.issue_key, reviewer: c.reviewerAtEntry || "", enteredAt: c.enteredAt! });
        continue;
      }
      if (kind !== "completed") continue;

      cycles.push({
        issueKey: r.issue_key,
        reviewer: c.reviewerAtEntry || UNASSIGNED_REVIEWER,
        enteredAt: c.enteredAt!,
        exitedAt: c.exitedAt!,
        exitedToStatus: c.exitedToStatus || "",
        waitMinutes: waitMinutes!,
      });
    }
  }

  return { cycles, inReview };
}

export function aggregateByReviewer(cycles: PeerReviewCycle[]): PeerReviewByReviewer[] {
  const byReviewer: Record<string, { reviewerName: string; cycleCount: number; sumWaitMinutes: number; maxWaitMinutes: number }> = {};
  for (const c of cycles) {
    if (!byReviewer[c.reviewer]) byReviewer[c.reviewer] = { reviewerName: c.reviewer, cycleCount: 0, sumWaitMinutes: 0, maxWaitMinutes: 0 };
    const b = byReviewer[c.reviewer];
    b.cycleCount++;
    b.sumWaitMinutes += c.waitMinutes;
    b.maxWaitMinutes = Math.max(b.maxWaitMinutes, c.waitMinutes);
  }
  return Object.values(byReviewer)
    .map((b) => ({
      reviewerName: b.reviewerName,
      cycleCount: b.cycleCount,
      avgWaitMinutes: round2(b.sumWaitMinutes / b.cycleCount),
      maxWaitMinutes: b.maxWaitMinutes,
    }))
    .sort((a, b) => b.avgWaitMinutes - a.avgWaitMinutes);
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `peer-review-wait-report` route. Ported from
 * gas/PeerReviewApi.gs's getPeerReviewWaitReport_ — peer_review_cycles_json is jsonb in
 * Postgres, so it comes back already parsed (no JSON.parse needed, unlike the Sheets version).
 */
export async function getPeerReviewWaitReport(range: string, period: string): Promise<PeerReviewWaitReport> {
  try {
    const { cycles, inReview } = await getCompletedPeerReviewCycles(range, period);
    const byReviewer = aggregateByReviewer(cycles);
    return { team: "ST", range, period, byReviewer, cycles, inReview };
  } catch (err) {
    console.error("[getPeerReviewWaitReport] failed:", err);
    return { ...EMPTY_REPORT, range, period };
  }
}
