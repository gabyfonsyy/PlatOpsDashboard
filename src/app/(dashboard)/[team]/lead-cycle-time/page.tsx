import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getLeadCycleTimeReport, getLeadTimeDeepDive, type LeadCycleTimeMetric } from "@/lib/lead-cycle-time";
import { resolveFilters } from "@/lib/date-ranges";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { LeadCycleTimeTicketsTable } from "@/components/dashboard/LeadCycleTimeTicketsTable";
import { LeadCycleTimeRankTable } from "@/components/dashboard/LeadCycleTimeRankTable";
import { LeadTimeDeepDive } from "@/components/dashboard/LeadTimeDeepDive";

export default async function LeadCycleTimePage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const metric: LeadCycleTimeMetric = searchParams.metric === "cycle" ? "cycle" : "lead";

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  const backLink = (
    <Link
      href={`/${team.team_key.toLowerCase()}?${query}`}
      className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
    >
      <ArrowLeft className="w-4 h-4" />
      Back to {teamLabel(team.team_name)}
    </Link>
  );

  // ------------------------------------------------------------------ Lead Time (rebuilt deep-dive)
  if (metric === "lead") {
    const report = await getLeadTimeDeepDive(team.team_key, range, period, issueType);

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="max-w-2xl">
            {backLink}
            <h1>{teamLabel(team.team_name)} — Lead Time</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Work delivery time, flow efficiency, bottlenecks, and long-running work. {report.description} Only tickets resolved in the
              selected period are counted — a ticket still open isn&apos;t included until it finishes.
            </p>
          </div>
          <FilterBar issueTypes={issueTypes} />
        </div>

        <LeadTimeDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} />
      </div>
    );
  }

  // --------------------------------------------------------------------------- Cycle Time (unchanged)
  const report = await getLeadCycleTimeReport(team.team_key, range, period, metric, issueType);
  const metricLabel = "Cycle Time";

  // Only ST's Cycle Time decomposes into actual-work + peer-review — see getLeadCycleTimeReport.
  // Everywhere else combinedAvgMinutes just equals avgMinutes, so the "Overall Avg" card's value
  // is unaffected by this flag; it only controls whether the two breakdown cards render.
  const showPeerReviewSplit = team.has_peer_review_tracking;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          {backLink}
          <h1>{teamLabel(team.team_name)} — {metricLabel} Deep-Dive</h1>
          <p className="text-sm text-neutral-500 mt-1">{report.description}</p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${showPeerReviewSplit ? "lg:grid-cols-6" : "lg:grid-cols-4"}`}>
        <MetricCard
          label={`Overall Avg ${metricLabel}`}
          value={formatMinutesDecimalValue(report.combinedAvgMinutes)}
          sublabel={`${formatDurationBreakdown(report.combinedAvgMinutes) ?? "—"} · ${formatNumber(report.count)} tickets`}
          tooltip={
            showPeerReviewSplit
              ? `Actual-work average plus peer-review average — the same figure the team-page scorecard shows. ${report.description} Shown in days/hours/minutes.`
              : `Average across every ticket counted in the period. ${report.description} Shown in days/hours/minutes.`
          }
        />
        {showPeerReviewSplit && (
          <MetricCard
            label="Avg Actual Work"
            value={formatMinutesDecimalValue(report.avgMinutes)}
            sublabel={`${formatDurationBreakdown(report.avgMinutes) ?? "—"} · ${formatNumber(report.count)} tickets`}
            tooltip="Average time from when a ticket left Backlog/To Do to when it reached review — the same span this card measured before the peer-review time was split out."
          />
        )}
        {showPeerReviewSplit && (
          <MetricCard
            label="Avg Peer Review"
            value={formatMinutesDecimalValue(report.peerReviewAvgMinutes)}
            sublabel={`${formatDurationBreakdown(report.peerReviewAvgMinutes) ?? "—"} · ${formatNumber(report.peerReviewCount)} tickets`}
            tooltip="Average time spent IN For Peer Review, summed per ticket across cycles that exited to On Hold or For Checking, over the same tickets counted in Overall Avg Cycle Time."
          />
        )}
        <MetricCard
          label={`Highest by ${report.assigneeLabel}`}
          value={report.byAssignee[0]?.key ?? "—"}
          sublabel={report.byAssignee[0] ? `avg ${formatMinutesDecimalValue(report.byAssignee[0].avgMinutes)} (${formatDurationBreakdown(report.byAssignee[0].avgMinutes)})` : undefined}
          tooltip={`The ${report.assigneeLabel} with the highest average ${metricLabel.toLowerCase()} this period.`}
        />
        <MetricCard
          label="Highest by Product"
          value={report.byProduct[0]?.key ?? "—"}
          sublabel={report.byProduct[0] ? `avg ${formatMinutesDecimalValue(report.byProduct[0].avgMinutes)} (${formatDurationBreakdown(report.byProduct[0].avgMinutes)})` : undefined}
          tooltip={`The product with the highest average ${metricLabel.toLowerCase()} this period.`}
        />
        <MetricCard
          label="Highest by Label"
          value={report.byLabel[0]?.key ?? "—"}
          sublabel={report.byLabel[0] ? `avg ${formatMinutesDecimalValue(report.byLabel[0].avgMinutes)} (${formatDurationBreakdown(report.byLabel[0].avgMinutes)})` : undefined}
          tooltip={`The label with the highest average ${metricLabel.toLowerCase()} this period, excluding team/department tags (anything containing "-ops", e.g. se-ops, hr-ops, payroll-ops).`}
        />
      </div>

      <LeadCycleTimeTicketsTable
        tickets={report.topTickets}
        metric={metric}
        assigneeLabel={report.assigneeLabel}
        startColumnLabel={report.startColumnLabel}
        endColumnLabel={report.endColumnLabel}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LeadCycleTimeRankTable title={`By ${report.assigneeLabel}`} keyLabel={report.assigneeLabel} rows={report.byAssignee} />
        <LeadCycleTimeRankTable title="By Product" keyLabel="Product" rows={report.byProduct} />
        <LeadCycleTimeRankTable title="By Label" keyLabel="Label" rows={report.byLabel} />
      </div>
    </div>
  );
}
