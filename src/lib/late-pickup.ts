import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import {
  toManilaDateString,
  manilaHour,
  isWeekendManila,
  manilaDateOnlyUtc,
  nextBusinessDayUtc,
  endOfManilaDayUtc,
} from "@/lib/manila-date";

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

// A "not yet picked up" ticket is inherently a near-term concern — bounded to a recent
// lookback rather than scanning all of ST's history looking for one. Matches ATRISK_LOOKBACK_DAYS.
const ATRISK_LOOKBACK_DAYS = 30;

/** Manila calendar date a ticket becomes "Day 1 owned" per the 11 AM / weekend rule. */
function computeDay1Date(created: Date): Date {
  const dateOnly = manilaDateOnlyUtc(created);
  return manilaHour(created) < 11 && !isWeekendManila(created) ? dateOnly : nextBusinessDayUtc(dateOnly);
}

type TicketRow = {
  issue_key: string;
  created: string;
  first_out_of_backlog_todo: string | null;
  resolved_datetime: string | null;
  assigned_se: string | null;
};

/** Coarse UTC-range prefilter (±1 day for the Manila shift) + exact Manila-day check in JS, same split as the other Phase 4 ports. */
async function fetchAccountCreationTicketsCreatedBetween(startDate: string, endDate: string): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<TicketRow>((from, to) =>
    getSupabaseClient()
      .from("tickets")
      .select("issue_key,created,first_out_of_backlog_todo,resolved_datetime,assigned_se")
      .eq("team_key", "ST")
      .eq("issue_type", "Account Creation")
      .gte("created", rangeStartUtc.toISOString())
      .lte("created", rangeEndUtc.toISOString())
      .range(from, to)
  );
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `late-pickup-report` route. Ported from
 * gas/LatePickupApi.gs's getLatePickupReport_.
 */
export async function getLatePickupReport(range: string, period: string): Promise<LatePickupReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const now = new Date();

    const periodRows = (await fetchAccountCreationTicketsCreatedBetween(startDate, endDate)).filter((r) => {
      if (!r.created) return false;
      const createdDate = toManilaDateString(r.created);
      return createdDate !== null && createdDate >= startDate && createdDate <= endDate;
    });

    const bySe: Record<string, LatePickupBySe> = {};
    const tickets: LatePickupTicket[] = [];

    for (const r of periodRows) {
      const created = new Date(r.created);
      const pickedUpAt = r.first_out_of_backlog_todo ? new Date(r.first_out_of_backlog_todo) : null;
      if (!pickedUpAt) continue;

      const day1Date = computeDay1Date(created);
      const day1End = endOfManilaDayUtc(day1Date);
      const day2End = endOfManilaDayUtc(nextBusinessDayUtc(day1Date));

      const seName = r.assigned_se || "(unassigned)";
      const isLate = pickedUpAt > day1End;
      const isOverdue = r.resolved_datetime ? new Date(r.resolved_datetime) > day2End : now > day2End;

      tickets.push({
        issueKey: r.issue_key,
        seName,
        created: r.created,
        day1End: day1End.toISOString(),
        day2End: day2End.toISOString(),
        pickedUpAt: pickedUpAt.toISOString(),
        isLate,
        isOverdue,
        resolvedDatetime: r.resolved_datetime || null,
      });

      if (isLate) {
        if (!bySe[seName]) bySe[seName] = { seName, lateCount: 0, lateAndOverdueCount: 0 };
        bySe[seName].lateCount++;
        if (isOverdue) bySe[seName].lateAndOverdueCount++;
      }
    }

    const atRiskWindowStart = toManilaDateString(new Date(now.getTime() - ATRISK_LOOKBACK_DAYS * 86400000).toISOString())!;
    const atRiskRows = (await fetchAccountCreationTicketsCreatedBetween(atRiskWindowStart, toManilaDateString(now.toISOString())!))
      .filter((r) => !r.first_out_of_backlog_todo && r.created && toManilaDateString(r.created)! >= atRiskWindowStart);

    const atRisk: LatePickupAtRiskTicket[] = atRiskRows
      .map((r) => {
        const day1End = endOfManilaDayUtc(computeDay1Date(new Date(r.created)));
        return { issueKey: r.issue_key, seName: r.assigned_se || "(unassigned)", created: r.created, day1End };
      })
      .filter((t) => now > t.day1End)
      .map((t) => ({ issueKey: t.issueKey, seName: t.seName, created: t.created, day1End: t.day1End.toISOString() }));

    return {
      team: "ST",
      range, period,
      issueType: "Account Creation",
      bySe: Object.values(bySe).sort((a, b) => b.lateCount - a.lateCount),
      tickets,
      atRisk,
    };
  } catch {
    return { ...EMPTY_REPORT, range, period };
  }
}
