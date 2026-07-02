import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { getTicketMetrics, getInsight } from "@/lib/metrics";
import { resolveFilters } from "@/lib/date-ranges";
import { formatMinutes, formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { MetricsSeriesChart } from "@/components/dashboard/MetricsSeriesChart";
import { DistributionChart } from "@/components/dashboard/DistributionChart";
import { InsightPanel } from "@/components/dashboard/InsightPanel";

export default async function TeamDashboardPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const [metrics, insight] = await Promise.all([
    getTicketMetrics(team.team_key, range, period, issueType),
    getInsight(`TEAM:${team.team_key}`),
  ]);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>{team.team_name}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Jira project <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">{team.jira_project_key}</code>{" "}
            · <Link href={`/${team.team_key.toLowerCase()}/performance`} className="text-sprout-600 hover:underline">
              View performance breakdown
            </Link>
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <InsightPanel insight={insight} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Ticket Volume"
          value={formatNumber(metrics.ticketVolume)}
          sublabel={`${metrics.ticketsCreated} created, ${metrics.ticketsResolved} resolved`}
        />
        <MetricCard label="Lead Time" value={formatMinutes(metrics.leadTimeAvgMinutes)} />
        <MetricCard label="Cycle Time" value={formatMinutes(metrics.cycleTimeAvgMinutes)} />
        <MetricCard label="Backlog Aging" value={formatPercent(metrics.backlogAgingRate)} />
        {team.has_fcr_escalation && (
          <>
            <MetricCard label="First Contact Resolution" value={formatPercent(metrics.fcrRate)} />
            <MetricCard label="Escalation Rate" value={formatPercent(metrics.escalationRate)} />
          </>
        )}
        {team.has_holding_reason && (
          <MetricCard label="Avg. On-Hold Pickup Time" value={formatMinutes(metrics.onHoldAvgPickupMinutes)} />
        )}
      </div>

      <MetricsSeriesChart series={metrics.series} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {team.has_holding_reason && (
          <DistributionChart title="Ticket Holding Reasons" data={metrics.holdingReasonBreakdown} labelKey="reason" />
        )}
        {team.has_rejection_category && (
          <DistributionChart title="Ticket Rejection Categories" data={metrics.rejectionCategoryBreakdown} labelKey="category" />
        )}
        {team.has_cancellation_reason && (
          <DistributionChart title="Cancellation Reasons" data={metrics.cancellationReasonBreakdown} labelKey="reason" />
        )}
      </div>
    </div>
  );
}
