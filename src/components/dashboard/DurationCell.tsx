import { cn } from "@/lib/utils";
import { formatDaysValue, formatDurationBreakdown } from "@/lib/format";

/**
 * A duration in a table cell, shown the way Team Stats shows one: the decimal-DAYS magnitude as the
 * number, with the days/hours/minutes breakdown as a small subnote under it.
 *
 * Days-always rather than the largest sensible unit (formatMinutesDecimalValue) because these
 * columns are read across and down. That helper switches unit by magnitude, so a 3-hour average and
 * a 3-day average both render "3.00" and a column of them is actively misleading. Fixing the unit
 * makes every cell on the page comparable, and the subnote carries the human reading.
 *
 * Null is a dash, never a zero: on this page "no completed review cycle yet" and "no time spent" are
 * different facts and must not look alike.
 */
export function DurationCell({
  minutes,
  strong = false,
}: {
  minutes: number | null | undefined;
  /** For the column a row is ranked by, so the eye lands on it first. */
  strong?: boolean;
}) {
  if (minutes === null || minutes === undefined) {
    return <span className="text-neutral-300">—</span>;
  }

  return (
    <>
      <span
        className={cn(
          "block tabular-nums",
          strong ? "font-semibold text-neutral-900" : "text-neutral-700"
        )}
      >
        {formatDaysValue(minutes)}
      </span>
      <span className="block text-[11px] text-neutral-400 tabular-nums">
        {formatDurationBreakdown(minutes)}
      </span>
    </>
  );
}
