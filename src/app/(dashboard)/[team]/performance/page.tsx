import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getAssigneeMetrics, getInsight } from "@/lib/metrics";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { AssigneeTable } from "@/components/dashboard/AssigneeTable";

export default async function TeamPerformancePage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period } = resolveFilters(searchParams);
  const [data, insight] = await Promise.all([
    getAssigneeMetrics(team.team_key, range, period),
    getInsight(`TEAM:${team.team_key}`),
  ]);

  // Flags come from the daily Gemini run's deterministic outlier detection (Insights.gs),
  // not recomputed live here — cached flags are keyed by employee name, merged onto rows.
  const flagsByEmployee = new Map<string, string[]>();
  (insight?.flags ?? []).forEach((f) => {
    const label = f.code ?? f.metric;
    flagsByEmployee.set(f.employee, [...(flagsByEmployee.get(f.employee) ?? []), label]);
  });
  const assignees = data.assignees.map((a) => ({ ...a, flags: flagsByEmployee.get(a.name) ?? [] }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link
            href={`/${team.team_key.toLowerCase()}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — Performance</h1>
          <p className="text-sm text-neutral-500 mt-1">Per-person breakdown for evaluations and capacity review.</p>
        </div>
        <FilterBar />
      </div>
      <AssigneeTable assignees={assignees} />
    </div>
  );
}
