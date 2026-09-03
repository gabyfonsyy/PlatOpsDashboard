import type { CycleTimePattern } from "@/lib/lead-cycle-time";
import { formatNumber } from "@/lib/format";

function fmtDays(minutes: number | null): string {
  return minutes === null ? "—" : `${(minutes / 1440).toFixed(2)}d`;
}

/** Ticket types / products with 3+ tickets whose median total Cycle Time runs notably above the period overall. */
export function CycleTimePatternsTable({ rows, title }: { rows: CycleTimePattern[]; title: string }) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">Ticket types and products with at least 3 tickets and a median Cycle Time notably above the period overall.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Pattern</th>
            <th className="px-4 py-3 text-right">Volume</th>
            <th className="px-4 py-3 text-right">Median</th>
            <th className="px-4 py-3 text-right">P90</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">No recurring high-Cycle-Time patterns detected this period.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.dimension}-${r.key}`}>
                <td className="px-4 py-2.5 text-neutral-900">
                  {r.key}
                  <span className="block text-xs text-neutral-400">{r.dimension}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtDays(r.medianTotalMinutes)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{fmtDays(r.p90TotalMinutes)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
