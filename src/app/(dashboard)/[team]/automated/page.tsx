import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey, backlogAgingAssigneeLabel } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getAutomatedTicketsReport, AUTOMATION_ASSIGNED_SE_NAMES } from "@/lib/automated-tickets";
import { AUTOMATION_LABELS_COOKIE, resolveAutomationLabels } from "@/lib/automation-labels";
import { resolveFilters } from "@/lib/date-ranges";
import { formatDaysValue, formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable } from "@/components/dashboard/BreakdownTables";
import { LabelPrefsProvider } from "@/components/dashboard/LabelPrefsContext";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { AutomatedTicketsPanel } from "@/components/dashboard/AutomatedTicketsPanel";

export default async function AutomatedTicketsPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  // Assigned SE is the field the automation filter is defined on. A team owned by Assigned COD
  // has no such field, so the page would silently measure something else.
  if (backlogAgingAssigneeLabel(team) !== "Assigned SE") notFound();

  const { range, period, issueType } = resolveFilters(searchParams);

  // The catalogue is part of the population definition, so it has to be read here, on the server,
  // before the query runs — hence a cookie rather than localStorage. The Team Stats card reads the
  // same one, so the card and this page can never disagree about what counts as automated.
  const automationLabels = resolveAutomationLabels(cookies().get(AUTOMATION_LABELS_COOKIE)?.value);
  const report = await getAutomatedTicketsReport(team.team_key, range, period, issueType, automationLabels);

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
          <h1>{teamLabel(team.team_name)} — Automated Tickets</h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-3xl">
            Tickets resolved in the period that no person on the team owns — <strong>Assigned SE</strong>{" "}
            blank or set to {AUTOMATION_ASSIGNED_SE_NAMES.join(" / ")} — plus any ticket carrying one
            of your catalogued automation labels. Jira&apos;s own assignee is never used to decide
            this, so a ticket a bot merely transitioned on someone&apos;s behalf is not counted.{" "}
            {/* Rendered from the report's own values rather than retyped, so the sentence cannot
                drift from the filter — same rule as ComboTable's label caption. */}
            <span className="text-neutral-400">
              {report.excludedStatuses.join(" and ")} tickets are excluded: nobody did the work, so
              their lead time measures how long they sat before being written off.
              {report.excludedByStatusCount > 0 &&
                ` ${formatNumber(report.excludedByStatusCount)} dropped in this period.`}
              {report.includedByLabelOnlyCount > 0 &&
                ` ${formatNumber(report.includedByLabelOnlyCount)} ticket${
                  report.includedByLabelOnlyCount === 1 ? "" : "s"
                } here do have an Assigned SE — they qualify on their automation label.`}
            </span>
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Automated Tickets"
          value={formatNumber(report.automatedCount)}
          sublabel={`${formatPercent(report.automatedShare)} of ${formatNumber(report.resolvedInPeriod)} resolved`}
          tooltip="Tickets resolved in the period with no Assigned SE, with the automation account as Assigned SE, or carrying a catalogued automation label. Archived, Rejected and Technical Story are excluded. The denominator is every ticket the team resolved in the period, archived and rejected included — the same denominator the other cards on Team Stats use."
        />
        <MetricCard
          label="Lead Time"
          value={formatDaysValue(report.overall.leadAvgMinutes)}
          sublabel={formatDurationBreakdown(report.overall.leadAvgMinutes)}
          tooltip={`Average time from ticket creation to resolution across these tickets, in days. Median ${formatDaysValue(report.overall.leadMedianMinutes)} days — these spans are heavily right-skewed, so read the median next to the mean.`}
        />
        <MetricCard
          label="Cycle Time"
          value={formatDaysValue(report.overall.cycleAvgMinutes)}
          sublabel={formatDurationBreakdown(report.overall.cycleAvgMinutes)}
          tooltip={`${report.cycleTimeDescription} Median ${formatDaysValue(report.overall.cycleMedianMinutes)} days.`}
        />
      </div>

      {/* Means and medians together, because these spans are extremely right-skewed and the cards
          above only have room for the mean. One row: the population is automated tickets, and
          splitting it by how each one qualified was noise (Gaby, 2026-09-01). */}
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">Lead &amp; Cycle Time</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Medians sit beside the means because a handful of long-parked tickets otherwise drags the
            average somewhere no real ticket sits.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Population</th>
              <th className="px-4 py-3 text-right">Tickets</th>
              <th className="px-4 py-3">Avg Lead</th>
              <th className="px-4 py-3">Median Lead</th>
              <th className="px-4 py-3">Avg Cycle</th>
              <th className="px-4 py-3">Median Cycle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {report.overall.tickets === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  No automated tickets in this period.
                </td>
              </tr>
            ) : (
              <tr>
                <td className="px-4 py-3 text-neutral-900">All automated tickets</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap align-top">
                  {formatNumber(report.overall.tickets)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap align-top">
                  <DurationCell minutes={report.overall.leadAvgMinutes} strong />
                </td>
                <td className="px-4 py-3 whitespace-nowrap align-top">
                  <DurationCell minutes={report.overall.leadMedianMinutes} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap align-top">
                  <DurationCell minutes={report.overall.cycleAvgMinutes} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap align-top">
                  <DurationCell minutes={report.overall.cycleMedianMinutes} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* There is exactly ONE label table on this page, the editable one inside the panel below
          (Gaby's call, 2026-09-01). A second By Label card used to sit in this grid as a fourth
          cell; it showed the same labels in the same order under the same exclusions, capped at 15
          rows — which silently hid 9 of the 24 labels, the uncatalogued tail that is the whole
          point of looking. Its only unique column, Share, moved into the panel's table instead, so
          nothing was lost. Do not re-add it. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CountRankTable
          title="By Issue Type"
          keyLabel="Issue Type"
          rows={report.byIssueType}
          emptyMessage="No automated tickets in this period."
        />
        <CountRankTable
          title="By Product"
          keyLabel="Product"
          rows={report.byProduct}
          emptyMessage="No automated tickets in this period."
        />
        <CountRankTable
          title="By Ticket Escalation"
          keyLabel="Escalated To"
          rows={report.byEscalation}
          emptyMessage="No automated tickets in this period."
        />
      </div>

      <LabelPrefsProvider>
        <AutomatedTicketsPanel
          tickets={report.tickets}
          totalCount={report.automatedCount}
          automationLabels={report.automationLabels}
          jiraBaseUrl={process.env.JIRA_BASE_URL}
        />
      </LabelPrefsProvider>
    </div>
  );
}
