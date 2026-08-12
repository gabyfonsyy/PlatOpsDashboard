/**
 * Period label -> date range resolution, ported from gas/MetricsApi.gs's
 * resolvePeriodToDateRange_/isoWeekToDateRange_/monthsInRange_ so the Supabase-backed metrics
 * queries in lib/metrics.ts resolve periods identically to the GAS routes they replace.
 * Period label formats (kept in lockstep with lib/date-ranges.ts): week "YYYY-Www",
 * month "YYYY-MM", quarter "YYYY-Qn", year "YYYY".
 *
 * All date math runs in UTC explicitly — a serverless function's local timezone isn't
 * guaranteed, and a date-only string like "2026-07-01" already parses as UTC midnight, so
 * mixing in local-timezone getters/setters would silently shift the range by a day depending
 * on where the function happens to run.
 */

function toIsoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoWeekToDateRange(year: number, week: number): { startDate: string; endDate: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { startDate: toIsoDateUtc(start), endDate: toIsoDateUtc(end) };
}

export function resolvePeriodToDateRange(
  range: string,
  period: string,
  start?: string,
  end?: string
): { startDate: string; endDate: string } {
  if (start && end) return { startDate: start, endDate: end };

  if (range === "week") {
    const match = period.match(/^(\d{4})-W(\d{2})$/);
    if (!match) throw new Error(`Invalid week period: ${period}`);
    return isoWeekToDateRange(Number(match[1]), Number(match[2]));
  }

  if (range === "month") {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error(`Invalid month period: ${period}`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    return {
      startDate: toIsoDateUtc(new Date(Date.UTC(year, month - 1, 1))),
      endDate: toIsoDateUtc(new Date(Date.UTC(year, month, 0))),
    };
  }

  if (range === "quarter") {
    const match = period.match(/^(\d{4})-Q([1-4])$/);
    if (!match) throw new Error(`Invalid quarter period: ${period}`);
    const year = Number(match[1]);
    const q = Number(match[2]);
    const startMonth = (q - 1) * 3;
    return {
      startDate: toIsoDateUtc(new Date(Date.UTC(year, startMonth, 1))),
      endDate: toIsoDateUtc(new Date(Date.UTC(year, startMonth + 3, 0))),
    };
  }

  if (range === "year") {
    const year = Number(period);
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }

  throw new Error(`Unsupported range: ${range}`);
}

function monthLabelUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthsInRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const cursor = new Date(startDate);
  cursor.setUTCDate(1);
  const end = new Date(endDate);
  while (cursor <= end) {
    const label = monthLabelUtc(cursor);
    if (!months.includes(label)) months.push(label);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
