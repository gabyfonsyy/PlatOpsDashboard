import { Badge } from "@/components/ui/Badge";
import { categoryTone, type ToolAssistedTicket } from "@/lib/tool-assisted";
import { formatDurationBreakdown, formatNumber } from "@/lib/format";

/**
 * The tool-assisted tickets themselves, longest first — the row-level backing for every average on
 * the page, and where an outlier gets a name.
 *
 * The two timestamp columns this table used to show (moved out of To Do / entered For Peer Review)
 * were dropped when the review stage was added: six duration and date columns forced horizontal
 * scrolling, and the dates were never the thing being read — the durations were. Both remain on the
 * row as the link's hover title.
 */
export function ToolAssistedTable({
  tickets,
  jiraBaseUrl,
}: {
  tickets: ToolAssistedTicket[];
  jiraBaseUrl?: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70">
        <h2 className="text-sm font-semibold text-neutral-900">Tool-assisted tickets</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Slowest first, by whichever measure the ticket has.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Ticket</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">SE</th>
              <th className="px-4 py-2">Reviewer</th>
              <th className="px-4 py-2 text-right">Effort</th>
              <th className="px-4 py-2 text-right">Review</th>
              <th className="px-4 py-2 text-right">Avg</th>
              <th className="px-4 py-2">Goes Into</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-neutral-400">
                  No tool-assisted tickets with a measurable cycle for this period.
                </td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.issueKey}>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                    {jiraBaseUrl ? (
                      <a
                        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`}
                        target="_blank"
                        rel="noreferrer"
                        title={t.labels || undefined}
                        className="text-sprout-700 hover:underline"
                      >
                        {t.issueKey}
                      </a>
                    ) : (
                      <span className="text-neutral-900">{t.issueKey}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600 whitespace-nowrap">{t.issueType}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {t.category ? (
                      <>
                        <Badge tone={categoryTone(t.category)}>{t.category}</Badge>
                        {t.primaryLabel && (
                          <span className="block text-[11px] text-neutral-400 mt-0.5">
                            {t.primaryLabel}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">{t.product || "—"}</td>
                  <td className="px-4 py-2.5 text-neutral-600 whitespace-nowrap">{t.assignee}</td>
                  <td className="px-4 py-2.5 text-neutral-600 whitespace-nowrap">
                    {t.reviewers.length ? t.reviewers.join(", ") : <span className="text-neutral-300">—</span>}
                    {/* More than one completed review cycle means it bounced; worth seeing on the row
                        because it inflates the review number for a reason that isn't the reviewer. */}
                    {t.peerReviewCycleCount > 1 && (
                      <span className="block text-[11px] text-neutral-400">
                        {formatNumber(t.peerReviewCycleCount)} cycles
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                    {formatDurationBreakdown(t.actualCycleMinutes) ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums whitespace-nowrap">
                    {formatDurationBreakdown(t.peerReviewMinutes) ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                    {formatDurationBreakdown(t.avgCycleMinutes) ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {t.dominantStage ? (
                      <Badge tone={t.dominantStage === "Peer review" ? "warning" : "neutral"}>
                        {t.dominantStage}
                      </Badge>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        Avg is the mean of that ticket&apos;s own two measures, so it is blank until the ticket has both
        — a dash in Review means no review cycle has closed to On Hold or For Checking yet, not zero
        time.
      </p>
    </div>
  );
}
