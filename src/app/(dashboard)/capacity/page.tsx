import { getCapacityOverview, getCapacityTrend } from "@/lib/capacity";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { CapacityOrgView } from "@/components/dashboard/CapacityOrgView";
import { PageTitle } from "@/components/ui/PageTitle";

export default async function CapacityPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);

  const [overview, trend] = await Promise.all([getCapacityOverview(range, period), getCapacityTrend()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="max-w-2xl">
          <PageTitle page="capacity" />
          <p className="text-sm text-neutral-500 mt-1">
            Does Platform Operations have sustainable capacity for additional work? Evidence for headcount, scope, and prioritization
            decisions — not a productivity leaderboard.
          </p>
        </div>
        <FilterBar />
      </div>

      <CapacityOrgView overview={overview} trend={trend} />
    </div>
  );
}
