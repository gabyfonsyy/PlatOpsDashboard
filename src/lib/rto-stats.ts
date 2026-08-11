import type { RtoRecord } from "@/lib/types";

export type RtoQuickStat = {
  daysInOffice: number;
  daysRemote: number;
  daysAbsent: number;
  totalDays: number;
  compliancePct: number | null;
};

function aggregate(records: RtoRecord[]): RtoQuickStat {
  let daysInOffice = 0, daysRemote = 0, daysAbsent = 0;
  records.forEach((r) => {
    if (r.attendance_type === "In-Office") daysInOffice++;
    else if (r.attendance_type === "Remote") daysRemote++;
    else if (r.attendance_type === "Absent") daysAbsent++;
  });
  const totalDays = records.length;
  return { daysInOffice, daysRemote, daysAbsent, totalDays, compliancePct: totalDays ? daysInOffice / totalDays : null };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** [startDate, endDate] (inclusive, yyyy-MM-dd) for the calendar year/quarter/month containing `ref`. */
function yearRange(ref: Date): [string, string] {
  return [isoDate(new Date(ref.getFullYear(), 0, 1)), isoDate(new Date(ref.getFullYear(), 11, 31))];
}
function quarterRange(ref: Date): [string, string] {
  const startMonth = Math.floor(ref.getMonth() / 3) * 3;
  return [isoDate(new Date(ref.getFullYear(), startMonth, 1)), isoDate(new Date(ref.getFullYear(), startMonth + 3, 0))];
}
function monthRange(ref: Date): [string, string] {
  return [isoDate(new Date(ref.getFullYear(), ref.getMonth(), 1)), isoDate(new Date(ref.getFullYear(), ref.getMonth() + 1, 0))];
}

/**
 * Quick at-a-glance totals for the current calendar year/quarter/month — across every employee
 * in `records` (already team-filtered by the caller), unlike the per-employee compliance summary
 * (which needs an explicit date range typed in). Dates are compared as plain yyyy-MM-dd strings,
 * same normalization the rest of the app relies on (formatManilaDate/toDisplayDate_ upstream).
 */
export function computeRtoQuickStats(records: RtoRecord[], referenceDate: Date = new Date()) {
  const [yearStart, yearEnd] = yearRange(referenceDate);
  const [quarterStart, quarterEnd] = quarterRange(referenceDate);
  const [monthStart, monthEnd] = monthRange(referenceDate);

  const inRange = (start: string, end: string) =>
    records.filter((r) => r.date >= start && r.date <= end);

  return {
    year: aggregate(inRange(yearStart, yearEnd)),
    quarter: aggregate(inRange(quarterStart, quarterEnd)),
    month: aggregate(inRange(monthStart, monthEnd)),
  };
}
