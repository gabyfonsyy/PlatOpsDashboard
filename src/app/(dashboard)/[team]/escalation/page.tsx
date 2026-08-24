import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getEscalationReport } from "@/lib/ticket-breakdowns";
import { resolveFilters } from "@/lib/date-ranges";
import { formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable, ComboTable, BreakdownTicketsTable } from "@/components/dashboard/BreakdownTables";

export default async function EscalationPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_fcr_escalation) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const report = await getEscalationReport(team.team_key, range, period, issueType);

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
          <h1>{teamLabel(team.team_name)} — Escalations</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Where work went when it left the team, across tickets resolved in the period. Ticket
            Escalation is a multi-select, so a ticket raised to two teams counts once for each.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Escalation Rate"
          value={formatPercent(report.escalationRate)}
          sublabel={`${formatNumber(report.escalatedTickets)} of ${formatNumber(report.resolvedInPeriod)} resolved`}
          tooltip="Tickets whose Ticket Escalation is set to something other than N/A, CA, SE or blank, divided by tickets resolved in the period. Same definition as the scorecard."
        />
        <MetricCard
          label="Escalation Entries"
          value={formatNumber(report.escalationEntries)}
          sublabel={`across ${formatNumber(report.byTarget.length)} teams`}
          tooltip="One entry per receiving team. Higher than the escalated-ticket count whenever a ticket was raised to more than one team at once."
        />
        <MetricCard
          label="Multi-Team Escalations"
          value={formatNumber(report.multiTargetTickets)}
          sublabel={
            report.escalatedTickets
              ? `${formatPercent(report.multiTargetTickets / report.escalatedTickets)} of escalated`
              : undefined
          }
          tooltip="Tickets raised to two or more teams in one go — usually a sign the owning team could not tell where the problem sat."
        />
        <MetricCard
          label="Top Destination"
          value={report.byTarget[0]?.key ?? "—"}
          sublabel={report.byTarget[0] ? `${formatNumber(report.byTarget[0].count)} tickets` : undefined}
          tooltip="The team that received the most escalations this period."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CountRankTable
          title="Escalated To"
          keyLabel="Team"
          rows={report.byTarget}
          emptyMessage="No escalations in this period."
        />
        <ComboTable title="Top Product + Label Combinations" rows={report.byProductLabel} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CountRankTable title="By Product" keyLabel="Product" rows={report.byProduct} />
        <CountRankTable title={`By ${report.assigneeLabel}`} keyLabel={report.assigneeLabel} rows={report.byAssignee} />
        <CountRankTable title="By Issue Type" keyLabel="Issue Type" rows={report.byIssueType} />
      </div>

      <BreakdownTicketsTable
        title="Most Recent Escalations"
        tickets={report.tickets}
        assigneeLabel={report.assigneeLabel}
        detailLabel="Escalated To"
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />
    </div>
  );
}
