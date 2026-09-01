import { Badge } from "@/components/ui/Badge";
import type { WorkTypeBreakdown } from "@/lib/tool-assisted";
import { formatDurationBreakdown, formatNumber } from "@/lib/format";

/**
 * Product + label, ranked by total time consumed — the "what should the tool do next" table.
 *
 * Covers EVERY in-scope ticket, not just the tool-assisted ones, because the combinations worth
 * building for are by definition the ones the tool doesn't cover yet. The `Assisted` column is what
 * separates the two readings: a row with high time and few assisted tickets is a gap in coverage; a
 * row with high time and mostly assisted tickets means the tool is already there and isn't helping,
 * which is a bug report rather than a feature request.
 *
 * Ranked on total, not average, for the same reason as the SE table: a slow combination that happens
 * twice a quarter is not where the hours are.
 */
export function ToolAssistedWorkTypeTable({
  byWorkType,
  limit = 15,
}: {
  byWorkType: WorkTypeBreakdown[];
  /** Long tail is mostly one-ticket combinations; the count of what's hidden is stated below. */
  limit?: number;
}) {
  const shown = byWorkType.slice(0, limit);
  const hidden = byWorkType.length - shown.length;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">Where the hours actually go</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Product and label combinations, most time-consuming first — the shortlist for what the tool
          should cover next.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">Label / Issue Type</th>
              <th className="px-4 py-2 text-right">Tickets</th>
              <th className="px-4 py-2 text-right">Assisted</th>
              <th className="px-4 py-2 text-right">Avg Effort</th>
              <th className="px-4 py-2 text-right">Avg Review</th>
              <th className="px-4 py-2 text-right">Total Time</th>
              <th className="px-4 py-2">Goes Into</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">
                  No measurable cycles in this period.
                </td>
              </tr>
            )}

            {shown.map((w) => (
              <tr key={`${w.product}-${w.label}`}>
                <td className="px-4 py-2.5 text-neutral-700">{w.product}</td>
                <td className="px-4 py-2.5 text-neutral-600 whitespace-nowrap">{w.label}</td>
                <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">
                  {formatNumber(w.ticketCount)}
                </td>
                {/* "0 of 6" is the row to act on, so the ratio is shown rather than a bare count. */}
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  <span
                    className={
                      w.toolAssistedCount === 0
                        ? "text-amber-600 font-medium"
                        : "text-neutral-600"
                    }
                  >
                    {formatNumber(w.toolAssistedCount)} of {formatNumber(w.ticketCount)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                  {formatDurationBreakdown(w.actual.avgMinutes) ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                  {formatDurationBreakdown(w.peerReview.avgMinutes) ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                  {formatDurationBreakdown(w.totalMinutes) ?? "—"}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {w.dominantStage ? (
                    <Badge tone={w.dominantStage === "Peer review" ? "warning" : "neutral"}>
                      {w.dominantStage}
                    </Badge>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        Total time is execution plus review across the combination&apos;s tickets. The second column is
        the ticket&apos;s work-type label (cp-attendance, update-featureflag, …) where it has one — including
        on tickets nobody used the tool for, which is exactly the coverage gap — and its issue type where
        it doesn&apos;t. Process labels like autoclose-nonresponse or jira_escalated are deliberately not
        used as a grouping: they record how a ticket was handled, not what the work was.
        {hidden > 0 && (
          <>
            {" "}
            {formatNumber(hidden)} further combination{hidden === 1 ? "" : "s"} below the top{" "}
            {formatNumber(shown.length)} are not shown — they are the long tail of one-off pairings.
          </>
        )}
      </p>
    </div>
  );
}
