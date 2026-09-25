import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { minutesBetween, toManilaDateString } from "@/lib/manila-date";
import { isExcludedIssueType } from "@/lib/teams";

/**
 * Business Review Prep's own Cycle Time average, for peer-review teams (SE) ONLY — per her
 * correction: the time from when a ticket moved out of Backlog/To Do to when it reached Archived,
 * Rejected, For Checking, or For Product Team (or, for backend-change types, For Peer Review —
 * the same hand-off, just named differently by work type). That span is EXACTLY what
 * `cycle_time_start`/`cycle_time_end` already store, per lib/lead-cycle-time.ts's basisFor's own
 * doc comment (`cycle (peer-review team): cycle_time_start -> cycle_time_end`) — no validator/
 * peer-review-wait time is added on top. (An earlier version of this file added the peer review
 * span too, per an initial "doer + validator" request that she then corrected — removed.)
 *
 * Deliberately a separate function rather than a call into lib/lead-cycle-time.ts's
 * getPeerReviewCycleAverages: that one BUNDLES this exact span average together with the peer-
 * review-wait average before returning (feeding the sitewide Cycle Time scorecard, which wants
 * the combined number), with no way for a caller to get just this piece back out. Duplicating the
 * query here — rather than exporting internals from that heavily-depended-on file — keeps this
 * feature's definition change from having any chance of affecting what every other page reports.
 * DBA/DevOps have no peer-review stage at all, so their existing single-stage cycleTimeAvgMinutes
 * (lib/metrics.ts) already measures the same kind of span — they don't need this function.
 *
 * Same population gate as getPeerReviewCycleAverages: bucketed by cycle_time_end falling in the
 * period (not resolution — a span that closed inside the period is what the period is reporting
 * on, independent of whether the ticket has since resolved), same coarse-UTC-widen +
 * exact-Manila-day-recheck split every other Phase-4 report in this codebase uses.
 */

type Row = {
  issue_key: string;
  issue_type: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string;
};

const SELECT = "issue_key,issue_type,cycle_time_start,cycle_time_end";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchCycleEndRows(teamKey: string, startDate: string, endDate: string, issueType?: string): Promise<Row[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRowsParallel<Row>((head) => {
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
}

export type CycleTimeResult = { avgMinutes: number | null; recordCount: number };

export type CycleTimeByIssueTypeRow = { issueType: string; count: number; avgMinutes: number };

/**
 * The same end-to-end Cycle Time average as getEndToEndCycleTimeAverage above, grouped by issue
 * type instead of collapsed to one number — feeds buildDurationDriver (lib/business-review-drivers.ts)
 * for SE's Cycle Time driver breakdown. Deliberately its own query, same reasoning as the rest of
 * this file: keeps SE Cycle Time's definition (here, in both its headline and its driver) isolated
 * from lib/lead-cycle-time.ts's basisFor, which lib/business-review.ts uses for every OTHER
 * Lead/Cycle Time driver (every team's Lead Time, and DBA/DevOps's Cycle Time).
 */
export async function getEndToEndCycleTimeByIssueType(
  teamKey: string,
  startDate: string,
  endDate: string
): Promise<CycleTimeByIssueTypeRow[]> {
  const rows = (await fetchCycleEndRows(teamKey, startDate, endDate)).filter((r) => {
    if (isExcludedIssueType(teamKey, r.issue_type)) return false;
    const iso = toManilaDateString(r.cycle_time_end);
    return iso !== null && iso >= startDate && iso <= endDate;
  });

  const byType = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.cycle_time_start) continue;
    const type = r.issue_type || "(none)";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(minutesBetween(r.cycle_time_start, r.cycle_time_end));
  }
  return Array.from(byType.entries()).map(([issueType, values]) => ({
    issueType,
    count: values.length,
    avgMinutes: round2(values.reduce((s, v) => s + v, 0) / values.length),
  }));
}

export async function getEndToEndCycleTimeAverage(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<CycleTimeResult> {
  const rows = (await fetchCycleEndRows(teamKey, startDate, endDate, issueType)).filter((r) => {
    if (isExcludedIssueType(teamKey, r.issue_type)) return false;
    const iso = toManilaDateString(r.cycle_time_end);
    return iso !== null && iso >= startDate && iso <= endDate;
  });

  const durations: number[] = [];
  for (const r of rows) {
    if (!r.cycle_time_start) continue;
    durations.push(minutesBetween(r.cycle_time_start, r.cycle_time_end));
  }

  if (!durations.length) return { avgMinutes: null, recordCount: 0 };
  return { avgMinutes: round2(durations.reduce((a, b) => a + b, 0) / durations.length), recordCount: durations.length };
}
