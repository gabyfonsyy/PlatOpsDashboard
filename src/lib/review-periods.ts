import { manilaDateOnlyUtc } from "@/lib/manila-date";

/**
 * Period math for Business Review Prep ONLY. Deliberately separate from lib/date-ranges.ts (the
 * sitewide ISO Mon-Sun week / calendar-label system every other page's `range`/`period` filter
 * uses) — the weekly boundary here is Monday-to-Friday (a 5-day workweek, changed from an
 * original Thursday-to-Wednesday spec 2026-09-18, before this feature shipped), an incompatible
 * convention either way, and mixing the two would silently corrupt whichever page read the
 * other's label.
 *
 * "Today" is always the Asia/Manila calendar day (lib/manila-date.ts's fixed +8h-offset
 * convention, no DST in PH) so a review period never straddles the day boundary differently for
 * the server than it does for Gaby looking at the page.
 */

export type ReviewMode = "weekly" | "monthly" | "quarterly";

export type ReviewDateRange = { start: string; end: string };

export type ReviewPeriodPair = {
  mode: ReviewMode;
  current: ReviewDateRange;
  previous: ReviewDateRange;
};

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUtc(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIso(dt);
}

/** The Asia/Manila calendar date "now" resolves to, as an ISO 'yyyy-MM-dd' string. */
export function manilaTodayIso(): string {
  return toIso(manilaDateOnlyUtc(new Date()));
}

/**
 * Weekly reporting period: Monday through Friday of one workweek (changed 2026-09-18 from an
 * original Thursday-to-Wednesday spec). Finds the most recent Friday on/before `anchorIso` — if
 * `anchorIso` itself falls Sat-Thu (i.e. this week's Friday hasn't happened yet), the "current"
 * period is the most recently COMPLETED Mon-Fri week, never a still-in-progress one (rule: never
 * compare against an incomplete period).
 *
 * Example: anchor 2026-09-18 (a Friday) -> that Friday itself is the most recent Fri on/before it
 * -> current = Sep 14-18 (Mon-Fri), previous = Sep 7-11.
 */
export function getWeeklyReviewPeriod(anchorIso: string = manilaTodayIso()): ReviewPeriodPair {
  const [y, m, d] = anchorIso.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = anchor.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceFriday = (dayOfWeek - 5 + 7) % 7; // Fri=5
  const currentEnd = addDaysUtc(anchorIso, -daysSinceFriday);
  const currentStart = addDaysUtc(currentEnd, -4);
  const previousEnd = addDaysUtc(currentStart, -3);
  const previousStart = addDaysUtc(previousEnd, -4);
  return {
    mode: "weekly",
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
}

function monthRange(year: number, month0: number): ReviewDateRange {
  const start = new Date(Date.UTC(year, month0, 1));
  const end = new Date(Date.UTC(year, month0 + 1, 0));
  return { start: toIso(start), end: toIso(end) };
}

/**
 * Monthly reporting period: the last two COMPLETED calendar months, relative to `anchorIso`'s own
 * month. Never uses the in-progress current month, regardless of what day of the month it is.
 */
export function getMonthlyReviewPeriod(anchorIso: string = manilaTodayIso()): ReviewPeriodPair {
  const [y, m] = anchorIso.split("-").map(Number);
  // anchor's own month is month0 = m - 1; the completed month before it is month0 - 1.
  const currentMonth0 = m - 1 - 1;
  const previousMonth0 = currentMonth0 - 1;
  const currentYear = y + Math.floor(currentMonth0 / 12);
  const current = monthRange(currentYear, ((currentMonth0 % 12) + 12) % 12);
  const previousYear = y + Math.floor(previousMonth0 / 12);
  const previous = monthRange(previousYear, ((previousMonth0 % 12) + 12) % 12);
  return { mode: "monthly", current, previous };
}

function quarterRange(year: number, quarterIndex0: number): ReviewDateRange {
  const startMonth0 = quarterIndex0 * 3;
  const start = new Date(Date.UTC(year, startMonth0, 1));
  const end = new Date(Date.UTC(year, startMonth0 + 3, 0));
  return { start: toIso(start), end: toIso(end) };
}

/**
 * Quarterly reporting period: the last two COMPLETED calendar quarters, relative to `anchorIso`'s
 * own quarter. Never uses the in-progress current quarter.
 */
export function getQuarterlyReviewPeriod(anchorIso: string = manilaTodayIso()): ReviewPeriodPair {
  const [y, m] = anchorIso.split("-").map(Number);
  const anchorQuarter0 = Math.floor((m - 1) / 3); // 0..3
  const currentQuarter0 = anchorQuarter0 - 1;
  const previousQuarter0 = currentQuarter0 - 1;
  const currentYear = y + Math.floor(currentQuarter0 / 4);
  const current = quarterRange(currentYear, ((currentQuarter0 % 4) + 4) % 4);
  const previousYear = y + Math.floor(previousQuarter0 / 4);
  const previous = quarterRange(previousYear, ((previousQuarter0 % 4) + 4) % 4);
  return { mode: "quarterly", current, previous };
}

export function getReviewPeriod(mode: ReviewMode, anchorIso: string = manilaTodayIso()): ReviewPeriodPair {
  if (mode === "weekly") return getWeeklyReviewPeriod(anchorIso);
  if (mode === "monthly") return getMonthlyReviewPeriod(anchorIso);
  return getQuarterlyReviewPeriod(anchorIso);
}

/**
 * Direct computation from an already-known "current" period start date — the inverse of
 * getWeeklyReviewPeriod/getMonthlyReviewPeriod/getQuarterlyReviewPeriod, which go from an anchor
 * ("today") to a current start. This is what re-displaying a specific historical period (from a
 * `?period=` URL param) or shifting by one period actually needs — NOT the anchor functions above,
 * since `currentStart` is a Monday/month-1st/quarter-1st, not "today", and feeding it back into
 * an anchor function would land one period too early (a bug caught while wiring up
 * lib/business-review.ts: passing a Monday as "today" to getWeeklyReviewPeriod computes the
 * PRECEDING Fri-ending week, not the week that Monday starts).
 */
export function getReviewPeriodFromStart(mode: ReviewMode, currentStart: string): ReviewPeriodPair {
  if (mode === "weekly") {
    const currentEnd = addDaysUtc(currentStart, 4);
    const previousEnd = addDaysUtc(currentStart, -3);
    const previousStart = addDaysUtc(previousEnd, -4);
    return { mode, current: { start: currentStart, end: currentEnd }, previous: { start: previousStart, end: previousEnd } };
  }
  if (mode === "monthly") {
    const [y, m] = currentStart.split("-").map(Number);
    const current = monthRange(y, m - 1);
    const prevMonth0 = m - 1 - 1;
    const prevYear = y + Math.floor(prevMonth0 / 12);
    const previous = monthRange(prevYear, ((prevMonth0 % 12) + 12) % 12);
    return { mode, current, previous };
  }
  const [y, m] = currentStart.split("-").map(Number);
  const quarter0 = Math.floor((m - 1) / 3);
  const current = quarterRange(y, quarter0);
  const prevQuarter0 = quarter0 - 1;
  const prevYear = y + Math.floor(prevQuarter0 / 4);
  const previous = quarterRange(prevYear, ((prevQuarter0 % 4) + 4) % 4);
  return { mode, current, previous };
}

/**
 * Quarter label for a date already known to fall in a given quarter, e.g. for display —
 * `formatReviewPeriodLabel` below is the one place that should call this.
 */
function quarterLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `Q${q} ${y}`;
}

