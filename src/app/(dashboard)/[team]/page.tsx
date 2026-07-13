import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getTicketMetrics, getInsight } from "@/lib/metrics";
import { resolveFilters } from "@/lib/date-ranges";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";
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
          <h1>{teamLabel(team.team_name)}</h1>
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
          value={formatNumber(metrics.ticketsCreated)}
          sublabel={`${formatNumber(metrics.ticketsResolvedInPeriod)} resolved`}
          tooltip="Total tickets created during the selected period. The sublabel shows how many tickets were resolved during the period (by resolved date)."
        />
        <MetricCard
          label="Lead Time"
          value={formatMinutesDecimalValue(metrics.leadTimeAvgMinutes)}
          sublabel={formatDurationBreakdown(metrics.leadTimeAvgMinutes)}
          tooltip="Average time from ticket creation to resolution, across all tickets resolved in the period."
        />
        <MetricCard
          label="Cycle Time"
          value={formatMinutesDecimalValue(metrics.cycleTimeAvgMinutes)}
          sublabel={formatDurationBreakdown(metrics.cycleTimeAvgMinutes)}
          tooltip="Average time from when work started (ticket left Backlog/To Do) to resolution, across tickets resolved in the period."
        />
        <MetricCard
          label="Backlog Aging"
          value={formatPercent(metrics.backlogAgingRate)}
          sublabel={`${formatNumber(metrics.overdueCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved overdue`}
          tooltip="Overdue tickets ÷ total tickets resolved in the period. Overdue = resolved after the due date (resolved date > due date)."
        />
        {team.has_fcr_escalation && (
          <>
            <MetricCard
              label="FCR Rate"
              value={formatPercent(metrics.fcrRate)}
              sublabel={`${formatNumber(metrics.fcrYesCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved FCR = Yes`}
              tooltip="Tickets marked FCR = Yes ÷ total tickets resolved in the period (by resolved date)."
            />
            <MetricCard
              label="Escalation Rate"
              value={formatPercent(metrics.escalationRate)}
              sublabel={`${formatNumber(metrics.escalationCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved escalated`}
              tooltip="Tickets whose Ticket Escalation is set to something other than N/A, CA, SE, or blank ÷ total tickets resolved in the period."
            />
          </>
        )}
        {team.has_holding_reason && (
          <MetricCard
            label="Avg. On-Hold Pickup Time"
            value={formatMinutesDecimalValue(metrics.onHoldAvgPickupMinutes)}
            sublabel={formatDurationBreakdown(metrics.onHoldAvgPickupMinutes)}
            tooltip="Average total time tickets spent On Hold, across tickets placed on hold at least once."
          />
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
