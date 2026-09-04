"use client";

import type { BacklogBreakdownRow } from "@/lib/backlog-aging";
import { formatNumber, formatPercent, formatAgeDays } from "@/lib/format";

function ageDaysOf(minutes: number | null): number | null {
  return minutes === null ? null : minutes / 1440;
}

/**
 * Generic current-open-backlog breakdown — one shared component behind Team, Work Category,
 * Issue Type, Priority, Product and Assigned Owner (six call sites), same "one component, many
 * callers" convention as CycleTimeBreakdownTable / LeadTimeBreakdownTable. Age columns are
 * stacked (Median/P90 share a cell, Aging Risk/Stale share a cell) rather than adding more
 * columns, per her standing "no horizontal scroll on this page family" rule.
 *
 * Never a plain volume leaderboard (brief section 12/30) — Age and Risk sit right next to
 * Volume so a reader can't read "most tickets" as "most concerning" without also seeing age/risk.
 */
export function BacklogBreakdownTable({
  title,
  keyLabel,
  rows,
  selectedKey,
  onSelect,
  showWorkCategoryMix,
}: {
  title: string;
  keyLabel: string;
  rows: BacklogBreakdownRow[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  showWorkCategoryMix?: boolean;
}) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[28%]">{keyLabel}</th>
            <th className="px-3 py-3 text-right w-[13%]">Open</th>
            <th className="px-3 py-3 text-right w-[13%]">% Backlog</th>
            <th className="px-3 py-3 text-right w-[20%]">Median / P90 Age</th>
            <th className="px-3 py-3 text-right w-[13%]">Oldest</th>
            <th className="px-3 py-3 text-right w-[13%]">Risk / Stale</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">No open backlog for this selection.</td>
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
                  <td className="px-3 py-2.5 text-neutral-900 break-words">
                    {r.key}
                    {showWorkCategoryMix && r.workCategoryMixLabel && (
                      <span className="block text-[11px] font-normal text-neutral-400">{r.workCategoryMixLabel}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{formatPercent(r.pctOfBacklog, 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {formatAgeDays(ageDaysOf(r.medianAgeMinutes))}
                    <span className="text-neutral-400 font-normal"> / {formatAgeDays(ageDaysOf(r.p90AgeMinutes))}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{formatAgeDays(ageDaysOf(r.oldestAgeMinutes))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.agingRiskCount > 0 ? <span className="text-amber-700 font-medium">{r.agingRiskCount}</span> : <span className="text-neutral-300">0</span>}
                    <span className="text-neutral-400"> / {r.staleCount}</span>
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
