import type { LeadTimeOutlier } from "@/lib/lead-cycle-time";
import { formatManilaDate, formatMinutesDecimalValue, formatDurationBreakdown } from "@/lib/format";

/**
 * Long-Running Work + Outlier Analysis merged into one table — both sections in the brief answer
 * the same question ("what completed work took unusually long, and why") over the same
 * population (above the report's P90/2x-median threshold, see getLeadTimeDeepDive), so a second
 * near-duplicate table would just repeat this one. Framed as a process/complexity/dependency
 * question, not individual performance — holding reasons are shown when the data carries them.
 */
export function LeadTimeOutliersTable({
  rows,
  assigneeLabel,
  jiraBaseUrl,
  totalCount,
}: {
  rows: LeadTimeOutlier[];
  assigneeLabel: string;
  jiraBaseUrl?: string;
  /** True count above the long-running threshold — rows is capped to the 20 longest. */
  totalCount?: number;
}) {
  const truncated = totalCount !== undefined && totalCount > rows.length;
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Long-Running Work &amp; Outliers</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Completed tickets significantly above this period&apos;s typical Lead Time — not a measure of individual performance; look for process,
          dependency, or complexity patterns.
          {truncated && ` Showing the ${rows.length} longest of ${totalCount}.`}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">{assigneeLabel}</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Resolved</th>
            <th className="px-4 py-3 text-right">Lead Time</th>
            <th className="px-4 py-3 text-right">vs Median</th>
            <th className="px-4 py-3">Holding Reasons</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">No unusually long-running tickets this period.</td>
            </tr>
          ) : (
            rows.map((t) => (
              <tr key={t.issueKey}>
                <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                  {jiraBaseUrl ? (
                    <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
                      {t.issueKey}
                    </a>
                  ) : (
                    t.issueKey
                  )}
                  <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.product}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.createdAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.resolvedAt)}</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-medium">
                  {formatMinutesDecimalValue(t.minutes)} <span className="text-neutral-400 font-normal">({formatDurationBreakdown(t.minutes)})</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-amber-700">
                  {t.vsMedianPct === null ? "—" : `+${Math.round(t.vsMedianPct * 100)}%`}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">{t.holdingReasons.join(", ") || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
