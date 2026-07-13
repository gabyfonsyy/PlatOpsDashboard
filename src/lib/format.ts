export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/** Trims to at most `dp` decimals without trailing zeros: 2.35 -> "2.35", 2.5 -> "2.5", 3 -> "3". */
function trimDecimals(value: number, dp = 2): string {
  return String(Number(value.toFixed(dp)));
}

/**
 * Primary duration value in the largest sensible unit, max 2 decimals, with the unit spelled out
 * and pluralized. e.g. 3384 min -> "2.35 days", 504 min -> "8.4 hours", 45 min -> "45 minutes".
 */
export function formatMinutesDecimal(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  let value: number;
  let unit: string;
  if (minutes < 60) { value = minutes; unit = "minute"; }
  else if (minutes < 1440) { value = minutes / 60; unit = "hour"; }
  else { value = minutes / 1440; unit = "day"; }
  const v = Number(value.toFixed(2));
  return `${v} ${unit}${v === 1 ? "" : "s"}`;
}

/**
 * Just the numeric magnitude in the largest sensible unit, no unit word (e.g. 3384 min -> "2.35",
 * 504 min -> "8.4", 45 min -> "45"). Pairs with formatDurationBreakdown as the sublabel, which
 * carries the unit — so the big score stays an uncluttered number.
 */
export function formatMinutesDecimalValue(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  let value: number;
  if (minutes < 60) value = minutes;
  else if (minutes < 1440) value = minutes / 60;
  else value = minutes / 1440;
  return String(Number(value.toFixed(2)));
}

/**
 * Full breakdown of a duration into days/hours/minutes for the scorecard subnote.
 * e.g. 3384 min -> "2d 8h 24m". Returns undefined when there's no value, so the
 * card simply omits the subnote.
 */
export function formatDurationBreakdown(minutes: number | null | undefined): string | undefined {
  if (minutes === null || minutes === undefined) return undefined;
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

/**
 * Normalises a date value to a plain `YYYY-MM-DD` string in Manila time. Sheets round-trips
 * a stored date as a UTC ISO timestamp (e.g. "2026-07-09T16:00:00.000Z" = 2026-07-10 in
 * Manila), so we anchor to Asia/Manila to avoid the off-by-one and drop the time portion.
 * Already-plain "YYYY-MM-DD" strings pass through unchanged.
 */
export function formatManilaDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