/**
 * Moves the whole current/previous pair one period forward/back, for the <- Previous / Next ->
 * navigation. Computes the new period's start directly, then resolves it via
 * getReviewPeriodFromStart — same rules as the live period (rule 11), no anchor reverse-engineering.
 */
export function shiftReviewPeriod(mode: ReviewMode, currentStart: string, direction: 1 | -1): ReviewPeriodPair {
  if (mode === "weekly") {
    return getReviewPeriodFromStart(mode, addDaysUtc(currentStart, direction * 7));
  }
  if (mode === "monthly") {
    const [y, m] = currentStart.split("-").map(Number);
    const newMonth0 = m - 1 + direction;
    const newYear = y + Math.floor(newMonth0 / 12);
    const newStart = `${newYear}-${String(((newMonth0 % 12) + 12) % 12 + 1).padStart(2, "0")}-01`;
    return getReviewPeriodFromStart(mode, newStart);
  }
  const [y, m] = currentStart.split("-").map(Number);
  const currentQuarter0 = Math.floor((m - 1) / 3);
  const newQuarter0 = currentQuarter0 + direction;
  const newYear = y + Math.floor(newQuarter0 / 4);
  const newMonth0 = (((newQuarter0 % 4) + 4) % 4) * 3;
  const newStart = `${newYear}-${String(newMonth0 + 1).padStart(2, "0")}-01`;
  return getReviewPeriodFromStart(mode, newStart);
}

/**
 * `count` earlier *current* periods (via repeated shiftReviewPeriod), oldest last is NOT
 * guaranteed — callers get them in nearest-to-furthest order, for the anomaly-detection baseline.
 * Each entry is just the historical period's own `current` range, for a metric fetched at that
 * range.
 */
export function getPriorReviewPeriods(mode: ReviewMode, currentStart: string, count: number): ReviewDateRange[] {
  const periods: ReviewDateRange[] = [];
  let cursor = currentStart;
  for (let i = 0; i < count; i++) {
    const shifted = shiftReviewPeriod(mode, cursor, -1);
    periods.push(shifted.current);
    cursor = shifted.current.start;
  }
  return periods;
}

/**
 * Stable, sortable id for a team+mode+period, used for URLs and to scope the checklist/talking
 * points/AI-narrative-cache tables. `team` is a real team_key (e.g. "ST"), not the display name.
 */
export function periodKey(team: string, mode: ReviewMode, currentStart: string): string {
  return `${team}_${mode}_${currentStart}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatReviewPeriodLabel(mode: ReviewMode, range: ReviewDateRange): string {
  if (mode === "weekly") {
    const [sy, sm, sd] = range.start.split("-").map(Number);
    const [ey, , ed] = range.end.split("-").map(Number);
    const startLabel = `${MONTH_NAMES[sm - 1]} ${sd}`;
    const endLabel = sy === ey ? `${ed}, ${ey}` : `${MONTH_NAMES[Number(range.end.split("-")[1]) - 1]} ${ed}, ${ey}`;
    return `${startLabel}–${endLabel}`;
  }
  if (mode === "monthly") {
    const [y, m] = range.start.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }
  return `${quarterLabel(range.start)} · ${MONTH_NAMES[Number(range.start.split("-")[1]) - 1]}–${MONTH_NAMES[Number(range.end.split("-")[1]) - 1]} ${range.end.split("-")[0]}`;
}
