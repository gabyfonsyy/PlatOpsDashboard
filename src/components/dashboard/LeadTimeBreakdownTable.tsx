"use client";

import { Fragment } from "react";
import type { LeadTimeBreakdownRow, CycleTimeWorkCategory } from "@/lib/lead-cycle-time";
import { formatNumber } from "@/lib/format";

function fmtDays(minutes: number | null): string {
  return minutes === null ? "—" : `${(minutes / 1440).toFixed(2)}d`;
}

/**
 * By Work Type / By Product / Individual breakdown — median/avg/P75/P90 and a long-running count,
 * not just an average, so a manager can see whether a group's number is representative. Rows are
 * clickable to scope the ticket detail table below (see LeadTimeDeepDive), mirroring the
 * distribution chart's click-to-filter rather than introducing a different interaction pattern.
 *
 * `categoryLabels` turns on grouping by Backend Changes / Investigations / Other — only meaningful
 * for the By Work Type table on the "All SE Work" view (no workCategory selected), where an
 * unbroken flat list would interleave the two workflows with no visual cue why they behave so
 * differently (brief section 10). Mirrors CycleTimeBreakdownTable's identical grouping.
 *
 * `showCategoryMix` renders each row's Backend/Investigations split as a sub-line under the key —
 * only meaningful for the Individual breakdown on the "All SE Work" view (brief section 19: don't
 * compare a mostly-Investigations person against a mostly-Backend-Changes person with no context).
 */
export function LeadTimeBreakdownTable({
  title,
  keyLabel,
  rows,
  selectedKey,
  onSelect,
  categoryLabels,
  showCategoryMix,
}: {
  title: string;
  keyLabel: string;
  rows: LeadTimeBreakdownRow[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  categoryLabels?: { backend: string; investigations: string; other: string };
  showCategoryMix?: boolean;
}) {
  const groups: { key: CycleTimeWorkCategory | "other" | null; label: string | null; rows: LeadTimeBreakdownRow[] }[] = categoryLabels
    ? (["backend", "investigations", null] as const)
        .map((cat) => ({
          key: cat,
          label: cat === "backend" ? categoryLabels.backend : cat === "investigations" ? categoryLabels.investigations : categoryLabels.other,
          rows: rows.filter((r) => r.category === cat),
        }))
        .filter((g) => g.rows.length > 0)
    : [{ key: null, label: null, rows }];

  const row = (r: LeadTimeBreakdownRow) => {
    const isSelected = selectedKey === r.key;
    return (
      <tr
        key={r.key}
        onClick={onSelect ? () => onSelect(isSelected ? null : r.key) : undefined}
        className={onSelect ? `cursor-pointer transition-colors ${isSelected ? "bg-sprout-50" : "hover:bg-neutral-50"}` : undefined}
      >
        <td className="px-3 py-2.5 text-neutral-900 break-words">
          {r.key}
          {showCategoryMix && r.categoryMixLabel && <span className="block text-[11px] font-normal text-neutral-400">{r.categoryMixLabel}</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmtDays(r.medianMinutes)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{fmtDays(r.avgMinutes)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{fmtDays(r.p90Minutes)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {r.longRunningCount > 0 ? <span className="text-amber-700 font-medium">{r.longRunningCount}</span> : <span className="text-neutral-300">0</span>}
        </td>
      </tr>
    );
  };

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[32%]">{keyLabel}</th>
            <th className="px-3 py-3 text-right w-[14%]">Volume</th>
            <th className="px-3 py-3 text-right w-[15%]">Median</th>
            <th className="px-3 py-3 text-right w-[13%]">Avg</th>
            <th className="px-3 py-3 text-right w-[13%]">P90</th>
            <th className="px-3 py-3 text-right w-[13%]">Long</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">No data for this period.</td>
            </tr>
          ) : (
            groups.map((g) => (
              <Fragment key={String(g.key)}>
                {g.label && (
                  <tr className="bg-neutral-50/70">
                    <td colSpan={6} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      {g.label}
                    </td>
                  </tr>
                )}
                {g.rows.map(row)}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
