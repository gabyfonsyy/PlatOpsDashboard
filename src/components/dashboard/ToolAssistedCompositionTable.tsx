import { Badge } from "@/components/ui/Badge";
import { categoryTone, type CategoryBreakdown } from "@/lib/tool-assisted";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { formatNumber } from "@/lib/format";

/**
 * What the tool is actually being used FOR: one row per label category, and nothing below it.
 *
 * The issue-type sub-rows this table used to carry were removed. For ST the split was almost
 * entirely one issue type per category — 99 of 100 Company Policies tickets were issue type
 * "Company Policy" — so the second level restated its parent row and doubled the table's height to
 * do it. Issue type now appears only on the per-ticket table, where it identifies a row rather than
 * pretending to be a dimension.
 *
 * The labels line matters most for Misc: Misc is tool-assisted work no category is named for yet, so
 * the labels its tickets carry are the candidate list for the next category to define.
 */
export function ToolAssistedCompositionTable({ byCategory }: { byCategory: CategoryBreakdown[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">What the tool is used for</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Tool-assisted tickets by label category. Average cycle time in days; total is doer +
          reviewer.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2 text-right">Tickets</th>
              <th className="px-4 py-2 text-right">Doer</th>
              <th className="px-4 py-2 text-right">Reviewer</th>
              <th className="px-4 py-2 text-right">Total</th>
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
              <tr key={c.category} className="align-top">
                <td className="px-4 py-3">
                  <Badge tone={categoryTone(c.category)}>{c.category}</Badge>
                  {c.labels.length > 0 && (
                    <span className="block text-[11px] text-neutral-400 mt-1">
                      {c.labels.map((l) => `${l.label} (${l.ticketCount})`).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular-nums">
                  {formatNumber(c.stats.ticketCount)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <DurationCell minutes={c.stats.actual.avgMinutes} />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <DurationCell minutes={c.stats.peerReview.avgMinutes} />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <DurationCell minutes={c.stats.combinedAvgMinutes} strong />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        Company Policies: cp-companypolicy, cp-sa, cp-ot, cp-coa, cp-ob, cp-ut, cp-attendance,
        cp-mirror, update-companypolicy · Webconfig: update-webconfig · Feature Flags:
        update-featureflag · Misc: tool-assisted with none of those. A ticket matching two groups is
        filed under the first, so the counts sum to the tool-assisted total. Misc lists the labels its
        tickets carry as candidates for the next category worth naming, with process labels
        (jira_escalated, expedite, ffup-1, autoclose-nonresponse, automation-done and the like) left
        out — they say how a ticket was handled, not what the work was. No count or average is affected.
      </p>
    </div>
  );
}
