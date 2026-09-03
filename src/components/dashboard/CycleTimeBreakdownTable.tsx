"use client";

import { Fragment } from "react";
import type { CycleTimeBreakdownRow, CycleTimeWorkCategory } from "@/lib/lead-cycle-time";
import { formatNumber, formatDaysValue, formatDurationBreakdown } from "@/lib/format";

function fmtMain(minutes: number | null): string {
  return minutes === null ? "—" : formatDaysValue(minutes);
}

/**
 * Shared by By Ticket Type, By Product, and (for a peer-review team) Individual Breakdown by
 * Assigned SE — same row shape, same columns, just a different grouping key. Mirrors the Lead
 * Time deep-dive's LeadTimeBreakdownTable, with a combined Doer/Validator column added when the
 * team has the split.
 *
 * Capped at 6 columns and never wrapped in overflow-x-auto — same "stack, don't drop, don't
 * scroll" rule the Tool-Assisted page's ticket table already established. Doer/Validator share
 * one cell (stacked, like Lead Time's Waiting/Active column), and Median/P90 share another,
 * rather than adding two more columns.
 *
 * Rows are sorted by volume (impact) server-side, not by speed — the individual-breakdown call
 * site depends on that to avoid reading as a "who's slowest" leaderboard.
 *
 * `categoryLabels` turns on grouping by Backend Changes / Investigations / Other — only meaningful
 * for the By Ticket Type table on the "All SE Work" view (no workCategory selected), where an
 * unbroken flat list would interleave doer-only Investigation rows among doer+validator Backend
 * Changes ones with no visual cue why some Validator cells are structurally empty (brief section 8).
 */
export function CycleTimeBreakdownTable({
  title,
  keyLabel,
  rows,
  hasDoerValidatorSplit,
  selectedKey,
  onSelect,
  categoryLabels,
}: {
  title: string;
  keyLabel: string;
  rows: CycleTimeBreakdownRow[];
  hasDoerValidatorSplit: boolean;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  categoryLabels?: { backend: string; investigations: string; other: string };
}) {
  const colSpan = hasDoerValidatorSplit ? 6 : 5;

  const groups: { key: CycleTimeWorkCategory | "other" | null; label: string | null; rows: CycleTimeBreakdownRow[] }[] = categoryLabels
    ? (["backend", "investigations", null] as const)
        .map((cat) => ({
          key: cat,
          label: cat === "backend" ? categoryLabels.backend : cat === "investigations" ? categoryLabels.investigations : categoryLabels.other,
          rows: rows.filter((r) => r.category === cat),
        }))
        .filter((g) => g.rows.length > 0)
    : [{ key: null, label: null, rows }];

  const row = (r: CycleTimeBreakdownRow) => {
    const isSelected = selectedKey === r.key;
    return (
      <tr
        key={r.key}
        onClick={onSelect ? () => onSelect(isSelected ? null : r.key) : undefined}
        className={onSelect ? `cursor-pointer transition-colors ${isSelected ? "bg-sprout-50" : "hover:bg-neutral-50"}` : undefined}
      >
        <td className="px-3 py-2.5 text-neutral-900 break-words">{r.key}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
        {hasDoerValidatorSplit && (
          <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs leading-tight">
            <div>{fmtMain(r.avgDoerMinutes)}<span className="text-neutral-400"> / </span>{fmtMain(r.avgValidatorMinutes)}</div>
          </td>
        )}
        <td className="px-3 py-2.5 text-right tabular-nums font-medium">
          {fmtMain(r.avgTotalMinutes)}
          <span className="block text-[11px] font-normal text-neutral-400">{formatDurationBreakdown(r.avgTotalMinutes) ?? "—"}</span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs">
          {fmtMain(r.medianTotalMinutes)}<span className="text-neutral-400"> / </span>{fmtMain(r.p90TotalMinutes)}
        </td>
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
            <th className="px-3 py-3 w-[28%]">{keyLabel}</th>
            <th className="px-3 py-3 text-right w-[12%]">Vol.</th>
            {hasDoerValidatorSplit && <th className="px-3 py-3 text-right w-[20%]">Doer / Validator</th>}
            <th className="px-3 py-3 text-right w-[15%]">Avg Total</th>
            <th className="px-3 py-3 text-right w-[15%]">Median / P90</th>
            <th className="px-3 py-3 text-right w-[10%]">Long</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-3 py-6 text-center text-neutral-400">No data for this period.</td>
            </tr>
          ) : (
            groups.map((g) => (
              <Fragment key={String(g.key)}>
                {g.label && (
                  <tr className="bg-neutral-50/70">
                    <td colSpan={colSpan} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
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
