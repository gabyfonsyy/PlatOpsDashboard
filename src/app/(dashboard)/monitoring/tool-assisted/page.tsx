import { getToolAssistedCycleTimeReport } from "@/lib/tool-assisted";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ToolAssistedTable } from "@/components/dashboard/ToolAssistedTable";
import { ToolAssistedComparisonTable } from "@/components/dashboard/ToolAssistedComparisonTable";
import { ToolAssistedCompositionTable } from "@/components/dashboard/ToolAssistedCompositionTable";
import { ToolAssistedSeTable } from "@/components/dashboard/ToolAssistedSeTable";
import { ToolAssistedWorkTypeTable } from "@/components/dashboard/ToolAssistedWorkTypeTable";
import { formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";

export default async function ToolAssistedPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);
  const report = await getToolAssistedCycleTimeReport(range, period);

  const { toolAssisted, others, fasterBy, bottleneck } = report;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1>Tool-Assisted Efficiency</h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-3xl">
            Two cycle times per ticket: the <span className="font-medium text-neutral-700">actual effort</span>{" "}
            (out of To Do → For Peer Review) and the{" "}
            <span className="font-medium text-neutral-700">peer review</span> (in For Peer Review → On
            Hold or For Checking). Tickets labeled &quot;{report.label}&quot; are measured against every
            other in-scope ST ticket, so the comparison also shows which of the two stages the tool is
            actually shortening.
          </p>
        </div>
        <FilterBar />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Tool-Assisted Avg"
          value={formatDurationBreakdown(toolAssisted.avgOfTwoMinutes) ?? "—"}
          sublabel={`${formatNumber(toolAssisted.ticketCount)} ticket${toolAssisted.ticketCount === 1 ? "" : "s"} · ${formatNumber(toolAssisted.peerReviewCycleCount)} review cycle${toolAssisted.peerReviewCycleCount === 1 ? "" : "s"}`}
          tooltip={`Mean of the two stage averages for "${report.label}"-labeled tickets created in the period. Not a per-ticket figure — the two stages have different denominators.`}
        />
        <MetricCard
          label="Other Tickets Avg"
          value={formatDurationBreakdown(others.avgOfTwoMinutes) ?? "—"}
          sublabel={`${formatNumber(others.ticketCount)} ticket${others.ticketCount === 1 ? "" : "s"} · ${formatNumber(others.peerReviewCycleCount)} review cycle${others.peerReviewCycleCount === 1 ? "" : "s"}`}
          tooltip="Same definition, for every other in-scope ST ticket created in the period."
        />
        <MetricCard
          label="Faster By"
          value={formatPercent(fasterBy.avgOfTwo)}
          sublabel={
            fasterBy.avgOfTwo === null
              ? "not enough data yet"
              : fasterBy.avgOfTwo >= 0
                ? "vs. tickets without the tool"
                : "slower than tickets without the tool"
          }
          tooltip="(Other avg − Tool-assisted avg) ÷ Other avg, on the average of the two stages. The per-stage figures are in the table below — the tool can only shorten execution, so that row is the honest one."
          // The one unambiguously good state on this page gets the ambient drift in ADHD View.
          className={fasterBy.avgOfTwo !== null && fasterBy.avgOfTwo > 0 ? "adhd-happy" : undefined}
        />
        <MetricCard
          label="Bottleneck"
          value={bottleneck.stage ?? "—"}
          sublabel={
            bottleneck.stage
              ? `${formatPercent(bottleneck.stage === "Peer review" ? bottleneck.peerReviewShare : bottleneck.actualShare, 0)} of all logged time`
              : "no measurable time yet"
          }
          tooltip="Which stage holds more of the total time across every in-scope ticket, tool-assisted or not. Totals, not averages — a slow stage with three tickets in it is not where the time is going."
        />
      </div>

      <ToolAssistedComparisonTable
        label={report.label}
        toolAssisted={toolAssisted}
        others={others}
        fasterBy={fasterBy}
      />

      <ToolAssistedCompositionTable byCategory={report.byCategory} />

      {/* The two "where is the time" tables. Full width each rather than side by side: both are wide
          enough that a two-column row would put each into its own horizontal scroll. */}
      <ToolAssistedWorkTypeTable byWorkType={report.byWorkType} />

      <ToolAssistedSeTable bySe={report.bySe} />

      <ToolAssistedTable tickets={toolAssisted.tickets} jiraBaseUrl={process.env.JIRA_BASE_URL} />
    </div>
  );
}
