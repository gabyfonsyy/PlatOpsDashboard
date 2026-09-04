export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * Primary duration value in the largest sensible unit, always 2 decimals, with the unit spelled
 * out and pluralized. e.g. 3384 min -> "2.35 days", 2874 min -> "2.00 days", 45 min -> "45.00 minutes".
 */
export function formatMinutesDecimal(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  let value: number;
  let unit: string;
  if (minutes < 60) { value = minutes; unit = "minute"; }
  else if (minutes < 1440) { value = minutes / 60; unit = "hour"; }
  else { value = minutes / 1440; unit = "day"; }
  const v = value.toFixed(2);
  return `${v} ${unit}${Number(v) === 1 ? "" : "s"}`;
}

/**
 * Just the numeric magnitude in the largest sensible unit, always 2 decimals, no unit word (e.g.
 * 3384 min -> "2.35", 2874 min -> "2.00", 45 min -> "45.00"). Pairs with formatDurationBreakdown
 * as the sublabel, which carries the unit — so the big score stays an uncluttered number.
 * Returns the fixed string directly rather than round-tripping through Number() — that would
 * collapse "2.00" back down to "2", silently dropping the decimals whenever they round to zero.
 */
export function formatMinutesDecimalValue(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  let value: number;
  if (minutes < 60) value = minutes;
  else if (minutes < 1440) value = minutes / 60;
  else value = minutes / 1440;
  return value.toFixed(2);
}

/**
 * Duration expressed in DAYS regardless of magnitude, always 2 decimals (e.g. 180 min ->
 * "0.13", 3384 min -> "2.35"). Unlike formatMinutesDecimalValue, the unit never switches,
 * so a 3-hour average and a 3-day average sit on the same scale and stay comparable when the
 * period filter moves. Pairs with formatDurationBreakdown as the sublabel, which carries the
 * human-readable "3h". Returns the fixed string directly so trailing zeros survive.
 */
export function formatDaysValue(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  return (minutes / 1440).toFixed(2);
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

/**
 * Duration expressed in DAYS, always 2 decimals, rounded UP (ceiling) rather than to nearest —
 * for the Cycle Time scorecard specifically, where understating a cycle time reads as the
 * process being faster than it actually was. Unlike formatDaysValue (nearest), 90 min -> "0.07"
 * both ways, but 129.5 min (0.0899...d) -> "0.09" here vs "0.09" there only by coincidence;
 * the difference shows at e.g. 1441 min: formatDaysValue -> "1.00", this -> "1.01".
 */
export function formatDaysValueCeil(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  return (Math.ceil((minutes / 1440) * 100) / 100).toFixed(2);
}

/**
 * Full breakdown of a duration into days/hours/minutes/seconds for the Cycle Time scorecard
 * subnote — pairs with formatDaysValueCeil. Unlike formatDurationBreakdown (whole minutes only),
 * this keeps the sub-minute remainder as seconds rather than rounding it away, so the sublabel's
 * total matches the headline's ceiling-rounded days rather than silently dropping seconds.
 */
export function formatDurationBreakdownWithSeconds(minutes: number | null | undefined): string | undefined {
  if (minutes === null || minutes === undefined) return undefined;
  const totalSeconds = Math.round(minutes * 60);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * A whole/fractional day count that's already a calendar-day difference (e.g. ticket age,
 * days since update) — unlike formatDaysValue/formatDaysValueCeil, there's no minutes-to-days
 * conversion here, so this just renders the number with one decimal and a trailing "d".
 */
export function formatAgeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  return `${days.toFixed(1)}d`;
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

/**
 * "08/25/2026 19:58:24" — an exact Manila wall-clock timestamp, MM/DD/YYYY HH:MM:SS.
 *
 * Built from formatToParts rather than a locale string because en-US inserts a comma between the
 * date and the time ("08/25/2026, 19:58:24") and there is no option to suppress it. hourCycle h23
 * is deliberate: hour12:false renders midnight as 24 in some runtimes.
 */
export function formatManilaDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
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
