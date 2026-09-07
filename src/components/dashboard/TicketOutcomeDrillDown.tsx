import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getTicketOutcomeReport, outcomeDef, type OutcomeKind } from "@/lib/ticket-outcomes";
import { formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TicketOutcomeReasonBreakdown } from "@/components/dashboard/TicketOutcomeBreakdown";
import { OutcomeTicketsTable } from "@/components/dashboard/OutcomeTicketsTable";
import { TicketOutcomeTagline } from "@/components/dashboard/TicketOutcomesCopy";

/**
 * Shared body for all three Ticket Outcomes drill-downs (cancelled/archived/rejected route
 * folders) — same "one route per feature, shared rendering" split as the rest of Team Stats;
 * only the outcome (and therefore the reason field/label/status) differs between callers.
 */
export async function TicketOutcomeDrillDown({
  team,
  outcome,
  range,
  period,
  issueType,
  reasonFilter,
}: {
  team: TeamConfig;
  outcome: OutcomeKind;
  range: string;
  period: string;
  issueType?: string;
  reasonFilter?: string;
}) {
  const report = await getTicketOutcomeReport(team.team_key, outcome, range, period, issueType, reasonFilter);
  const def = outcomeDef(outcome);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const backQuery = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  const reasonHref = (reason: string) => {
    const params = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}), reason });
    return `?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link
            href={`/${team.team_key.toLowerCase()}?${backQuery}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — {def.pageTitle}</h1>
          <TicketOutcomeTagline outcome={outcome} />
        </div>
        <FilterBar
          issueTypes={issueTypes}
          extraFilter={{ param: "reason", label: def.reasonLabel, options: report.byReason.map((r) => r.key) }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard
          label={def.pageTitle}
          value={formatNumber(report.outcomeCount)}
          sublabel={
            report.resolvedInPeriod
              ? `${formatPercent(report.outcomeShare)} of ${formatNumber(report.resolvedInPeriod)} resolved`
              : undefined
          }
          tooltip={`Tickets resolved in the period whose status is ${def.statusLabel}, divided by every ticket ${teamLabel(team.team_name)} resolved in the period. Same definition as the scorecard.`}
        />
        <MetricCard
          label={`Top ${def.reasonLabel}`}
          value={report.byReason[0]?.key ?? "—"}
          sublabel={report.byReason[0] ? `${formatNumber(report.byReason[0].count)} tickets` : undefined}
          tooltip={`The most common ${def.reasonLabel.toLowerCase()} behind this outcome this period.`}
        />
        {reasonFilter && (
          <MetricCard
            label="Filtered To"
            value={reasonFilter}
            sublabel={`${formatNumber(report.ticketsTotalCount)} matching tickets`}
            tooltip="Clear the filter above to see every reason again."
          />
        )}
      </div>

      <TicketOutcomeReasonBreakdown
        outcome={outcome}
        reasonLabel={def.reasonLabel}
        rows={report.byReason}
        hrefForKey={reasonHref}
      />

      <OutcomeTicketsTable
        title={def.pageTitle}
        reasonLabel={def.reasonLabel}
        description={
          reasonFilter
            ? `Filtered to ${def.reasonLabel} = ${reasonFilter}. Filter any column below to narrow further.`
            : "Filter any column to find a specific ticket."
        }
        tickets={report.tickets}
        totalCount={report.ticketsTotalCount}
        emptyMessage={`No ${def.pageTitle.toLowerCase()} in this period.`}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />
    </div>
  );
}
