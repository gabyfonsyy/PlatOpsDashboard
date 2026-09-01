import {
  getToolAssistedCycleTimeReport,
  getToolAssistedBaselineComparison,
} from "@/lib/tool-assisted";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ToolAssistedTable } from "@/components/dashboard/ToolAssistedTable";
import { ToolAssistedComparisonTable } from "@/components/dashboard/ToolAssistedComparisonTable";
import { ToolAssistedCompositionTable } from "@/components/dashboard/ToolAssistedCompositionTable";
import { ToolAssistedSeTable } from "@/components/dashboard/ToolAssistedSeTable";
import { ToolAssistedBaselineTable } from "@/components/dashboard/ToolAssistedBaselineTable";
import { formatDaysValue, formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";

export default async function ToolAssistedPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);
  // Independent queries — the baseline table reads its own, wider slice of history (its Baseline
  // column is fixed regardless of the filter), so there is no reason to await them in sequence.
  const [report, baseline] = await Promise.all([
    getToolAssistedCycleTimeReport(range, period),
    getToolAssistedBaselineComparison(range, period),
  ]);

  const { toolAssisted, others, fasterBy, bottleneck } = report;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1>Tool-Assisted Efficiency</h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-3xl">
            Two cycle times per ticket — <span className="font-medium text-neutral-700">doer</span>{" "}
            (out of To Do → For Peer Review) and{" "}
            <span className="font-medium text-neutral-700">reviewer</span> (in For Peer Review → On Hold
            or For Checking) — plus their sum as the total. Tickets labeled &quot;{report.label}&quot; are
            measured against the rest of the team&apos;s backend execution work, so the comparison also
            shows which of the two stages the tool is actually shortening. All durations are in days, with
            the days/hours/minutes equivalent underneath.
          </p>
        </div>
        <FilterBar />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Tool-Assisted Total"
          value={formatDaysValue(toolAssisted.combinedAvgMinutes)}
          sublabel={
            [
              formatDurationBreakdown(toolAssisted.combinedAvgMinutes),
              `${formatNumber(toolAssisted.ticketCount)} ticket${toolAssisted.ticketCount === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          tooltip={`Average doer time plus average reviewer time for "${report.label}"-labeled tickets created in the period, in days — the typical end-to-end cycle. Built from the two stage averages rather than per-ticket totals, because the two stages have different denominators.`}
        />
        <MetricCard
          label="Other Backend Total"
          value={formatDaysValue(others.combinedAvgMinutes)}
          sublabel={
            [
              formatDurationBreakdown(others.combinedAvgMinutes),
              `${formatNumber(others.ticketCount)} ticket${others.ticketCount === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          tooltip="Same definition, for the team's other backend execution tickets created in the period (Backend Changes, Company Policy, Data Deletion, Task, Account Creation), in days."
        />
        <MetricCard
          label="Faster By"
          value={formatPercent(fasterBy.combined)}
          sublabel={
            fasterBy.combined === null
              ? "not enough data yet"
              : fasterBy.combined >= 0
                ? "vs. tickets without the tool"
                : "slower than tickets without the tool"
          }
          tooltip="(Other total − Tool-assisted total) ÷ Other total, on the end-to-end cycle time. The per-stage figures are in the table below — the tool can only shorten the doer's half, so that row is the honest one."
          // The one unambiguously good state on this page gets the ambient drift in ADHD View.
          className={fasterBy.combined !== null && fasterBy.combined > 0 ? "adhd-happy" : undefined}
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

      {/* After the composition table: that one says what the categories ARE, this one says whether
          the tool changed them. */}
      <ToolAssistedBaselineTable comparisons={baseline} />

      <ToolAssistedSeTable
        bySe={report.bySe}
        unattributed={report.unattributedToolAssisted}
      />

      <ToolAssistedTable tickets={toolAssisted.tickets} jiraBaseUrl={process.env.JIRA_BASE_URL} />
    </div>
  );
}
