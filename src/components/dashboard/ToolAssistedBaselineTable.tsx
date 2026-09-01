import { Badge } from "@/components/ui/Badge";
import {
  categoryTone,
  BASELINE_WINDOW_MONTHS,
  TOOL_RELEASED_ON,
  type BaselineComparison,
} from "@/lib/tool-assisted";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { formatNumber, formatPercent, formatManilaDate } from "@/lib/format";

/**
 * Below this many assisted tickets the percentages are arithmetic, not evidence — Webconfig had ONE
 * assisted ticket and produced a "99.3% faster", which is a single ticket's luck rendered as a
 * finding. The figures are still shown (hiding data invites the assumption it's being massaged) but
 * the row says not to read them.
 */
const MIN_READABLE_SAMPLE = 5;

function GapCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-300 text-xs">—</span>;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        value >= 0 ? "text-emerald-600" : "text-red-600"
      }`}
    >
      {value >= 0 ? "−" : "+"}
      {formatPercent(Math.abs(value))}
    </span>
  );
}

/**
 * Before the tool vs with the tool, per category, like-for-like — cp-attendance measured against
 * cp-attendance rather than against Backend Changes.
 *
 * The three columns are BASELINE (before release), WITH TOOL, and MANUAL (after release, tool not
 * used). "Before" and "Without tool" were the original names and they read as the same thing, since
 * the baseline is also without the tool — what separates them is WHEN. So the headers now carry their
 * period as a subtitle, and the third says how the work was done rather than what it lacked.
 *
 * Manual is the control, and is not decoration: same weeks as the assisted tickets, same kind of
 * work, no tool. Read the three together —
 *
 *   assisted improved, control didn't  ->  the tool did it;
 *   both improved about equally        ->  the period did it, not the tool;
 *   assisted improved less            ->  the tool is costing time on this category.
 *
 * A before/after pair alone cannot distinguish those, which is why it isn't offered alone.
 */
export function ToolAssistedBaselineTable({ comparisons }: { comparisons: BaselineComparison[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">Before the tool vs now</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Same labels either side, so the comparison is like-for-like. Durations in days; a green
          figure is time saved against the baseline — the fixed {BASELINE_WINDOW_MONTHS} months before
          the tool&apos;s release on {formatManilaDate(TOOL_RELEASED_ON)}, the same window for every
          category. Total is doer + reviewer, end to end.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2 text-right">
                Baseline
                <span className="block normal-case tracking-normal font-normal text-neutral-400">
                  fixed · before release
                </span>
              </th>
              <th className="px-3 py-2 text-right">
                With Tool
                <span className="block normal-case tracking-normal font-normal text-neutral-400">
                  selected period
                </span>
              </th>
              <th className="px-3 py-2 text-right">
                Manual
                <span className="block normal-case tracking-normal font-normal text-neutral-400">
                  selected period, no tool
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {comparisons.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-400">
                  No category has a tool-assisted ticket yet, so there is no cutoff to compare against.
                </td>
              </tr>
            )}

            {comparisons.map((c) => {
              const stages = [
                {
                  key: "effort",
                  label: "Cycle time (doer)",
                  before: c.before.actual.avgMinutes,
                  assisted: c.assisted.actual.avgMinutes,
                  unassisted: c.unassisted.actual.avgMinutes,
                  gap: c.improvement.actual,
                  control: c.controlImprovement.actual,
                },
                {
                  key: "review",
                  label: "Cycle time (reviewer)",
                  before: c.before.peerReview.avgMinutes,
                  assisted: c.assisted.peerReview.avgMinutes,
                  unassisted: c.unassisted.peerReview.avgMinutes,
                  gap: c.improvement.peerReview,
                  control: c.controlImprovement.peerReview,
                },
                {
                  key: "total",
                  label: "Total cycle time",
                  before: c.before.combinedAvgMinutes,
                  assisted: c.assisted.combinedAvgMinutes,
                  unassisted: c.unassisted.combinedAvgMinutes,
                  gap: c.improvement.combined,
                  control: c.controlImprovement.combined,
                },
              ];

              return stages.map((st, i) => (
                <tr
                  key={`${c.category}-${st.key}`}
                  className={`align-top ${st.key === "total" ? "bg-neutral-50/40" : ""}`}
                >
                  {/* The category cell spans its three stage rows, so the table reads as three
                      blocks rather than nine unrelated lines. */}
                  {i === 0 ? (
                    <td className="px-3 py-2.5" rowSpan={3}>
                      <Badge tone={categoryTone(c.category)}>{c.category}</Badge>
                      {/* Released vs first used are different facts and both matter: the gap is
                          adoption lag, and on Webconfig it was seven weeks. */}
                      <span className="block text-[11px] text-neutral-400 mt-1">
                        first used {formatManilaDate(c.toolFirstUsedOn)}
                      </span>
                      <span className="block text-[11px] text-neutral-400">
                        {formatNumber(c.before.ticketCount)} baseline ·{" "}
                        {formatNumber(c.assisted.ticketCount)} with tool ·{" "}
                        {formatNumber(c.unassisted.ticketCount)} manual
                      </span>
                      {/* The span, spelled out, because "before" invites the assumption "all
                          history" and it is a fixed trailing window. */}
                      {c.beforeFrom && (
                        <span className="block text-[11px] text-neutral-400">
                          baseline {formatManilaDate(c.beforeFrom)} → {formatManilaDate(c.beforeTo)}
                        </span>
                      )}
                      {/* A period wholly before the release has nothing to put in the two live
                          columns; say so rather than leaving three rows of dashes to interpret. */}
                      {c.periodPredatesRelease && (
                        <span className="block text-[11px] text-amber-600 mt-0.5">
                          selected period is before release
                        </span>
                      )}
                      {/* Zero and "a handful" are different situations: one means nobody used the
                          tool this period, the other means the percentages are luck. */}
                      {!c.periodPredatesRelease && c.assisted.ticketCount === 0 && (
                        <span className="block text-[11px] text-amber-600 mt-0.5">
                          tool not used in this period
                        </span>
                      )}
                      {!c.periodPredatesRelease &&
                        c.assisted.ticketCount > 0 &&
                        c.assisted.ticketCount < MIN_READABLE_SAMPLE && (
                          <span className="block text-[11px] text-amber-600 mt-0.5">
                            too few assisted tickets to read
                          </span>
                        )}
                    </td>
                  ) : null}

                  <td className="px-3 py-2.5 text-neutral-700 whitespace-nowrap">
                    {st.key === "total" ? (
                      <span className="font-medium text-neutral-900">{st.label}</span>
                    ) : (
                      st.label
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <DurationCell minutes={st.before} />
                  </td>

                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <DurationCell minutes={st.assisted} strong />
                    <GapCell value={st.gap} />
                  </td>

                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <DurationCell minutes={st.unassisted} />
                    <GapCell value={st.control} />
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        <span className="font-medium text-neutral-500">
          Baseline is fixed; With Tool and Manual follow the period filter
        </span>{" "}
        — a baseline that moved when you changed the month would not be a baseline, but the two live
        columns are scoped like the rest of the page, so this reads as &quot;the selected period against
        a fixed reference&quot;. The cutoff is the
        tool&apos;s release date, {formatManilaDate(TOOL_RELEASED_ON)}, for all three categories; the
        &quot;first used&quot; date beside each is when it was actually picked up, and the gap between
        the two is adoption, not a different baseline. <span className="font-medium text-neutral-500">
          The baseline is the {BASELINE_WINDOW_MONTHS} months before that date, not all history
        </span>{" "}
        — cycle times come from changelog extraction, which was only backfilled recently, so older
        tickets either have no measurable cycle or, where they do, are the stale and reopened ones that
        happened to be re-synced. Those ran 2–10× slower than typical and would have inflated the
        baseline, flattering the tool. A longer baseline needs a changelog backfill over the earlier
        years first. <span className="font-medium text-neutral-500">Manual</span> is the control: same weeks
        as With Tool, same labels, tool not used. If it improved as much as With Tool, the period changed
        rather than the tool. Percentages are against that category&apos;s Baseline figure, and a category
        with fewer than {MIN_READABLE_SAMPLE} assisted tickets is flagged rather than trusted.
      </p>
    </div>
  );
}
