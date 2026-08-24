import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getOnHoldReport } from "@/lib/ticket-breakdowns";
import { resolveFilters } from "@/lib/date-ranges";
import { formatPercent, formatNumber, formatMinutesDecimalValue, formatDurationBreakdown } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable, BreakdownTicketsTable } from "@/components/dashboard/BreakdownTables";

export default async function OnHoldPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_holding_reason) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const report = await getOnHoldReport(team.team_key, range, period, issueType);

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
          <h1>{teamLabel(team.team_name)} — On-Hold Time</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Total time spent On Hold, across tickets resolved in the period that were held at least
            once.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Avg On-Hold Time"
          value={formatMinutesDecimalValue(report.avgMinutes)}
          sublabel={formatDurationBreakdown(report.avgMinutes)}
          tooltip="Mean total On Hold time across tickets that were held at least once. Read it next to the median — this figure is pulled upward by a few long-parked tickets."
        />
        <MetricCard
          label="Median On-Hold Time"
          value={formatMinutesDecimalValue(report.medianMinutes)}
          sublabel={formatDurationBreakdown(report.medianMinutes)}
          tooltip="The midpoint ticket. On-hold time is heavily right-skewed, so this is usually the better description of a typical hold than the average."
        />
        <MetricCard
          label="Tickets Held"
          value={formatNumber(report.heldTickets)}
          sublabel={`${formatPercent(report.heldShare)} of ${formatNumber(report.resolvedInPeriod)} resolved`}
          tooltip="Tickets resolved in the period that went On Hold at least once."
        />
        <MetricCard
          label="Longest Hold"
          value={formatMinutesDecimalValue(report.maxMinutes)}
          sublabel={formatDurationBreakdown(report.maxMinutes)}
          tooltip="The single longest total On Hold time this period."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CountRankTable
          title="Why Tickets Were Held"
          keyLabel="Holding Reason"
          rows={report.byReason}
          countLabel="Holds"
          emptyMessage="No holding reasons recorded in this period."
        />
        <CountRankTable
          title={`By ${report.assigneeLabel}`}
          keyLabel={report.assigneeLabel}
          rows={report.byAssignee}
          emptyMessage="Nothing held this period."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CountRankTable title="By Product" keyLabel="Product" rows={report.byProduct} />
        <CountRankTable title="By Issue Type" keyLabel="Issue Type" rows={report.byIssueType} />
      </div>

      <BreakdownTicketsTable
        title="Longest On-Hold Tickets"
        tickets={report.tickets}
        assigneeLabel={report.assigneeLabel}
        detailLabel={null}
        showMinutes
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />
    </div>
  );
}
