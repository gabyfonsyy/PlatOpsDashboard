import { PeerReviewByReviewer, PeerReviewCycle, PeerReviewInReview } from "@/lib/peer-review";
import { formatMinutes, formatManilaDate } from "@/lib/format";

export function PeerReviewWaitTable({
  byReviewer,
  cycles,
  inReview,
}: {
  byReviewer: PeerReviewByReviewer[];
  cycles: PeerReviewCycle[];
  inReview: PeerReviewInReview[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {inReview.length > 0 && (
        <div className="card p-4 border-neutral-200 bg-neutral-50">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">
            Currently In Review ({inReview.length})
          </h3>
          <ul className="text-sm text-neutral-600 flex flex-col gap-1">
            {inReview.map((c) => (
              <li key={c.issueKey}>
                <span className="font-medium">{c.issueKey}</span> — {c.reviewer || "unassigned"} — entered review{" "}
                {formatManilaDate(c.enteredAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Reviewer</th>
              <th className="px-4 py-3">Reviews</th>
              <th className="px-4 py-3">Avg Wait</th>
              <th className="px-4 py-3">Max Wait</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {byReviewer.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">No completed peer reviews for this period.</td>
              </tr>
            ) : (
              byReviewer.map((r) => (
                <tr key={r.reviewerName}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">{r.reviewerName}</td>
                  <td className="px-4 py-3">{r.cycleCount}</td>
                  <td className="px-4 py-3">{formatMinutes(r.avgWaitMinutes)}</td>
                  <td className="px-4 py-3">{formatMinutes(r.maxWaitMinutes)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Ticket</th>
              <th className="px-4 py-3">Reviewer</th>
              <th className="px-4 py-3">Entered Review</th>
              <th className="px-4 py-3">Exited To</th>
              <th className="px-4 py-3">Wait Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {cycles.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No completed peer-review cycles for this period.</td>
              </tr>
            ) : (
              cycles.map((c, i) => (
                <tr key={`${c.issueKey}-${i}`}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">{c.issueKey}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{c.reviewer}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(c.enteredAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{c.exitedToStatus}</td>
                  <td className="px-4 py-3">{formatMinutes(c.waitMinutes)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
