import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTeamByKey, backlogAgingAssigneeLabel } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getTicketMetrics, getInsight } from "@/lib/metrics";
import { getAutomatedTicketCount } from "@/lib/automated-tickets";
import { getP1SlaReport } from "@/lib/p1-sla";
import { slaStatusForRate, STATUS_LABEL, STATUS_TONE } from "@/lib/sla-status";
import { AUTOMATION_LABELS_COOKIE, resolveAutomationLabels } from "@/lib/automation-labels";
import { resolveFilters } from "@/lib/date-ranges";
import {
  formatMinutesDecimalValue,
  formatDaysValue,
  formatDaysValueCeil,
  formatDurationBreakdown,
  formatDurationBreakdownWithSeconds,
  formatPercent,
  formatNumber,
} from "@/lib/format";
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

  // Automated tickets are defined on the Assigned SE field, so the card only exists for teams
  // that own their tickets through it (SE/ST). Skipped entirely elsewhere rather than fetched and
  // hidden — a team without the field has nothing to count.
  const hasAssignedSe = backlogAgingAssigneeLabel(team) === "Assigned SE";
  // The same cookie the drill-down reads, so the card counts the population she configured there
  // rather than the built-in default. Without this the card and the page it links to disagree the
  // moment she edits the automation-label catalogue.
  const automationLabels = resolveAutomationLabels(cookies().get(AUTOMATION_LABELS_COOKIE)?.value);
  const [metrics, insight, automatedCount, p1Sla] = await Promise.all([
    getTicketMetrics(team.team_key, range, period, issueType),
    getInsight(`TEAM:${team.team_key}`),
    hasAssignedSe
      ? getAutomatedTicketCount(team.team_key, range, period, issueType, automationLabels)
      : Promise.resolve(0),
    team.has_p1_sla_tracking ? getP1SlaReport(team.team_key, range, period, issueType) : Promise.resolve(null),
  ]);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Carried onto every scorecard drill-down so each opens on the same period the card was read on.
  const filterQuery = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

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

      <InsightPanel insight={insight} scope={`TEAM:${team.team_key}`} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Ticket Volume"
          value={formatNumber(metrics.ticketsCreated)}
          sublabel={`${formatNumber(metrics.ticketsResolvedInPeriod)} resolved`}
          tooltip={
            team.has_peer_review_tracking
              ? "Total tickets created during the selected period. The sublabel shows how many tickets were resolved during the period (by resolved date)."
              : "Total tickets created during the selected period. The sublabel shows how many tickets were resolved during the period — moved to Ready for Checking or Cancelled (by resolved date)."
          }
        />
        <MetricCard
          label="Lead Time"
          value={formatDaysValue(metrics.leadTimeAvgMinutes)}
          sublabel={formatDurationBreakdown(metrics.leadTimeAvgMinutes)}
          tooltip={
            team.has_peer_review_tracking
              ? "Average time from ticket creation to resolution, across all tickets resolved in the period. Shown in days; the subnote breaks the same value down into days/hours/minutes. Click through for the deep-dive (top assignee/product/label, longest tickets)."
              : "Average time from ticket creation until it moved to Ready for Checking or Cancelled, across all tickets resolved in the period. Shown in days; the subnote breaks the same value down into days/hours/minutes. Click through for the deep-dive (top assignee/product/label, longest tickets)."
          }
          href={`/${team.team_key.toLowerCase()}/lead-cycle-time?${filterQuery}&metric=lead`}
        />
        <MetricCard
          label="Cycle Time"
          value={formatDaysValueCeil(metrics.cycleTimeAvgMinutes)}
          sublabel={formatDurationBreakdownWithSeconds(metrics.cycleTimeAvgMinutes)}
          tooltip={
            team.has_peer_review_tracking
              ? "Average actual-work time (out of Backlog/To Do to reaching review) plus average peer-review time, counted independent of resolution. Shown in days, rounded up to 2 decimals. Click through for the actual-work and peer-review averages as separate values."
              : "Average time from when the ticket moved out of Backlog/To Do until it moved to Ready for Checking or Cancelled, across tickets resolved in the period. Shown in days, rounded up to 2 decimals. Click through for the deep-dive (top assignee/product/label, longest tickets)."
          }
          href={`/${team.team_key.toLowerCase()}/lead-cycle-time?${filterQuery}&metric=cycle`}
        />
        {team.has_peer_review_tracking && (
          <MetricCard
            label="Review Wait Time"
            value={formatMinutesDecimalValue(metrics.peerReviewWaitAvgMinutes)}
            sublabel={formatDurationBreakdown(metrics.peerReviewWaitAvgMinutes)}
            tooltip="Average time a ticket spends in For Peer Review before moving on to On Hold or For Checking, across review cycles that finished during the period. Attributed to the reviewer it was handed to on entry. Click through for the breakdown."
            href={`/${team.team_key.toLowerCase()}/review-wait?${filterQuery}`}
          />
        )}
        <MetricCard
          label="Backlog Aging"
          value={formatPercent(metrics.backlogAgingRate, 2)}
          sublabel={`${formatNumber(metrics.overdueCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved overdue`}
          tooltip={
            team.has_peer_review_tracking
              ? "Overdue tickets ÷ total tickets resolved in the period, excluding Technical Story (internal engineering work, whose due dates are self-imposed). Overdue = resolved after the due date (resolved date > due date). Click through for the ticket-by-ticket list."
              : "Overdue tickets ÷ total tickets resolved (moved to Ready for Checking or Cancelled) in the period. Overdue = resolved after the due date (resolved date > due date). Click through for the ticket-by-ticket list."
          }
          href={`/${team.team_key.toLowerCase()}/backlog-aging?${filterQuery}`}
        />
        {hasAssignedSe && (
          <MetricCard
            label="Automated Tickets"
            value={formatNumber(automatedCount)}
            sublabel={`of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved`}
            tooltip="Tickets resolved in the period that no person on the team owns — Assigned SE is blank or set to the automation account — plus any ticket carrying one of your catalogued automation labels. Archived and Rejected tickets are excluded, since nobody did the work on them. Jira's own assignee is not used to decide this. Click through for the labels behind them, their lead and cycle times, and the ticket list."
            href={`/${team.team_key.toLowerCase()}/automated?${filterQuery}`}
          />
        )}
        {team.has_fcr_escalation && (
          <>
            <MetricCard
              label="FCR Rate"
              value={formatPercent(metrics.fcrRate)}
              sublabel={`${formatNumber(metrics.fcrYesCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved FCR = Yes`}
              tooltip="Tickets marked FCR = Yes ÷ total tickets resolved in the period (by resolved date). Click through for what the team resolved without handing off, by product and label."
              href={`/${team.team_key.toLowerCase()}/fcr?${filterQuery}`}
            />
            <MetricCard
              label="Escalation Rate"
              value={formatPercent(metrics.escalationRate)}
              sublabel={`${formatNumber(metrics.escalationCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved escalated`}
              tooltip="Tickets whose Ticket Escalation is set to something other than N/A, CA, SE, or blank ÷ total tickets resolved in the period. Click through for where the work went, counted per receiving team."
              href={`/${team.team_key.toLowerCase()}/escalation?${filterQuery}`}
            />
          </>
        )}
        {team.has_p1_sla_tracking && p1Sla && (
          <MetricCard
            label="P1 SLA Compliance"
            value={formatPercent(p1Sla.onTimeRate)}
            sublabel={`${formatNumber(p1Sla.onTimeCount)} of ${formatNumber(p1Sla.decided)} decided`}
            badge={
              (() => {
                const status = slaStatusForRate(p1Sla.onTimeRate);
                return status ? { label: STATUS_LABEL[status], tone: STATUS_TONE[status] } : undefined;
              })()
            }
            tooltip={`P1 (Very Urgent) tickets created in the period, resolved on/before due date ÷ (resolved + open-and-already-overdue). Filtered by CREATE date, not resolved date — a ticket still open and not yet due is excluded until its outcome is known. Click through for the full pulse: trend, why tickets overdue, where the problems concentrate, and which open P1s are at risk right now.`}
            href={`/${team.team_key.toLowerCase()}/p1-sla?${filterQuery}`}
          />
        )}
        {team.has_holding_reason && (
          <MetricCard
            label="Avg. On-Hold Pickup Time"
            value={formatMinutesDecimalValue(metrics.onHoldAvgPickupMinutes)}
            sublabel={formatDurationBreakdown(metrics.onHoldAvgPickupMinutes)}
            tooltip="Average total time tickets spent On Hold, across tickets placed on hold at least once. Click through for holding reasons and the longest holds."
            href={`/${team.team_key.toLowerCase()}/on-hold?${filterQuery}`}
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
