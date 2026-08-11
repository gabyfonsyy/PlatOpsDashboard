import { getPeerReviewWaitReport } from "@/lib/peer-review";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { PeerReviewWaitTable } from "@/components/dashboard/PeerReviewWaitTable";

export default async function PeerReviewWaitPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);
  const report = await getPeerReviewWaitReport(range, period);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>Review Wait Time</h1>
          <p className="text-sm text-neutral-500 mt-1">
            How long tickets sit in For Peer Review before moving to On Hold or For Checking, by reviewer.
          </p>
        </div>
        <FilterBar />
      </div>

      <PeerReviewWaitTable byReviewer={report.byReviewer} cycles={report.cycles} inReview={report.inReview} />
    </div>
  );
}
