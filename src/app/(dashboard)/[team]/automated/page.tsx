import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey, backlogAgingAssigneeLabel } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getAutomatedTicketsReport, AUTOMATION_ASSIGNED_SE_NAMES } from "@/lib/automated-tickets";
import { AUTOMATION_LABELS_COOKIE, AUTOMATION_INCLUDE_BLANK_COOKIE, resolveAutomationLabels, resolveIncludeBlank } from "@/lib/automation-labels";
import { getKpiBaselines } from "@/lib/kpi-baselines";
import type { ReviewWaitGrain } from "@/lib/review-wait";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { CountRankTable } from "@/components/dashboard/BreakdownTables";
import { LabelPrefsProvider } from "@/components/dashboard/LabelPrefsContext";
import { AutomatedTicketsPanel } from "@/components/dashboard/AutomatedTicketsPanel";
import { AutomatedDeepDive } from "@/components/dashboard/AutomatedDeepDive";

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
  const rawGrain = typeof searchParams.grain === "string" ? searchParams.grain : undefined;
  const grain: ReviewWaitGrain | undefined = rawGrain === "day" || rawGrain === "week" || rawGrain === "month" ? rawGrain : undefined;

  // The catalogue is part of the population definition, so it has to be read here, on the server,
  // before the query runs — hence a cookie rather than localStorage. The Team Stats card reads the
  // same one, so the card and this page can never disagree about what counts as automated.
  const automationLabels = resolveAutomationLabels(cookies().get(AUTOMATION_LABELS_COOKIE)?.value);
  const includeBlank = resolveIncludeBlank(cookies().get(AUTOMATION_INCLUDE_BLANK_COOKIE)?.value);
  const baselines = await getKpiBaselines(team.team_key);
  const report = await getAutomatedTicketsReport(team.team_key, range, period, {
    issueType,
    grain,
    automationLabels,
    includeBlank,
    baseline: baselines.automated_share,
  });

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="max-w-3xl">
          <Link
            href={`/${team.team_key.toLowerCase()}?${query}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — Automated Tickets</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Tickets resolved in the period that automation handled: <strong>Assigned SE</strong> is{" "}
            {AUTOMATION_ASSIGNED_SE_NAMES.join(" / ")}, or the ticket carries one of your catalogued automation labels. By default a
            blank Assigned SE is a tagging gap, not automation — those are listed under Data quality, and the toggle below
            can count them. Jira&apos;s own assignee is never
            used. {report.excludedStatuses.join(" and ")} tickets are left out of the count (nobody did the work) but stay in the
            share&apos;s denominator.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <LabelPrefsProvider>
        <AutomatedDeepDive
          report={report}
          jiraBaseUrl={process.env.JIRA_BASE_URL}
          breakdowns={
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <CountRankTable title="By Issue Type" keyLabel="Issue Type" rows={report.byIssueType} emptyMessage="No automated tickets in this period." />
              <CountRankTable title="By Product" keyLabel="Product" rows={report.byProduct} emptyMessage="No automated tickets in this period." />
              <CountRankTable
                title="By Ticket Escalation"
                keyLabel="Escalated To"
                rows={report.byEscalation}
                emptyMessage="No automated tickets in this period."
              />
            </div>
          }
          panel={
            <AutomatedTicketsPanel
              tickets={report.tickets}
              totalCount={report.automatedCount}
              automationLabels={report.automationLabels}
              jiraBaseUrl={process.env.JIRA_BASE_URL}
            />
          }
        />
      </LabelPrefsProvider>
    </div>
  );
}
