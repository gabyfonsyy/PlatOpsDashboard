"use client";

import type { LeadTimeBreakdownRow } from "@/lib/lead-cycle-time";
import { formatNumber } from "@/lib/format";

function fmtDays(minutes: number | null): string {
  return minutes === null ? "—" : `${(minutes / 1440).toFixed(2)}d`;
}

/**
 * By Work Type / By Product breakdown — median/avg/P75/P90 and a long-running count, not just an
 * average, so a manager can see whether a group's number is representative. Rows are clickable to
 * scope the ticket detail table below (see LeadTimeDeepDive), mirroring the distribution chart's
 * click-to-filter rather than introducing a different interaction pattern.
 */
export function LeadTimeBreakdownTable({
  title,
  keyLabel,
  rows,
  selectedKey,
  onSelect,
}: {
  title: string;
  keyLabel: string;
  rows: LeadTimeBreakdownRow[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
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
            <th className="px-4 py-3 text-right">Volume</th>
            <th className="px-4 py-3 text-right">Median</th>
            <th className="px-4 py-3 text-right">Avg</th>
            <th className="px-4 py-3 text-right">P90</th>
            <th className="px-4 py-3 text-right">Long-Running</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">No data for this period.</td>
            </tr>
          ) : (
            rows.map((r) => {
              const isSelected = selectedKey === r.key;
              return (
                <tr
                  key={r.key}
                  onClick={onSelect ? () => onSelect(isSelected ? null : r.key) : undefined}
                  className={onSelect ? `cursor-pointer transition-colors ${isSelected ? "bg-sprout-50" : "hover:bg-neutral-50"}` : undefined}
                >
                  <td className="px-4 py-2.5 text-neutral-900 whitespace-nowrap">{r.key}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtDays(r.medianMinutes)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{fmtDays(r.avgMinutes)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{fmtDays(r.p90Minutes)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.longRunningCount > 0 ? <span className="text-amber-700 font-medium">{r.longRunningCount}</span> : <span className="text-neutral-300">0</span>}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
