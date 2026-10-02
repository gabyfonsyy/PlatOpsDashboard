import type { DriverRow } from "@/lib/business-review-drivers";

function formatChange(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function formatContribution(contribution: number | null): string {
  if (contribution === null) return "—";
  return `${contribution > 0 ? "+" : ""}${Math.round(contribution * 1000) / 10}%`;
}

function formatPctChange(previous: number, current: number): string {
  if (previous === 0) return current === 0 ? "0%" : "new";
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

const changeClass = (n: number) => (n > 0 ? "text-emerald-700" : n < 0 ? "text-red-600" : "text-neutral-400");

/**
 * Driver / Previous / Current / Change / Contribution table, per the brief's section 8 example.
 * `showTotal` adds a combined row for count breakdowns, where the rows sum to the whole (anything
 * past the top drivers is already folded into "Other", so nothing is dropped from the total).
 */
export function DriverBreakdownTable({ rows, dimensionLabel, showTotal = false }: { rows: DriverRow[]; dimensionLabel: string; showTotal?: boolean }) {
  if (!rows.length) {
    return <p className="text-sm text-neutral-400 py-3">No breakdown data available for this metric.</p>;
  }
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
            <td className="py-2 px-2 text-right text-neutral-500">{row.previous}</td>
            <td className="py-2 px-2 text-right text-neutral-900 font-medium">{row.current}</td>
            <td className={`py-2 px-2 text-right ${changeClass(row.change)}`}>
              {formatChange(row.change)}
            </td>
            <td className="py-2 pl-2 text-right text-neutral-500">{formatContribution(row.contribution)}</td>
          </tr>
        ))}
      </tbody>
      {showTotal && (() => {
        const previous = rows.reduce((n, r) => n + r.previous, 0);
        const current = rows.reduce((n, r) => n + r.current, 0);
        const change = current - previous;
        return (
          <tfoot>
            <tr className="border-t-2 border-neutral-200 font-semibold">
              <td className="py-2 pr-2 text-neutral-900">Total</td>
              <td className="py-2 px-2 text-right text-neutral-600">{previous}</td>
              <td className="py-2 px-2 text-right text-neutral-900">{current}</td>
              <td className={`py-2 px-2 text-right whitespace-nowrap ${changeClass(change)}`} title="Combined change vs the previous period">
                {formatChange(change)} ({formatPctChange(previous, current)})
              </td>
              <td className="py-2 pl-2 text-right text-neutral-500">{previous === current ? "—" : "100%"}</td>
            </tr>
          </tfoot>
        );
      })()}
    </table>
  );
}
