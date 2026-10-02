import type { DriverRow } from "@/lib/business-review-drivers";
import type { MetricComparison } from "@/lib/business-review";
import { changeTone, type Better } from "@/lib/business-review-view";

/** Whole numbers stay whole (ticket counts); anything fractional (average days) shows 2 decimals. */
function formatValue(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

function formatChange(n: number): string {
  const v = formatValue(Math.abs(n));
  return n > 0 ? `+${v}` : n < 0 ? `-${v}` : v;
}

function formatContribution(contribution: number | null): string {
  if (contribution === null) return "—";
  const pct = contribution * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

const formatRate = (r: number | null | undefined) => (r === null || r === undefined ? "—" : `${(r * 100).toFixed(2)}%`);

/** Rate change in percentage points, e.g. "+1.20 pts". */
function formatPts(prev: number | null | undefined, curr: number | null | undefined): string | null {
  if (prev === null || prev === undefined || curr === null || curr === undefined) return null;
  const pts = (curr - prev) * 100;
  return `${pts > 0 ? "+" : ""}${pts.toFixed(2)} pts`;
}

/** The small rate line under a count (Ageing Rate breakdown only). */
function RateLine({ rate }: { rate: number | null | undefined }) {
  return <span className="block text-[11px] font-normal text-neutral-400">{formatRate(rate)} rate</span>;
}

/** Rate change in points, coloured on the rate's own movement (it can differ from the count's). */
function RatePts({ prev, curr, better }: { prev: number | null | undefined; curr: number | null | undefined; better: Better }) {
  const text = formatPts(prev, curr);
  if (!text) return null;
  return <span className={`block text-[11px] font-normal ${changeTone((curr ?? 0) - (prev ?? 0), better)}`}>{text}</span>;
}

function formatPctChange(previous: number, current: number): string {
  if (previous === 0) return current === 0 ? "0.00%" : "new";
  const pct = ((current - previous) / previous) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}


/**
 * Driver / Previous / Current / Change / Contribution table, per the brief's section 8 example,
 * with a Total row underneath when the metric has one (lib/business-review.ts totalOf): the sum
 * for count breakdowns, the volume-weighted average for duration breakdowns.
 */
export function DriverBreakdownTable({
  rows,
  dimensionLabel,
  total = null,
  better = "neutral",
  rates = null,
}: {
  rows: DriverRow[];
  dimensionLabel: string;
  total?: MetricComparison["driverTotal"];
  /** Which way is good for these rows, so a drop in Lead Time reads green, not red. */
  better?: Better;
  /** Per-row rate (overdue ÷ resolved for that row), plus "__total" — shown under each count. */
  rates?: MetricComparison["driverRates"];
}) {
  const changeClass = (n: number) => changeTone(n, better);
  if (!rows.length) {
    return <p className="text-sm text-neutral-400 py-3">No breakdown data available for this metric.</p>;
  }
  const totalChange = total ? Math.round((total.current - total.previous) * 10000) / 10000 : 0;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
          <th className="py-2 pr-2">{dimensionLabel}</th>
          <th className="py-2 px-2 text-right">Previous</th>
          <th className="py-2 px-2 text-right">Current</th>
          <th className="py-2 px-2 text-right">Change</th>
          <th className="py-2 pl-2 text-right">Contribution</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-neutral-100 last:border-0">
            <td className="py-2 pr-2 text-neutral-800">{row.key}</td>
            <td className="py-2 px-2 text-right text-neutral-500">
              {formatValue(row.previous)}
              {rates && <RateLine rate={rates[row.key]?.previous} />}
            </td>
            <td className="py-2 px-2 text-right text-neutral-900 font-medium">
              {formatValue(row.current)}
              {rates && <RateLine rate={rates[row.key]?.current} />}
            </td>
            <td className={`py-2 px-2 text-right ${changeClass(row.change)}`}>
              {formatChange(row.change)}
              {rates && <RatePts prev={rates[row.key]?.previous} curr={rates[row.key]?.current} better={better} />}
            </td>
            <td className="py-2 pl-2 text-right text-neutral-500">{formatContribution(row.contribution)}</td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="border-t-2 border-neutral-200 font-semibold">
            <td className="py-2 pr-2 text-neutral-900">{total.label}</td>
            <td className="py-2 px-2 text-right text-neutral-600">
              {total.kind === "average" ? total.previous.toFixed(2) : formatValue(total.previous)}
              {rates && <RateLine rate={rates.__total?.previous} />}
            </td>
            <td className="py-2 px-2 text-right text-neutral-900">
              {total.kind === "average" ? total.current.toFixed(2) : formatValue(total.current)}
              {rates && <RateLine rate={rates.__total?.current} />}
            </td>
            <td
              className={`py-2 px-2 text-right whitespace-nowrap ${changeClass(totalChange)}`}
              title={total.kind === "average" ? "Change in the overall average vs the previous period" : "Combined change vs the previous period"}
            >
              {total.kind === "average" ? `${totalChange > 0 ? "+" : ""}${totalChange.toFixed(2)}` : formatChange(totalChange)} ({formatPctChange(total.previous, total.current)})
              {rates && <RatePts prev={rates.__total?.previous} curr={rates.__total?.current} better={better} />}
            </td>
            <td className="py-2 pl-2 text-right text-neutral-500">{totalChange === 0 ? "—" : "100.00%"}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
