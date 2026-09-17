"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { formatDaysValue, formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";
import type { BottleneckRow } from "@/lib/account-creation-report";

const ROLE_LABEL: Record<BottleneckRow["role"], string> = {
  original_se: "Original SE",
  reviewer: "Reviewer",
};

type SortKey = "seName" | "role" | "tickets" | "avgMinutes" | "medianMinutes" | "p90Minutes" | "delayRate";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "seName", label: "SE" },
  { key: "role", label: "Role" },
  { key: "tickets", label: "Tickets", align: "right" },
  { key: "avgMinutes", label: "Avg Cycle", align: "right" },
  { key: "medianMinutes", label: "Median", align: "right" },
  { key: "p90Minutes", label: "P90", align: "right" },
  { key: "delayRate", label: "Delay Rate", align: "right" },
];

function valueOf(row: BottleneckRow, key: SortKey): string | number {
  const v = row[key];
  return v === null ? -Infinity : v;
}

/**
 * Ranked bottleneck list, both roles in one sortable table (Section 8) — click any column header
 * to sort by it. Follows ProgressRecordsTable.tsx's toggle-sort convention (the only existing
 * interactive-sort precedent in this app), extended to per-column rather than one fixed column
 * since this is a multi-metric ranking, not a chronological log. Neutral field names throughout
 * ("Delay Rate", not a leaderboard) per Section 8's explicit language guidance.
 */
export function AccountCreationBottlenecksTable({ rows }: { rows: BottleneckRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("delayRate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = valueOf(a, sortKey);
      const vb = valueOf(b, sortKey);
      const cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Account Creation Bottlenecks</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Both roles ranked together — surfaces process bottlenecks, workload imbalance, and review-queue concentration. Not a leaderboard.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.align === "right" ? "text-right" : ""}>
                <button
                  onClick={() => handleSort(c.key)}
                  className={`inline-flex items-center gap-1 px-4 py-3 hover:text-neutral-700 ${c.align === "right" ? "flex-row-reverse w-full justify-start" : ""}`}
                >
                  {c.label}
                  <ArrowUpDown className={`w-3 h-3 ${sortKey === c.key ? "text-sprout-600" : "text-neutral-300"}`} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-neutral-400">No Account Creation tickets for this period.</td>
            </tr>
          ) : (
            sorted.map((r) => (
              <tr key={`${r.seName}-${r.role}`}>
                <td className="px-4 py-2.5 font-medium text-neutral-900 whitespace-nowrap">{r.seName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-neutral-600">{ROLE_LABEL[r.role]}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.tickets)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {formatDaysValue(r.avgMinutes)}
                  <span className="block text-[11px] text-neutral-400">{formatDurationBreakdown(r.avgMinutes)}</span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.medianMinutes)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.p90Minutes)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{formatPercent(r.delayRate)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
