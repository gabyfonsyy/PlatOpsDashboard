"use client";

import type { AgeingRateBreakdownRow } from "@/lib/backlog-aging";
import { formatNumber, formatPercent } from "@/lib/format";

/**
 * Generic Ageing Rate breakdown (resolved / beyond due date / rate) — one shared component
 * behind Team, Work Category and Issue Type (brief sections 24/26/29). Always shows the
 * underlying counts next to the rate, never a bare percentage, per her "don't overinterpret
 * tiny samples" rule (section 26/29/47).
 */
export function AgeingRateBreakdownTable({ title, keyLabel, rows }: { title: string; keyLabel: string; rows: AgeingRateBreakdownRow[] }) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[40%]">{keyLabel}</th>
            <th className="px-3 py-3 text-right w-[20%]">Resolved</th>
            <th className="px-3 py-3 text-right w-[20%]">Beyond Due</th>
            <th className="px-3 py-3 text-right w-[20%]">Ageing Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">No resolved tickets for this period.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2.5 text-neutral-900 break-words">{r.key}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.resolved)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{formatNumber(r.beyondDue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatPercent(r.rate, 1)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
