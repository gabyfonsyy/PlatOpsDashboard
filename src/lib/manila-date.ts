/**
 * Shared by every Phase 4 (Sheets -> Supabase) report port that needs to compare a Postgres
 * timestamptz against an Asia/Manila calendar day — matches gas/Utils.gs's toDisplayDate_.
 */

/**
 * Postgres stores timestamps as real timestamptz (UTC), but several overdue/period-membership
 * comparisons need the Asia/Manila CALENDAR DAY. The Philippines has no DST, so a fixed +8h
 * offset is exact (not an approximation), and simpler/guaranteed-correct across any runtime
 * timezone Vercel happens to execute in, unlike relying on Intl's timezone database.
 */
export function toManilaDateString(isoTimestamp: string | null | undefined): string | null {
  if (!isoTimestamp) return null;
  const manila = new Date(new Date(isoTimestamp).getTime() + 8 * 60 * 60 * 1000);
  const y = manila.getUTCFullYear();
  const m = String(manila.getUTCMonth() + 1).padStart(2, "0");
  const d = String(manila.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole-day difference between two 'yyyy-MM-dd' strings, anchored to UTC midnight on both sides. */
export function isoDateDiffDays(fromIso: string, toIso: string): number {
  const toUtcMs = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / 86400000);
}

/** Minutes between two ISO timestamps — pure duration, timezone-independent. */
export function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}
