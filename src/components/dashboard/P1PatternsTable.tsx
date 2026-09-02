import type { P1PatternRow } from "@/lib/p1-sla";
import { formatNumber, formatPercent } from "@/lib/format";

/** Product+label combos that showed up on 2+ decided P1s — candidates for a preventive fix rather
 * than a faster response. Sorted by breach count, same "impact over volume" rule as problem areas. */
export function P1PatternsTable({ rows }: { rows: P1PatternRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Recurring P1 Patterns</h3>
        <p className="text-xs text-neutral-400 mt-0.5">Product + label combinations appearing on 2 or more P1s this period.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Label</th>
            <th className="px-4 py-3 text-right">P1s</th>
            <th className="px-4 py-3 text-right">Breaches</th>
            <th className="px-4 py-3 text-right w-24">On-Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No repeated product/label combinations this period.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.product}-${r.label}`}>
                <td className="px-4 py-2.5 text-neutral-900 whitespace-nowrap">{r.product}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-block text-xs bg-sprout-50 text-sprout-700 rounded px-1.5 py-0.5">{r.label}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{formatNumber(r.count)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-red-600">{formatNumber(r.overdueCount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{r.onTimeRate === null ? "—" : formatPercent(r.onTimeRate)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
