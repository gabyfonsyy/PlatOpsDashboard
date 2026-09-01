import { Badge } from "@/components/ui/Badge";
import { categoryTone, type ToolAssistedTicket } from "@/lib/tool-assisted";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { formatNumber } from "@/lib/format";

/**
 * The tool-assisted tickets themselves, longest first — the row-level backing for every average on
 * the page, and where an outlier gets a name.
 *
 * BUILT TO FIT WITHOUT HORIZONTAL SCROLL, which is a constraint on the column count, not a styling
 * detail. Ten columns scrolled sideways; this is six, reached by stacking rather than dropping:
 *
 *   - issue type moved under the ticket key (it was a whole column holding one short word);
 *   - product moved under the category badge, since both answer "what kind of work is this";
 *   - SE and reviewer share one People column, two lines — they are never compared side by side,
 *     they are read as "who did it / who reviewed it";
 *   - "Goes Into" became a badge under the Avg figure it describes, rather than a seventh column.
 *
 * Nothing was removed to achieve that. If a column is ever added back, something has to stack.
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
          Slowest first, by whichever measure the ticket has. Durations in days.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-2">Ticket</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">People</th>
            <th className="px-3 py-2 text-right">Doer</th>
            <th className="px-3 py-2 text-right">Reviewer</th>
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {tickets.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">
                No tool-assisted tickets with a measurable cycle for this period.
              </td>
            </tr>
          ) : (
            tickets.map((t) => (
              <tr key={t.issueKey} className="align-top">
                <td className="px-3 py-2.5">
                  {jiraBaseUrl ? (
                    <a
                      href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`}
                      target="_blank"
                      rel="noreferrer"
                      title={t.labels || undefined}
                      className="font-medium text-sprout-700 hover:underline whitespace-nowrap"
                    >
                      {t.issueKey}
                    </a>
                  ) : (
                    <span className="font-medium text-neutral-900 whitespace-nowrap">{t.issueKey}</span>
                  )}
                  <span className="block text-[11px] text-neutral-400">{t.issueType || "—"}</span>
                </td>

                <td className="px-3 py-2.5">
                  {t.category ? (
                    <Badge tone={categoryTone(t.category)}>{t.category}</Badge>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                  {/* Product first, then the specific label — the product is the coarser bucket, so
                      it reads outside-in. */}
                  <span className="block text-[11px] text-neutral-400 mt-0.5">
                    {[t.product, t.primaryLabel].filter(Boolean).join(" · ") || "—"}
                  </span>
                </td>

                <td className="px-3 py-2.5 text-neutral-600">
                  {/* Blank means the Assigned SE was off-roster or empty — the count of those is
                      reported under the SE table rather than repeated on every row. */}
                  <span className="block">
                    {t.assignee || <span className="text-neutral-300">off-roster</span>}
                  </span>
                  <span className="block text-[11px] text-neutral-400">
                    {t.reviewers.length ? `rev: ${t.reviewers.join(", ")}` : "no reviewer"}
                    {/* More than one closed cycle means it bounced; worth seeing, because it inflates
                        the review figure for a reason that isn't the reviewer. */}
                    {t.peerReviewCycleCount > 1 && ` · ${formatNumber(t.peerReviewCycleCount)} cycles`}
                  </span>
                </td>

                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <DurationCell minutes={t.actualCycleMinutes} />
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <DurationCell minutes={t.peerReviewMinutes} />
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <DurationCell minutes={t.totalCycleMinutes} strong />
                  {t.dominantStage && (
                    <span className="block text-[11px] text-neutral-400 mt-0.5">
                      {t.dominantStage === "Peer review" ? "review-heavy" : "effort-heavy"}
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
        Total is that ticket&apos;s doer time plus reviewer time, so it is blank until the ticket has
        both — a dash under Reviewer means no review cycle has closed to On Hold or For Checking yet,
        not zero time. Hover a ticket key for its full label list.
      </p>
    </div>
  );
}
