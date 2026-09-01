import { Badge } from "@/components/ui/Badge";
import type { SeBreakdown } from "@/lib/tool-assisted";
import { formatDurationBreakdown, formatNumber } from "@/lib/format";

/**
 * Per-SE time split by ROLE — the only shape in which "is this person slow?" has a fair answer.
 *
 * Doer time and reviewer time are the same person's two different jobs, and the same name normally
 * appears in both columns. Keeping them side by side is the point: an SE whose execution is quick
 * but who sits on reviews for days needs a different conversation from one whose own tickets crawl,
 * and a single blended number per person would describe neither.
 *
 * Sorted by TOTAL minutes, not by average. The person to talk to first is the one the most hours are
 * flowing through — a 4-day average over two tickets is noise, and sorting by it would put noise on
 * top of the list.
 */
export function ToolAssistedSeTable({ bySe }: { bySe: SeBreakdown[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">Where each SE&apos;s time goes</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Their own execution against their time reviewing other people&apos;s tickets. Every in-scope
          ticket, tool-assisted or not.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">SE</th>
              <th className="px-4 py-2 text-right">Tickets Done</th>
              <th className="px-4 py-2 text-right">Avg Effort</th>
              <th className="px-4 py-2 text-right">Reviews</th>
              <th className="px-4 py-2 text-right">Avg Review</th>
              <th className="px-4 py-2 text-right">Total Time</th>
              <th className="px-4 py-2">Goes Into</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {bySe.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                  No measurable cycles in this period.
                </td>
              </tr>
            )}

            {bySe.map((se) => (
              <tr key={se.name}>
                <td className="px-4 py-2.5 font-medium text-neutral-900 whitespace-nowrap">{se.name}</td>
                <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">
                  {formatNumber(se.asDoer.count)}
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                  {formatDurationBreakdown(se.asDoer.avgMinutes) ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">
                  {formatNumber(se.asReviewer.count)}
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                  {formatDurationBreakdown(se.asReviewer.avgMinutes) ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                  {formatDurationBreakdown(se.totalMinutes) ?? "—"}
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
        Execution is attributed to the ticket&apos;s Assigned SE; review time to whoever held the ticket
        when it entered For Peer Review. A ticket reviewed across several cycles by different people
        splits its review time between them, so the column totals still add up to the real time spent.
      </p>
    </div>
  );
}
