import { getLatePickupReport } from "@/lib/late-pickup";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { LatePickupTable } from "@/components/dashboard/LatePickupTable";

export default async function LatePickupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);
  const report = await getLatePickupReport(range, period);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>Account Creation Review</h1>
          <p className="text-sm text-neutral-500 mt-1">
            SEs who picked up an Account Creation ticket after its Day-1 deadline, against the 2-day SLA.
          </p>
        </div>
        <FilterBar />
      </div>

      <LatePickupTable bySe={report.bySe} tickets={report.tickets} atRisk={report.atRisk} />
    </div>
  );
}
