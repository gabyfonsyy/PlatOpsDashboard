"use client";

import { useState } from "react";
import type { CycleTimeTicketOutlier } from "@/lib/lead-cycle-time";
import { formatDaysValue, formatDurationBreakdown } from "@/lib/format";
import { meaningfulLabels } from "@/lib/ticket-breakdowns";

function fmtMain(minutes: number | null): string {
  return minutes === null ? "—" : formatDaysValue(minutes);
}

const DOMINANT_LABEL: Record<NonNullable<CycleTimeTicketOutlier["dominant"]>, string> = {
  doer: "Execution is the primary outlier",
  validator: "Validation is the primary outlier",
  balanced: "Both sides contributed",
};

type TabKey = "execute" | "validate" | "end-to-end";

/**
 * The three "longest work" rankings from the brief — Longest to Execute (by Doer), Longest to
 * Validate (by Validator, reviewed tickets only), Longest End-to-End (by Total, merged with
 * outlier analysis: anything above this period's long-running threshold, same call the Lead Time
 * deep-dive makes). For a team without the Doer/Validator split there is only one meaningful
 * ranking, so the tabs are hidden and this renders as a plain Long-Running Work table.
 *
 * The tab row is its OWN block below the title/description, never sharing a line with them — the
 * two used to sit side by side and jumped position whenever the description wrapped to a second
 * line on a shorter-titled tab (her fix, 2026-09-03: keep it anchored at the bottom of the header
 * no matter how much text is above it).
 *
 * Capped at 5 columns (4 without the split) with no overflow-x-auto — Doer/Validator share one
 * stacked cell, and the "why it's long" reason folds into the Total cell as a sub-line instead of
 * its own column.
 */
export function CycleTimeLongestWorkTable({
  hasDoerValidatorSplit,
  longestToExecute,
  longestToExecuteTotalCount,
  longestToValidate,
  longestToValidateTotalCount,
  longestEndToEnd,
  longestEndToEndTotalCount,
  assigneeLabel,
  jiraBaseUrl,
  labels,
  extraExcludedLabels,
  nonSplitTitle,
}: {
  hasDoerValidatorSplit: boolean;
  longestToExecute: CycleTimeTicketOutlier[];
  longestToExecuteTotalCount: number;
  longestToValidate: CycleTimeTicketOutlier[];
  longestToValidateTotalCount: number;
  longestEndToEnd: CycleTimeTicketOutlier[];
  longestEndToEndTotalCount: number;
  assigneeLabel: string;
  jiraBaseUrl?: string;
  labels: { execute: string; validate: string; endToEnd: string };
  extraExcludedLabels?: string[];
  /** Title for the no-split single-table case. Defaults to the generic DBA/DevOps wording — pass
   * something like "Longest Investigations" when this is SE scoped to a doer-only category. */
  nonSplitTitle?: string;
}) {
  const [tab, setTab] = useState<TabKey>(hasDoerValidatorSplit ? "execute" : "end-to-end");

  const active = !hasDoerValidatorSplit
    ? { rows: longestEndToEnd, total: longestEndToEndTotalCount, sortedBy: "total" as const }
    : tab === "execute"
      ? { rows: longestToExecute, total: longestToExecuteTotalCount, sortedBy: "doer" as const }
      : tab === "validate"
        ? { rows: longestToValidate, total: longestToValidateTotalCount, sortedBy: "validator" as const }
        : { rows: longestEndToEnd, total: longestEndToEndTotalCount, sortedBy: "total" as const };

  const showWhy = tab === "end-to-end" || !hasDoerValidatorSplit;
  const truncated = active.total > active.rows.length;
  const colSpan = hasDoerValidatorSplit ? 5 : 4;

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            {!hasDoerValidatorSplit ? nonSplitTitle ?? "Long-Running Work & Outliers" : tab === "execute" ? labels.execute : tab === "validate" ? labels.validate : labels.endToEnd}
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            {!hasDoerValidatorSplit
              ? "Completed tickets significantly above this period's typical Cycle Time — not a measure of individual performance."
              : tab === "execute"
                ? "Ranked by Doer (execution) time — what's consuming the most execution effort."
                : tab === "validate"
                  ? "Ranked by Validator (review) time, over reviewed tickets only — what's consuming the most review effort."
                  : "Completed tickets significantly above this period's typical total Cycle Time — not a measure of individual performance."}
            {truncated && ` Showing the ${active.rows.length} longest of ${active.total}.`}
          </p>
        </div>
        {hasDoerValidatorSplit && (
          <div className="flex gap-1 mt-3">
            {([
              ["execute", labels.execute],
              ["validate", labels.validate],
              ["end-to-end", labels.endToEnd],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                  tab === key ? "bg-sprout-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[22%]">Ticket</th>
            <th className="px-3 py-3 w-[16%]">{assigneeLabel}</th>
            <th className="px-3 py-3 w-[27%]">Product / Label</th>
            {hasDoerValidatorSplit && <th className="px-3 py-3 text-right w-[15%]">Doer / Validator</th>}
            <th className={`px-3 py-3 text-right ${hasDoerValidatorSplit ? "w-[20%]" : "w-[35%]"}`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {active.rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-3 py-6 text-center text-neutral-400">
                {tab === "validate" ? "No reviewed tickets in this period yet." : "Nothing unusually long this period."}
              </td>
            </tr>
          ) : (
            active.rows.map((t) => {
              const rowLabels = meaningfulLabels(t.labels, extraExcludedLabels);
              return (
                <tr key={t.issueKey}>
                  <td className="px-3 py-3 font-medium text-neutral-900 break-words">
                    {jiraBaseUrl ? (
                      <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
                        {t.issueKey}
                      </a>
                    ) : (
                      t.issueKey
                    )}
                    <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                  </td>
                  <td className="px-3 py-3 break-words">{t.assignee}</td>
                  <td className="px-3 py-3 break-words">
                    {t.product}
                    {rowLabels.length > 0 && <span className="block text-xs text-neutral-500">{rowLabels.join(", ")}</span>}
                  </td>
                  {hasDoerValidatorSplit && (
                    <td className="px-3 py-3 text-right tabular-nums text-xs leading-tight">
                      <div className={active.sortedBy === "doer" ? "font-medium text-neutral-900" : "text-neutral-500"}>
                        {fmtMain(t.doerMinutes)} <span className="text-neutral-400">({formatDurationBreakdown(t.doerMinutes)})</span>
                      </div>
                      <div className={active.sortedBy === "validator" ? "font-medium text-neutral-900" : "text-neutral-500"}>
                        {t.validatorMinutes === null ? "—" : (
                          <>{fmtMain(t.validatorMinutes)} <span className="text-neutral-400">({formatDurationBreakdown(t.validatorMinutes)})</span></>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-3 text-right tabular-nums">
                    <div className={active.sortedBy === "total" ? "font-medium text-neutral-900" : ""}>
                      {fmtMain(t.totalMinutes)} <span className="text-neutral-400 font-normal">({formatDurationBreakdown(t.totalMinutes)})</span>
                    </div>
                    {showWhy && (
                      <div className="text-xs text-neutral-500 font-normal mt-0.5">
                        {t.dominant ? DOMINANT_LABEL[t.dominant] : t.vsMedianTotalPct !== null ? `+${Math.round(t.vsMedianTotalPct * 100)}% vs median` : "—"}
                      </div>
                    )}
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
