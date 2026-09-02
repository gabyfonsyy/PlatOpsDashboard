import type { ProblemAreaRow } from "@/lib/p1-sla";
import { formatNumber, formatPercent, formatMinutesDecimalValue } from "@/lib/format";

/**
 * Ranked by breach count (impact), not volume — see problemAreas() in lib/p1-sla.ts. Distinct from
 * CountRankTable (lib/ticket-breakdowns.ts's CountRow) because this needs an on-time rate AND an
 * avg-resolution-time column per row, not just a count/share pair.
 */
export function P1ProblemAreaTable({ title, keyLabel, rows, emptyMessage = "Nothing in this period." }: { title: string; keyLabel: string; rows: ProblemAreaRow[]; emptyMessage?: string }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">{keyLabel}</th>
            <th className="px-4 py-3 text-right">P1s</th>
            <th className="px-4 py-3 text-right w-28">On-Time</th>
            <th className="px-4 py-3 text-right">Avg Resolution</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2.5 text-neutral-900">{r.key}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{formatNumber(r.count)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {r.onTimeRate === null ? "—" : formatPercent(r.onTimeRate)}
                  <span className="block text-xs text-neutral-400">{formatNumber(r.onTimeCount)}/{formatNumber(r.count)}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-neutral-500">
                  {r.avgResolutionMinutes === null ? "—" : formatMinutesDecimalValue(r.avgResolutionMinutes)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
