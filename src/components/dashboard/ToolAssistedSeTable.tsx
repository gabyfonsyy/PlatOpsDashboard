import { Badge } from "@/components/ui/Badge";
import type { SeBreakdown } from "@/lib/tool-assisted";
import { TOOL_ASSISTED_REVIEWERS } from "@/lib/tool-assisted";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { formatNumber } from "@/lib/format";

/**
 * Per-SE time split by ROLE, across TOOL-ASSISTED tickets only — the only shape in which "is this
 * person slow?" has a fair answer, on the only tickets this page is about.
 *
 * Doer time and reviewer time are the same person's two different jobs, and the same name normally
 * appears in both columns. Keeping them side by side is the point: an SE whose execution is quick
 * but who sits on reviews for days needs a different conversation from one whose own tickets crawl,
 * and a single blended number per person would describe neither.
 *
 * Rows come from the ROSTER rather than from whoever appears in the data — which is what previously
 * let a bot account be ranked against people — and anyone with nothing in either role for the period
 * is then omitted, so the table is only the people who actually did something.
 *
 * Scoped to the selected period, like everything on this page except the fixed baseline column.
 */
export function ToolAssistedSeTable({
  bySe,
  unattributed = 0,
}: {
  bySe: SeBreakdown[];
  /** Tool-assisted tickets whose Assigned SE is blank or off-roster, so absent from these rows. */
  unattributed?: number;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">Where each SE&apos;s time goes</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Their own execution against their time reviewing other people&apos;s tickets, across
          tool-assisted tickets in the selected period. Durations in days. Only SEs with activity are
          listed.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">SE</th>
              <th className="px-4 py-2 text-right">Tickets Done</th>
              <th className="px-4 py-2 text-right">Avg As Doer</th>
              <th className="px-4 py-2 text-right">Reviews</th>
              <th className="px-4 py-2 text-right">Avg As Reviewer</th>
              {/* A sum across all their tickets, NOT doer+reviewer on one ticket — different meaning
                  from the Total column elsewhere on the page, hence the wording. */}
              <th className="px-4 py-2 text-right">Total Time Spent</th>
              <th className="px-4 py-2">Goes Into</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {bySe.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                  No roster SE worked on or reviewed a tool-assisted ticket in this period.
                </td>
              </tr>
            )}

            {bySe.map((se) => (
              <tr key={se.name} className="align-top">
                <td className="px-4 py-2.5 font-medium text-neutral-900 whitespace-nowrap">{se.name}</td>
                <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">
                  {formatNumber(se.asDoer.count)}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <DurationCell minutes={se.asDoer.avgMinutes} />
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">
                  {formatNumber(se.asReviewer.count)}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <DurationCell minutes={se.asReviewer.avgMinutes} />
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <DurationCell minutes={se.totalMinutes || null} strong />
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {/* Which of their two roles holds more of their hours. Neutral tones on purpose —
                      this is a diagnosis of where the time is, not a verdict on the person. */}
                  {se.dominantStage ? (
                    <Badge tone={se.dominantStage === "Peer review" ? "warning" : "neutral"}>
                      {se.dominantStage}
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
        Execution is attributed to the ticket&apos;s <span className="font-medium">Assigned SE</span>, never
        to Jira&apos;s Assignee. Review time goes to whoever held the ticket when it entered For Peer
        Review, derived from the changelog and then limited to the designated reviewers (
        {TOOL_ASSISTED_REVIEWERS.join(", ")}) — the same rule the Incident Logs validator uses, so the two
        can never disagree about who reviewed a ticket. A ticket reviewed across several cycles by
        different people splits its review time between them, so the column totals still add up to the
        real time spent.
        {unattributed > 0 && (
          <>
            {" "}
            <span className="text-amber-600">
              {formatNumber(unattributed)} tool-assisted ticket{unattributed === 1 ? "" : "s"} in this
              period {unattributed === 1 ? "is" : "are"} missing from these rows entirely — their Assigned
              SE is blank or names someone off the roster, so there is nobody to attribute the time to.
              Fixing the field in Jira brings {unattributed === 1 ? "it" : "them"} back.
            </span>
          </>
        )}
      </p>
    </div>
  );
}
