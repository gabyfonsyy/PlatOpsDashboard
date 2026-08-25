import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getFcrReport } from "@/lib/ticket-breakdowns";
import { resolveFilters } from "@/lib/date-ranges";
import { formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable, ComboTable, BreakdownTicketsTable } from "@/components/dashboard/BreakdownTables";

export default async function FcrPage({
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
  const report = await getFcrReport(team.team_key, range, period, issueType);

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
          <h1>{teamLabel(team.team_name)} — First Contact Resolution</h1>
          <p className="text-sm text-neutral-500 mt-1">
            What the team resolved without handing off, across tickets resolved in the period.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          label="FCR Rate"
          value={formatPercent(report.fcrRate)}
          sublabel={`${formatNumber(report.fcrYesTickets)} of ${formatNumber(report.resolvedInPeriod)} resolved`}
          tooltip="Tickets marked First Contact Resolution = Yes, divided by tickets resolved in the period. Same definition as the scorecard."
        />
        <MetricCard
          label="Resolved by SE"
          value={formatPercent(report.resolvedBySeRate)}
          sublabel={`${formatNumber(report.resolvedBySeTickets)} of ${formatNumber(report.resolvedInPeriod)} resolved`}
          tooltip="Tickets the team finished itself: Ticket Escalation is CA, SE, N/A or blank, OR First Contact Resolution = Yes. Broader than FCR Rate, which counts only the FCR = Yes flag."
        />
        {/* Anchors to the table further down rather than opening a separate page: the job here is
            correcting these tickets in Jira, and the surrounding rates are the context for deciding
            which ones are actually wrong. The link is dropped when the count is zero so the card
            never invites a click that goes nowhere. */}
        <MetricCard
          label="Escalated but FCR = Yes"
          value={formatNumber(report.escalatedButFcrYes)}
          sublabel={report.escalatedButFcrYes ? "click to review and correct" : "none in this period"}
          href={report.escalatedButFcrYes ? "#escalated-but-fcr-yes" : undefined}
          tooltip="Tickets that were escalated yet still flagged First Contact Resolution = Yes. They only reach the Resolved-by-SE set through the FCR half of the rule, so a large number here usually means the two fields are being filled in inconsistently. Click to list them and correct them in Jira. Measured 2026-08-25: this last occurred in Sep 2025 — since then FCR = No matches the escalated set exactly, so recent periods read zero."
        />
        <MetricCard
          label="Top Product"
          value={report.byProduct[0]?.key ?? "—"}
          sublabel={report.byProduct[0] ? `${formatNumber(report.byProduct[0].count)} tickets` : undefined}
          tooltip="The product the team most often resolved without handing off."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComboTable title="Top Product + Label Combinations" rows={report.byProductLabel} />
        <CountRankTable
          title={`By ${report.assigneeLabel}`}
          keyLabel={report.assigneeLabel}
          rows={report.byAssignee}
          emptyMessage="Nothing resolved in-team this period."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CountRankTable title="By Product" keyLabel="Product" rows={report.byProduct} />
        <CountRankTable title="By Issue Type" keyLabel="Issue Type" rows={report.byIssueType} />
      </div>

      {report.escalatedButFcrYes > 0 && (
        <BreakdownTicketsTable
          id="escalated-but-fcr-yes"
          title="Escalated but FCR = Yes — needs review"
          description="These tickets are marked First Contact Resolution = Yes despite having been escalated, so the two fields disagree. Open a ticket key to correct it in Jira; the number above updates on the next sync."
          tickets={report.escalatedButFcrYesTickets}
          totalCount={report.escalatedButFcrYes}
          assigneeLabel={report.assigneeLabel}
          detailLabel="Escalated To"
          jiraBaseUrl={process.env.JIRA_BASE_URL}
        />
      )}

      <BreakdownTicketsTable
        title="Most Recently Resolved by SE"
        description="Filter any column to find a specific ticket. Workflow labels are excluded from the Labels column, same as the ranking tables above."
        tickets={report.tickets}
        totalCount={report.resolvedBySeTickets}
        assigneeLabel={report.assigneeLabel}
        detailLabel="Why It Counts"
        emptyMessage="Nothing resolved in-team this period."
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />
    </div>
  );
}
