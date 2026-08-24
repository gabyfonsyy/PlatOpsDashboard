import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getPeerReviewWaitReport } from "@/lib/peer-review";
import { resolveFilters } from "@/lib/date-ranges";
import { formatNumber, formatMinutesDecimalValue, formatDurationBreakdown } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PeerReviewWaitTable } from "@/components/dashboard/PeerReviewWaitTable";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default async function ReviewWaitPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_peer_review_tracking) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const report = await getPeerReviewWaitReport(range, period);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  // Derived here rather than in the report: these are presentation summaries of cycles the report
  // already returns, and computing them in the page keeps getPeerReviewWaitReport shared with the
  // Ticket Monitoring view unchanged.
  const waits = report.cycles.map((c) => c.waitMinutes).sort((a, b) => a - b);
  const total = waits.reduce((sum, w) => sum + w, 0);
  const avg = waits.length ? round2(total / waits.length) : null;
  const median = waits.length
    ? round2(waits.length % 2 ? waits[(waits.length - 1) / 2] : (waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2)
    : null;
  const max = waits.length ? round2(waits[waits.length - 1]) : null;

  const slowest = report.cycles.slice().sort((a, b) => b.waitMinutes - a.waitMinutes).slice(0, 15);
  const busiest = report.byReviewer.slice().sort((a, b) => b.cycleCount - a.cycleCount)[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link
            href={`/${team.team_key.toLowerCase()}?${query}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — Review Wait Time</h1>
          <p className="text-sm text-neutral-500 mt-1">
            How long tickets sat in For Peer Review before moving on to On Hold or For Checking,
            across review cycles that started in the period. Attributed to the reviewer the ticket
            was handed to when it entered review.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Avg Wait"
          value={formatMinutesDecimalValue(avg)}
          sublabel={formatDurationBreakdown(avg)}
          tooltip="Mean wait across completed review cycles in the period. Compare against the median — a few stalled reviews pull this up."
        />
        <MetricCard
          label="Median Wait"
          value={formatMinutesDecimalValue(median)}
          sublabel={formatDurationBreakdown(median)}
          tooltip="The midpoint review cycle — usually a better description of a typical wait than the average."
        />
        <MetricCard
          label="Cycles Completed"
          value={formatNumber(report.cycles.length)}
          sublabel={`${formatNumber(report.byReviewer.length)} reviewers · ${formatNumber(report.inReview.length)} still in review`}
          tooltip="Review cycles that both started in the period and finished by moving to On Hold or For Checking. Cycles still open are counted separately in the sublabel."
        />
        <MetricCard
          label="Longest Wait"
          value={formatMinutesDecimalValue(max)}
          sublabel={formatDurationBreakdown(max)}
          tooltip="The single longest completed review wait in the period."
        />
      </div>

      {busiest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            label="Slowest Reviewer (avg)"
            value={report.byReviewer[0]?.reviewerName ?? "—"}
            sublabel={
              report.byReviewer[0]
                ? `avg ${formatMinutesDecimalValue(report.byReviewer[0].avgWaitMinutes)} over ${formatNumber(report.byReviewer[0].cycleCount)} cycles`
                : undefined
            }
            tooltip="Highest average wait. Read it alongside the cycle count — an average over two reviews says much less than one over twenty."
          />
          <MetricCard
            label="Busiest Reviewer"
            value={busiest.reviewerName}
            sublabel={`${formatNumber(busiest.cycleCount)} cycles · avg ${formatMinutesDecimalValue(busiest.avgWaitMinutes)}`}
            tooltip="Reviewed the most tickets in the period."
          />
        </div>
      )}

      <PeerReviewWaitTable byReviewer={report.byReviewer} cycles={slowest} inReview={report.inReview} />
    </div>
  );
}
