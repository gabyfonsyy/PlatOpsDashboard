import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { minutesBetween, toManilaDateString } from "@/lib/manila-date";
import { isExcludedIssueType } from "@/lib/teams";
import { sumPeerReviewMinutes } from "@/lib/lead-cycle-time";

/**
 * Business Review Prep's Cycle Time for peer-review teams (SE) ONLY: END-TO-END Cycle Time =
 * Doer (out of Backlog/To Do -> reached review: cycle_time_start -> cycle_time_end) + Validator
 * (completed peer-review wait, sumPeerReviewMinutes — exits to On Hold / For Checking, pass-throughs
 * under a minute skipped). Same "average doer + average validator" the team-page Cycle Time card,
 * the Cycle Time deep-dive's headline and the Q1+Q2 cycle_time_total baseline all use
 * (getPeerReviewCycleAverages in lib/lead-cycle-time.ts), so Business Review and the dashboard
 * report one number.
 *
 * History: this file first used doer + validator, was then narrowed to the doer span only, and was
 * moved back to end-to-end on 2026-10-02 (Gaby: "SE Cycle Time should be the end-to-end cycle time,
 * not just doer").
 *
 * Kept as its own query (rather than calling getLeadCycleTimeAverages) because the driver breakdown
 * needs the same computation grouped by issue type, and both come from one fetch.
 *
 * Population: tickets whose cycle_time_end falls in the period (Manila day) — the same gate as
 * getPeerReviewCycleAverages. DBA/DevOps have no peer-review stage, so their single-stage
 * cycleTimeAvgMinutes (lib/metrics.ts) is already end-to-end and they don't use this file.
 */

type Row = {
  issue_key: string;
  issue_type: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string;
  peer_review_cycles_json: Parameters<typeof sumPeerReviewMinutes>[0];
};

const SELECT = "issue_key,issue_type,cycle_time_start,cycle_time_end,peer_review_cycles_json";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchCycleEndRows(teamKey: string, startDate: string, endDate: string, issueType?: string): Promise<Row[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  const rows = await fetchAllRowsParallel<Row>((head) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(SELECT, head ? { count: "exact", head: true } : undefined)
      .eq("team_key", teamKey)
      .not("cycle_time_end", "is", null)
      .gte("cycle_time_end", rangeStartUtc.toISOString())
      .lte("cycle_time_end", rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return q;
  }, "issue_key");

  return rows.filter((r) => {
    if (isExcludedIssueType(teamKey, r.issue_type)) return false;
    const iso = toManilaDateString(r.cycle_time_end);
    return iso !== null && iso >= startDate && iso <= endDate;
  });
}

/**
 * Average doer span + average validator wait, mirroring getPeerReviewCycleAverages exactly: the
 * doer average is over tickets with both span ends, the validator average over tickets that had a
 * completed review, and the record count is the doer count (falling back to the reviewed count).
 */
function endToEnd(rows: Row[]): { avgMinutes: number | null; count: number } {
  let actualSum = 0;
  let actualCount = 0;
  let reviewSum = 0;
  let reviewCount = 0;
  for (const r of rows) {
    if (r.cycle_time_start) {
      const m = minutesBetween(r.cycle_time_start, r.cycle_time_end);
      if (isFinite(m)) {
        actualSum += m;
        actualCount++;
      }
    }
    const review = sumPeerReviewMinutes(r.peer_review_cycles_json);
    if (review !== null) {
      reviewSum += review;
      reviewCount++;
    }
  }
  const actualAvg = actualCount ? actualSum / actualCount : null;
  const reviewAvg = reviewCount ? reviewSum / reviewCount : null;
  const avg = actualAvg !== null && reviewAvg !== null ? actualAvg + reviewAvg : actualAvg ?? reviewAvg;
  return { avgMinutes: avg === null ? null : round2(avg), count: actualCount || reviewCount };
}

export type CycleTimeResult = { avgMinutes: number | null; recordCount: number };

export type CycleTimeByIssueTypeRow = { issueType: string; count: number; avgMinutes: number };

/** End-to-end Cycle Time per issue type — feeds SE's Cycle Time driver breakdown. */
export async function getEndToEndCycleTimeByIssueType(teamKey: string, startDate: string, endDate: string): Promise<CycleTimeByIssueTypeRow[]> {
  const rows = await fetchCycleEndRows(teamKey, startDate, endDate);
  const byType = new Map<string, Row[]>();
  for (const r of rows) {
    const type = r.issue_type || "(none)";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(r);
  }
  const out: CycleTimeByIssueTypeRow[] = [];
  for (const [issueType, rs] of Array.from(byType.entries())) {
    const e = endToEnd(rs);
    if (e.avgMinutes !== null && e.count) out.push({ issueType, count: e.count, avgMinutes: e.avgMinutes });
  }
  return out;
}

export async function getEndToEndCycleTimeAverage(teamKey: string, startDate: string, endDate: string, issueType?: string): Promise<CycleTimeResult> {
  const e = endToEnd(await fetchCycleEndRows(teamKey, startDate, endDate, issueType));
  return { avgMinutes: e.avgMinutes, recordCount: e.count };
}
