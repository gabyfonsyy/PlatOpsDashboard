import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getBacklogAgingReport } from "@/lib/backlog-aging";
import { resolveFilters } from "@/lib/date-ranges";
import { formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { BacklogAgingTable } from "@/components/dashboard/BacklogAgingTable";

export default async function BacklogAgingPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const report = await getBacklogAgingReport(team.team_key, range, period, issueType);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

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
          <h1>{teamLabel(team.team_name)} — Backlog Aging</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Every ticket resolved during the period after its due date, newest overdue first.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Backlog Aging"
          value={formatPercent(report.backlogAgingRate, 2)}
          sublabel={`${formatNumber(report.overdueCount)} of ${formatNumber(report.resolvedInPeriod)} resolved overdue`}
          tooltip={
            team.has_peer_review_tracking
              ? "Overdue tickets ÷ total tickets resolved in the period. Overdue = resolved after the due date (resolved date > due date)."
              : "Overdue tickets ÷ total tickets resolved (moved to Ready for Checking or Cancelled) in the period. Overdue = resolved after the due date (resolved date > due date)."
          }
        />
        <MetricCard
          label="Overdue Tickets"
          value={formatNumber(report.overdueCount)}
          sublabel="listed below"
          tooltip="Tickets whose resolved calendar date falls strictly after their due date."
        />
        <MetricCard
          label="Resolved in Period"
          value={formatNumber(report.resolvedInPeriod)}
          sublabel="the rate's denominator"
          tooltip={
            team.has_peer_review_tracking
              ? "Every ticket the team resolved during the period, overdue or not — bucketed by resolved date."
              : "Every ticket the team resolved (moved to Ready for Checking or Cancelled) during the period, overdue or not — bucketed by resolved date."
          }
        />
      </div>

      <BacklogAgingTable
        tickets={report.tickets}
        assigneeLabel={report.assigneeLabel}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />
    </div>
  );
}
