import { Fragment } from "react";
import { Badge } from "@/components/ui/Badge";
import { categoryTone, type CategoryBreakdown } from "@/lib/tool-assisted";
import { formatDurationBreakdown, formatNumber } from "@/lib/format";

/**
 * What the tool is actually being used FOR: category (from the ticket's labels) split by issue type.
 *
 * Two levels in one table rather than two tables — the category totals and the issue types under
 * them are the same question at two zoom levels, and splitting them would mean reading a number in
 * one place and its parts in another. The category row carries the totals; the indented rows are its
 * issue types.
 *
 * The labels line under each category is there for Misc above all: Misc is tool-assisted work we
 * haven't named a category for, so the labels it carries are the candidate list for the next
 * category to define.
 */
export function ToolAssistedCompositionTable({ byCategory }: { byCategory: CategoryBreakdown[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">What the tool is used for</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Tool-assisted tickets by label category, then by issue type.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Category / Issue Type</th>
              <th className="px-4 py-2 text-right">Tickets</th>
              <th className="px-4 py-2 text-right">Avg Effort</th>
              <th className="px-4 py-2 text-right">Avg Review</th>
              <th className="px-4 py-2 text-right">Avg of Two</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {byCategory.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  No tool-assisted tickets with a measurable cycle in this period.
                </td>
              </tr>
            )}

            {byCategory.map((c) => (
              <Fragment key={c.category}>
                <tr className="bg-neutral-50/40">
                  <td className="px-4 py-2.5">
                    <Badge tone={categoryTone(c.category)}>{c.category}</Badge>
                    {c.labels.length > 0 && (
                      <span className="block text-[11px] text-neutral-400 mt-1">
                        {c.labels
                          .map((l) => `${l.label} (${l.ticketCount})`)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums">
                    {formatNumber(c.stats.ticketCount)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                    {formatDurationBreakdown(c.stats.actual.avgMinutes) ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                    {formatDurationBreakdown(c.stats.peerReview.avgMinutes) ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                    {formatDurationBreakdown(c.stats.avgOfTwoMinutes) ?? "—"}
                  </td>
                </tr>

                {c.byIssueType.map((t) => (
                  <tr key={`${c.category}-${t.issueType}`}>
                    <td className="px-4 py-2 pl-8 text-neutral-600">{t.issueType}</td>
                    <td className="px-4 py-2 text-right text-neutral-600 tabular-nums">
                      {formatNumber(t.stats.ticketCount)}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-600 tabular-nums whitespace-nowrap">
                      {formatDurationBreakdown(t.stats.actual.avgMinutes) ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-600 tabular-nums whitespace-nowrap">
                      {formatDurationBreakdown(t.stats.peerReview.avgMinutes) ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-600 tabular-nums whitespace-nowrap">
                      {formatDurationBreakdown(t.stats.avgOfTwoMinutes) ?? "—"}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        Company Policies: cp-companypolicy, cp-sa, cp-ot, cp-coa, cp-ob, cp-ut, cp-attendance,
        cp-mirror, update-companypolicy · Webconfig: update-webconfig · Feature Flags: update-featureflag · Misc:
        tool-assisted with none of those. A ticket matching two groups is filed under the first, so the
        counts sum to the tool-assisted total.
      </p>
    </div>
  );
}
