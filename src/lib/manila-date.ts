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

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Business-day / Manila-time helpers for SLA date math (lib/late-pickup.ts), ported from
 * gas/Utils.gs's manilaHour_/manilaDateOnly_/isWeekend_/nextBusinessDay_/endOfManilaDay_.
 *
 * The GAS versions lean on the Apps Script project's runtime timezone being set to Asia/Manila
 * (appsscript.json) — `new Date(y, m, d)` there IS Manila midnight, no conversion needed. A
 * Vercel serverless function has no such guarantee (its runtime is typically UTC), so every
 * helper here works in real UTC instants throughout, using a manual +8h shift to read/construct
 * Manila calendar fields — this way `.toISOString()`/`>`/`<` comparisons against Postgres
 * timestamptz values are correct no matter what timezone the function happens to execute in.
 */

export function manilaHour(date: Date): number {
  return new Date(date.getTime() + MANILA_OFFSET_MS).getUTCHours();
}

export function isWeekendManila(date: Date): boolean {
  const day = new Date(date.getTime() + MANILA_OFFSET_MS).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 || day === 6;
}

/** The UTC instant of Manila midnight on `date`'s Manila calendar day. */
export function manilaDateOnlyUtc(date: Date): Date {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  const utcMidnightSameFields = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(utcMidnightSameFields - MANILA_OFFSET_MS);
}

/** `manilaMidnight` must already be a manilaDateOnlyUtc value. Next Mon-Fri Manila midnight strictly after it. */
export function nextBusinessDayUtc(manilaMidnight: Date): Date {
  let next = new Date(manilaMidnight.getTime() + 86400000);
  while (isWeekendManila(next)) next = new Date(next.getTime() + 86400000);
  return next;
}

/** `manilaMidnight` must already be a manilaDateOnlyUtc value. The UTC instant of 23:59:59.999 Manila that day. */
export function endOfManilaDayUtc(manilaMidnight: Date): Date {
  return new Date(manilaMidnight.getTime() + 86400000 - 1);
}
