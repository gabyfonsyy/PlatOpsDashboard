import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getLeadCycleTimeReport, type LeadCycleTimeMetric } from "@/lib/lead-cycle-time";
import { resolveFilters } from "@/lib/date-ranges";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { LeadCycleTimeTicketsTable } from "@/components/dashboard/LeadCycleTimeTicketsTable";
import { LeadCycleTimeRankTable } from "@/components/dashboard/LeadCycleTimeRankTable";

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
  const report = await getLeadCycleTimeReport(team.team_key, range, period, metric, issueType);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();
  const metricLabel = metric === "cycle" ? "Cycle Time" : "Lead Time";

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
          <h1>{teamLabel(team.team_name)} — {metricLabel} Deep-Dive</h1>
          <p className="text-sm text-neutral-500 mt-1">{report.description}</p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <MetricCard
          label={`Overall Avg ${metricLabel}`}
          value={formatMinutesDecimalValue(report.avgMinutes)}
          sublabel={`${formatDurationBreakdown(report.avgMinutes) ?? "—"} · ${formatNumber(report.count)} tickets`}
          tooltip={`Average across every ticket counted in the period. ${report.description} Shown in days/hours/minutes.`}
        />
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
