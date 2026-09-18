import type { DriverRow } from "@/lib/business-review-drivers";

function formatChange(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function formatContribution(contribution: number | null): string {
  if (contribution === null) return "—";
  return `${contribution > 0 ? "+" : ""}${Math.round(contribution * 1000) / 10}%`;
}

/** Driver / Previous / Current / Change / Contribution table, per the brief's section 8 example. */
export function DriverBreakdownTable({ rows, dimensionLabel }: { rows: DriverRow[]; dimensionLabel: string }) {
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
            <td className={`py-2 px-2 text-right ${row.change > 0 ? "text-emerald-700" : row.change < 0 ? "text-red-600" : "text-neutral-400"}`}>
              {formatChange(row.change)}
            </td>
            <td className="py-2 pl-2 text-right text-neutral-500">{formatContribution(row.contribution)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
