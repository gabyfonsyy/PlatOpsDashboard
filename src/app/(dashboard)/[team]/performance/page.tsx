import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { getAssigneeMetrics } from "@/lib/metrics";
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
  const data = await getAssigneeMetrics(team.team_key, range, period);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>{team.team_name} — Performance</h1>
          <p className="text-sm text-neutral-500 mt-1">Per-person breakdown for evaluations and capacity review.</p>
        </div>
        <FilterBar />
      </div>
      <AssigneeTable assignees={data.assignees} />
    </div>
  );
}
