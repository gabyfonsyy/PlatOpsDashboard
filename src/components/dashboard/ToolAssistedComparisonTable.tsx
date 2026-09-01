import type { CycleStats } from "@/lib/tool-assisted";
import { formatDurationBreakdown, formatNumber, formatPercent } from "@/lib/format";

/**
 * The head-to-head: the same three measures for tool-assisted tickets and for everything else,
 * with the gap on each row.
 *
 * A table rather than six metric cards because the comparison IS the content — the eye needs to
 * read across a row to get the answer, and cards make that a hunt. "Faster by" is per measure on
 * purpose: the tool can only plausibly shorten execution, so a headline that blends execution and
 * review would hide its actual effect behind a stage it doesn't touch.
 */
export function ToolAssistedComparisonTable({
  label,
  toolAssisted,
  others,
  fasterBy,
}: {
  label: string;
  toolAssisted: CycleStats;
  others: CycleStats;
  fasterBy: { actual: number | null; peerReview: number | null; avgOfTwo: number | null };
}) {
  const rows = [
    {
      measure: "Actual effort",
      note: "out of To Do → For Peer Review",
      tool: toolAssisted.actual,
      other: others.actual,
      gap: fasterBy.actual,
    },
    {
      measure: "Peer review",
      note: "in For Peer Review → On Hold / For Checking",
      tool: toolAssisted.peerReview,
      other: others.peerReview,
      gap: fasterBy.peerReview,
    },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">Cycle time, stage by stage</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Tickets labeled &quot;{label}&quot; against every other in-scope ST ticket created in the period.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2 text-right">Tool-Assisted</th>
              <th className="px-4 py-2 text-right">Other Tickets</th>
              <th className="px-4 py-2 text-right">Faster By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.measure} className="align-top">
                <td className="px-4 py-3">
                  <span className="block font-medium text-neutral-900">{r.measure}</span>
                  <span className="block text-xs text-neutral-400">{r.note}</span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <span className="block font-semibold text-neutral-900 tabular-nums">
                    {formatDurationBreakdown(r.tool.avgMinutes) ?? "—"}
                  </span>
                  <span className="block text-xs text-neutral-400 tabular-nums">
                    {formatNumber(r.tool.count)} measured
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <span className="block text-neutral-700 tabular-nums">
                    {formatDurationBreakdown(r.other.avgMinutes) ?? "—"}
                  </span>
                  <span className="block text-xs text-neutral-400 tabular-nums">
                    {formatNumber(r.other.count)} measured
                  </span>
                </td>
                {/* Green only when the tool is actually ahead. A negative "faster by" is the finding
                    that matters most on this page, so it must not be dressed as a win. */}
                <td
                  className={`px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${
                    r.gap === null
                      ? "text-neutral-300"
                      : r.gap >= 0
                        ? "text-emerald-600"
                        : "text-red-600"
                  }`}
                >
                  {formatPercent(r.gap)}
                </td>
              </tr>
            ))}

            <tr className="align-top bg-neutral-50/40">
              <td className="px-4 py-3">
                <span className="block font-medium text-neutral-900">Average of the two</span>
                <span className="block text-xs text-neutral-400">
                  mean of the two stage averages above
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                {formatDurationBreakdown(toolAssisted.avgOfTwoMinutes) ?? "—"}
              </td>
              <td className="px-4 py-3 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                {formatDurationBreakdown(others.avgOfTwoMinutes) ?? "—"}
              </td>
              <td
                className={`px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${
                  fasterBy.avgOfTwo === null
                    ? "text-neutral-300"
                    : fasterBy.avgOfTwo >= 0
                      ? "text-emerald-600"
                      : "text-red-600"
                }`}
              >
                {formatPercent(fasterBy.avgOfTwo)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        The two stages have different denominators — a ticket can have execution time measured and no
        completed review yet — so &quot;measured&quot; is stated per row and the average of the two is
        the mean of the two averages, not a per-ticket figure.
        {toolAssisted.peerReviewExcludedCycles + others.peerReviewExcludedCycles > 0 && (
          <>
            {" "}
            {formatNumber(toolAssisted.peerReviewExcludedCycles + others.peerReviewExcludedCycles)} review
            cycle
            {toolAssisted.peerReviewExcludedCycles + others.peerReviewExcludedCycles === 1 ? "" : "s"} in
            this period exited somewhere other than On Hold or For Checking (bounced back, cancelled) and
            are excluded.
          </>
        )}
      </p>
    </div>
  );
}
