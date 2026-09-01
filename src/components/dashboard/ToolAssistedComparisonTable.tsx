import { BACKEND_EXECUTION_ISSUE_TYPES, type CycleStats } from "@/lib/tool-assisted";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { formatNumber, formatPercent } from "@/lib/format";

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
  fasterBy: { actual: number | null; peerReview: number | null; combined: number | null };
}) {
  const rows = [
    {
      measure: "Cycle time (doer)",
      note: "out of To Do → For Peer Review",
      tool: toolAssisted.actual,
      other: others.actual,
      gap: fasterBy.actual,
    },
    {
      measure: "Cycle time (reviewer)",
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
          Tickets labeled &quot;{label}&quot; against the rest of the team&apos;s backend execution work in
          the period. Durations in days.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2 text-right">Tool-Assisted</th>
              <th className="px-4 py-2 text-right">
                Other Backend Work
                <span className="block normal-case tracking-normal font-normal text-neutral-400">
                  not tool-assisted
                </span>
              </th>
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
                  <DurationCell minutes={r.tool.avgMinutes} strong />
                  <span className="block text-[11px] text-neutral-400 tabular-nums">
                    {formatNumber(r.tool.count)} measured
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <DurationCell minutes={r.other.avgMinutes} />
                  <span className="block text-[11px] text-neutral-400 tabular-nums">
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
                <span className="block font-medium text-neutral-900">Total cycle time</span>
                <span className="block text-xs text-neutral-400">
                  doer + reviewer, end to end
                </span>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <DurationCell minutes={toolAssisted.combinedAvgMinutes} strong />
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <DurationCell minutes={others.combinedAvgMinutes} />
              </td>
              <td
                className={`px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${
                  fasterBy.combined === null
                    ? "text-neutral-300"
                    : fasterBy.combined >= 0
                      ? "text-emerald-600"
                      : "text-red-600"
                }`}
              >
                {formatPercent(fasterBy.combined)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        <span className="font-medium text-neutral-500">
          Both columns cover backend execution only
        </span>{" "}
        — ST tickets of type {BACKEND_EXECUTION_ISSUE_TYPES.join(", ")}, created in the period, with at
        least one stage measurable. Investigations, Data Generation, External Support Request, Team Viewer
        and everything else are out of scope: their review path ends somewhere else, so their cycle time
        isn&apos;t the same measurement. Even so, the right-hand column is a MIX of backend work rather
        than the same jobs the tool covers, so part of any gap here is what the tickets were, not the
        tool. The like-for-like answer, same labels either side, is in &quot;Before the tool vs now&quot;
        below. The two stages have different denominators — a ticket can
        have doer time measured with no completed review yet — so &quot;measured&quot; is stated per row,
        and the total is the sum of the two stage averages rather than an average of per-ticket totals,
        which would drop every ticket still mid-review.
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
