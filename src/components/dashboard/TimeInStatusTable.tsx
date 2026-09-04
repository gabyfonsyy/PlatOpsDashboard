"use client";

import type { TimeInStatusRow } from "@/lib/backlog-aging";
import { formatNumber, formatAgeDays } from "@/lib/format";

/**
 * Where open work is currently sitting, and how long it's been sitting there. No true per-status
 * dwell time is persisted (only the CURRENT status and the last field-update timestamp) — median/
 * oldest are "days since last update" as an honest, labelled proxy, not a fabricated exact dwell
 * time (see lib/backlog-aging.ts's decorateOpenTicket doc comment). Volume alone never implies a
 * bottleneck (brief section 22) — Aging Risk sits right next to it.
 */
export function TimeInStatusTable({
  rows,
  title,
  selectedKey,
  onSelect,
}: {
  rows: TimeInStatusRow[];
  title?: string;
  selectedKey?: string | null;
  onSelect?: (status: string | null) => void;
}) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title ?? "Time in Current Status"}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">Median/oldest are days since the ticket was last updated — the closest available proxy for time in status.</p>
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[34%]">Status</th>
            <th className="px-3 py-3 text-right w-[18%]">Open</th>
            <th className="px-3 py-3 text-right w-[24%]">Median / Oldest</th>
            <th className="px-3 py-3 text-right w-[24%]">Aging Risk</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">No open backlog for this selection.</td>
            </tr>
          ) : (
            rows.map((r) => {
              const isSelected = selectedKey === r.status;
              return (
              <tr
                key={r.status}
                onClick={onSelect ? () => onSelect(isSelected ? null : r.status) : undefined}
                className={onSelect ? `cursor-pointer transition-colors ${isSelected ? "bg-sprout-50" : "hover:bg-neutral-50"}` : undefined}
              >
                <td className="px-3 py-2.5 text-neutral-900 break-words">{r.status}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.openCount)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {formatAgeDays(r.medianDaysSinceUpdate)}
                  <span className="text-neutral-400 font-normal"> / {formatAgeDays(r.oldestDaysSinceUpdate)}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.agingRiskCount > 0 ? <span className="text-amber-700 font-medium">{r.agingRiskCount}</span> : <span className="text-neutral-300">0</span>}
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
