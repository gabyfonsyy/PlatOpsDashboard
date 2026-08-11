import { getToolAssistedCycleTimeReport } from "@/lib/tool-assisted";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ToolAssistedTable } from "@/components/dashboard/ToolAssistedTable";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";

export default async function ToolAssistedPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);
  const report = await getToolAssistedCycleTimeReport(range, period);

  const { toolAssisted, others } = report;
  const improvementPct =
    toolAssisted.avgCycleTimeMinutes !== null && others.avgCycleTimeMinutes
      ? (others.avgCycleTimeMinutes - toolAssisted.avgCycleTimeMinutes) / others.avgCycleTimeMinutes
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>Tool-Assisted Efficiency</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Cycle time (moved out of To Do → entered For Peer Review) for tickets labeled &quot;{report.label}&quot;, against every other ticket in the period.
          </p>
        </div>
        <FilterBar />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Tool-Assisted Avg Cycle Time"
          value={formatMinutesDecimalValue(toolAssisted.avgCycleTimeMinutes)}
          sublabel={
            toolAssisted.avgCycleTimeMinutes !== null
              ? `${formatDurationBreakdown(toolAssisted.avgCycleTimeMinutes)} · ${formatNumber(toolAssisted.count)} ticket${toolAssisted.count === 1 ? "" : "s"}`
              : `${formatNumber(toolAssisted.count)} tickets`
          }
          tooltip={`Average time from moving out of Backlog/To Do to entering For Peer Review, across "${report.label}"-labeled tickets created in the period.`}
        />
        <MetricCard
          label="Other Tickets Avg Cycle Time"
          value={formatMinutesDecimalValue(others.avgCycleTimeMinutes)}
          sublabel={
            others.avgCycleTimeMinutes !== null
              ? `${formatDurationBreakdown(others.avgCycleTimeMinutes)} · ${formatNumber(others.count)} ticket${others.count === 1 ? "" : "s"}`
              : `${formatNumber(others.count)} tickets`
          }
          tooltip={`Same definition, for every other in-scope ST ticket created in the period (not labeled "${report.label}").`}
        />
        <MetricCard
          label="Faster By"
          value={formatPercent(improvementPct)}
          sublabel={improvementPct !== null ? (improvementPct >= 0 ? "vs. tickets without the tool" : "slower than tickets without the tool") : "not enough data yet"}
          tooltip="(Other avg − Tool-assisted avg) ÷ Other avg. Positive means tool-assisted tickets clear peer review faster."
        />
      </div>

      <ToolAssistedTable tickets={toolAssisted.tickets} jiraBaseUrl={process.env.JIRA_BASE_URL} />
    </div>
  );
}
