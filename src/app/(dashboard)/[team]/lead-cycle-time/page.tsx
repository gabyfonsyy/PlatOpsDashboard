import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getCycleTimeDeepDive, getLeadTimeDeepDive, type LeadCycleTimeMetric, type CycleTimeWorkCategory } from "@/lib/lead-cycle-time";
import { resolveFilters } from "@/lib/date-ranges";
import { EXTRA_EXCLUDED_LABELS_COOKIE, resolveExtraExcludedLabels } from "@/lib/excluded-labels";
import { FilterBar } from "@/components/filters/FilterBar";
import { LeadTimeDeepDive } from "@/components/dashboard/LeadTimeDeepDive";
import { CycleTimeDeepDive } from "@/components/dashboard/CycleTimeDeepDive";
import { CycleTimeWorkCategoryToggle } from "@/components/dashboard/CycleTimeWorkCategoryToggle";
import { ExcludedLabelsEditor } from "@/components/dashboard/ExcludedLabelsEditor";

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
  const extraExcludedLabels = resolveExtraExcludedLabels(cookies().get(EXTRA_EXCLUDED_LABELS_COOKIE)?.value);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  const rawWorkCategory = Array.isArray(searchParams.workCategory) ? searchParams.workCategory[0] : searchParams.workCategory;
  const workCategory: CycleTimeWorkCategory | undefined =
    rawWorkCategory === "backend" || rawWorkCategory === "investigations" ? rawWorkCategory : undefined;

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
    const report = await getLeadTimeDeepDive(team.team_key, range, period, issueType, workCategory);

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

        {report.hasWorkCategorySplit && (
          <CycleTimeWorkCategoryToggle
            active={workCategory ?? "all"}
            labels={{ all: "All SE Work", backend: "Backend Changes", investigations: "Investigations" }}
          />
        )}

        <LeadTimeDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} extraExcludedLabels={extraExcludedLabels} />
      </div>
    );
  }

  // ------------------------------------------------------------- Cycle Time (rebuilt deep-dive)
  const report = await getCycleTimeDeepDive(team.team_key, range, period, issueType, workCategory);

  const headerBlurb =
    report.workflowModel === "doer-validator"
      ? "Where Cycle Time is actually being spent — execution vs. review — and what's driving it."
      : report.workflowModel === "doer-only"
        ? "Investigations have no validation stage — Cycle Time here is execution time, start to finish."
        : "Work execution time, bottlenecks, and long-running work.";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="max-w-2xl">
          {backLink}
          <h1>{teamLabel(team.team_name)} — Cycle Time</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {headerBlurb} {report.description} Only tickets counted in the selected period are included.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      {team.has_peer_review_tracking && (
        <CycleTimeWorkCategoryToggle
          active={workCategory ?? "all"}
          labels={{ all: "All SE Work", backend: "Backend Changes", investigations: "Investigations" }}
        />
      )}

      <CycleTimeDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} extraExcludedLabels={extraExcludedLabels} />
    </div>
  );
}
