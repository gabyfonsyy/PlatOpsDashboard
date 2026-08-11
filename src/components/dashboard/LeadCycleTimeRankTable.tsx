import type { LeadCycleTimeRankRow } from "@/lib/lead-cycle-time";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatNumber } from "@/lib/format";

/** Ranked breakdown table — shared shape for "by assignee", "by product", and "by label" (labels
 * excluding any -ops department tag). Sorted descending by avg duration server-side already. */
export function LeadCycleTimeRankTable({
  title,
  keyLabel,
  rows,
}: {
  title: string;
  keyLabel: string;
  rows: LeadCycleTimeRankRow[];
}) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">{keyLabel}</th>
            <th className="px-4 py-3">Avg Time</th>
            <th className="px-4 py-3 text-right">Tickets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-neutral-400">No data for this period.</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r.key}>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={i === 0 ? "font-semibold text-neutral-900" : "text-neutral-700"}>{r.key}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatMinutesDecimalValue(r.avgMinutes)}{" "}
                  <span className="text-neutral-400">({formatDurationBreakdown(r.avgMinutes)})</span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatNumber(r.count)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
