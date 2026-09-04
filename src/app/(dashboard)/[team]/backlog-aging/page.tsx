import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getBacklogAgingDeepDive } from "@/lib/backlog-aging";
import type { CycleTimeWorkCategory } from "@/lib/lead-cycle-time";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { CycleTimeWorkCategoryToggle } from "@/components/dashboard/CycleTimeWorkCategoryToggle";
import { BacklogAgingDeepDive } from "@/components/dashboard/BacklogAgingDeepDive";

export default async function BacklogAgingPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);

  const rawWorkCategory = Array.isArray(searchParams.workCategory) ? searchParams.workCategory[0] : searchParams.workCategory;
  const workCategory: CycleTimeWorkCategory | undefined =
    rawWorkCategory === "backend" || rawWorkCategory === "investigations" ? rawWorkCategory : undefined;

  const report = await getBacklogAgingDeepDive(team.team_key, range, period, issueType, workCategory);

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="max-w-2xl">
          <Link
            href={`/${team.team_key.toLowerCase()}?${query}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — Backlog & Ageing</h1>
          <p className="text-sm text-neutral-500 mt-1">
            How much unfinished work exists, how old it is, whether it&apos;s growing, where it&apos;s
            concentrated, and how often work is resolved beyond its due date.
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

      <BacklogAgingDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} />
    </div>
  );
}
