"use client";

import { useState } from "react";
import type { CycleTimeDeepDiveReport } from "@/lib/lead-cycle-time";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cycleTimeCopy } from "@/lib/cycle-time-view";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { CycleTimeDoerValidatorBar } from "@/components/dashboard/CycleTimeDoerValidatorBar";
import { CycleTimeTrendChart } from "@/components/dashboard/CycleTimeTrendChart";
import { CycleTimeDistributionChart } from "@/components/dashboard/CycleTimeDistributionChart";
import { CycleTimeBreakdownTable } from "@/components/dashboard/CycleTimeBreakdownTable";
import { CycleTimeCategoryComparison } from "@/components/dashboard/CycleTimeCategoryComparison";
import { CycleTimeLongestWorkTable } from "@/components/dashboard/CycleTimeLongestWorkTable";
import { CycleTimePatternsTable } from "@/components/dashboard/CycleTimePatternsTable";
import { CycleTimeTicketsTable } from "@/components/dashboard/CycleTimeTicketsTable";
import { ExcludedLabelsEditor } from "@/components/dashboard/ExcludedLabelsEditor";
import { formatNumber } from "@/lib/format";

function fmtDaysValue(minutes: number | null): string {
  return minutes === null ? "—" : (minutes / 1440).toFixed(2);
}

function daysBreakdown(minutes: number | null): string | undefined {
  if (minutes === null) return undefined;
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(" ");
}

/** Lower Cycle Time is always the improvement, same convention as the Lead Time deep-dive. */
function cycleTimeTrend(delta: { deltaPct: number | null } | undefined) {
  if (!delta || delta.deltaPct === null || Math.abs(delta.deltaPct) < 0.005) return undefined;
  const pct = Math.round(delta.deltaPct * 1000) / 10;
  return {
    direction: (delta.deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${pct > 0 ? "+" : ""}${pct}% vs previous period`,
    positive: delta.deltaPct < 0,
  };
}

function volumeTrend(delta: { deltaPct: number | null } | undefined) {
  if (!delta || delta.deltaPct === null || Math.abs(delta.deltaPct) < 0.005) return undefined;
  const pct = Math.round(delta.deltaPct * 1000) / 10;
  return {
    direction: (delta.deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${pct > 0 ? "+" : ""}${pct}% vs previous period`,
    positive: null,
  };
}

/**
 * The Cycle Time drill-down's body — same pulse -> insights -> trend -> distribution ->
 * breakdown -> longest-work -> patterns -> details progression as LeadTimeDeepDive (its explicit
 * design reference), with one addition for a peer-review team (SE): a Doer/Validator centerpiece
 * — three connected values, a stacked share bar, and a "where is the time going" read — sits right
 * after the headline pulse row, because the brief's whole point is not collapsing that
 * decomposition into a single number too early (section 20).
 *
 * hasDoerValidatorSplit is the one flag every section branches on; nothing else about a team
 * changes this component's shape. Gaby's View only changes section titles/microcopy (see
 * lib/cycle-time-view.ts) — every number, ranking, and filter is identical in both registers.
 */
export function CycleTimeDeepDive({
  report,
  jiraBaseUrl,
  extraExcludedLabels,
}: {
  report: CycleTimeDeepDiveReport;
  jiraBaseUrl?: string;
  extraExcludedLabels: string[];
}) {
  const { theme } = useTheme();
  const copy = cycleTimeCopy(theme);
  const split = report.hasDoerValidatorSplit;
  const doerOnly = report.workflowModel === "doer-only";
  const pulseCycleTimeLabel = doerOnly ? copy.investigationCycleTimeLabel : copy.cycleTimeLabel;
  const allSeWork = report.categoryComparison !== null;

  const [ticketType, setTicketType] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);

  const hasFilter = Boolean(ticketType || product || assignee || bucket);
  const clearFilters = () => {
    setTicketType(null);
    setProduct(null);
    setAssignee(null);
    setBucket(null);
  };

  const c = report.comparison;

  return (
    <div className="flex flex-col gap-6">
      {/* ===================================================== DOER / VALIDATOR CENTERPIECE (SE) */}
      {split && (
        <CycleTimeDoerValidatorBar
          pulse={report.pulse}
          insight={report.doerValidatorInsight}
          doerLabel={copy.doerLabel}
          validatorLabel={copy.validatorLabel}
          totalLabel={copy.totalLabel}
        />
      )}

      {/* Investigations have no Validator stage — say so once, plainly, instead of a blank/N/A
          Validator section further down (brief section 2: never silently imply Doer + 0 = Total). */}
      {doerOnly && (
        <div className="card p-4 text-sm text-neutral-600 flex items-center justify-between flex-wrap gap-2">
          <span>
            <span className="font-medium text-neutral-900">{copy.investigationCycleTimeLabel} = {copy.doerLabel}.</span>{" "}
            This work has no validation stage, so execution time is the whole Cycle Time.
          </span>
          <span className="text-xs text-neutral-400 shrink-0">{copy.validatorLabel}: {copy.validationNotRequired}</span>
        </div>
      )}

      {allSeWork && report.categoryComparison && (
        <CycleTimeCategoryComparison title={copy.compositionTitle} rows={report.categoryComparison} />
      )}

      {/* ============================================================ PULSE */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {!split && (
          <MetricCard
            label={`Average ${pulseCycleTimeLabel}`}
            value={`${fmtDaysValue(report.pulse.total.avgMinutes)}d`}
            sublabel={daysBreakdown(report.pulse.total.avgMinutes)}
            trend={cycleTimeTrend(c?.totalAvgMinutes)}
            tooltip={`Mean ${pulseCycleTimeLabel} across completed tickets. A few very slow tickets can pull it upward — read it next to Median.`}
          />
        )}
        <MetricCard
          label={`Median ${pulseCycleTimeLabel}`}
          value={`${fmtDaysValue(report.pulse.total.medianMinutes)}d`}
          sublabel={daysBreakdown(report.pulse.total.medianMinutes)}
          trend={cycleTimeTrend(c?.totalMedianMinutes)}
          tooltip={`The midpoint completed ticket's ${pulseCycleTimeLabel.toLowerCase()} — the fairest single read of a typical ticket. Lower is better.`}
        />
        <MetricCard
          label={`P75 ${pulseCycleTimeLabel}`}
          value={`${fmtDaysValue(report.pulse.total.p75Minutes)}d`}
          sublabel="75th percentile"
          tooltip={`3 in 4 completed tickets finished at or below this ${pulseCycleTimeLabel.toLowerCase()}.`}
        />
        <MetricCard
          label={`P90 ${pulseCycleTimeLabel}`}
          value={report.pulse.total.p90Minutes === null ? "N/A" : `${fmtDaysValue(report.pulse.total.p90Minutes)}d`}
          sublabel={report.pulse.total.p90Minutes === null ? "Needs a larger sample" : "90th percentile — the long tail"}
          trend={cycleTimeTrend(c?.totalP90Minutes)}
          tooltip={`9 in 10 completed tickets finished at or below this ${pulseCycleTimeLabel.toLowerCase()}. Shows how bad the slowest work gets.`}
        />
        <MetricCard
          label="Completed Work"
          value={formatNumber(report.pulse.count)}
          sublabel="Counted in every figure on this page"
          trend={volumeTrend(c?.count)}
          tooltip={`Number of completed tickets contributing to every ${pulseCycleTimeLabel} figure on this page.`}
        />
      </div>

      <InsightsPanel insights={report.insights} positiveHighlights={report.positiveHighlights} title={copy.whatsGoingOn} />

      {/* ============================================================ TREND */}
      <CycleTimeTrendChart trend={report.trend} hasDoerValidatorSplit={split} title={copy.trendTitle} />

      {/* ====================================================== DISTRIBUTION */}
      <CycleTimeDistributionChart
        distribution={report.distribution}
        percentiles={report.percentiles}
        hasDoerValidatorSplit={split}
        metricLabels={{ total: "Total", doer: copy.doerLabel.replace(" Cycle Time", "").replace(" Time", ""), validator: copy.validatorLabel.replace(" Cycle Time", "").replace(" Time", "") }}
        selectedBucket={bucket}
        onSelectBucket={setBucket}
      />

      {/* ========================================================= BREAKDOWN */}
      <div>
        <h2 className="mb-3">{copy.breakdownTitle}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CycleTimeBreakdownTable
            title="By Ticket Type"
            keyLabel="Ticket Type"
            rows={report.byTicketType}
            hasDoerValidatorSplit={split}
            selectedKey={ticketType}
            onSelect={setTicketType}
            categoryLabels={allSeWork ? { backend: copy.backendChanges, investigations: copy.investigations, other: "Other" } : undefined}
          />
          <CycleTimeBreakdownTable title="By Product" keyLabel="Product" rows={report.byProduct} hasDoerValidatorSplit={split} selectedKey={product} onSelect={setProduct} />
        </div>
      </div>

      {/* ==================================================== INDIVIDUAL (SE) */}
      {split && report.byAssignee.length > 0 && (
        <CycleTimeBreakdownTable
          title={`${copy.individualTitle} — ${report.assigneeLabel}`}
          keyLabel={report.assigneeLabel}
          rows={report.byAssignee}
          hasDoerValidatorSplit={split}
          selectedKey={assignee}
          onSelect={setAssignee}
        />
      )}

      {/* ==================================================== LONGEST WORK */}
      <CycleTimeLongestWorkTable
        hasDoerValidatorSplit={split}
        longestToExecute={report.longestToExecute}
        longestToExecuteTotalCount={report.longestToExecuteTotalCount}
        longestToValidate={report.longestToValidate}
        longestToValidateTotalCount={report.longestToValidateTotalCount}
        longestEndToEnd={report.longestEndToEnd}
        longestEndToEndTotalCount={report.longestEndToEndTotalCount}
        assigneeLabel={report.assigneeLabel}
        jiraBaseUrl={jiraBaseUrl}
        labels={{ execute: copy.longestToExecute, validate: copy.longestToValidate, endToEnd: copy.longestEndToEnd }}
        extraExcludedLabels={extraExcludedLabels}
        nonSplitTitle={doerOnly ? copy.longestInvestigationsTitle : undefined}
      />

      <CycleTimePatternsTable rows={report.patterns} title={copy.patternsTitle} />

      <ExcludedLabelsEditor labels={extraExcludedLabels} />

      {/* ============================================================= DETAILS */}
      <CycleTimeTicketsTable
        tickets={report.tickets}
        assigneeLabel={report.assigneeLabel}
        hasDoerValidatorSplit={split}
        jiraBaseUrl={jiraBaseUrl}
        totalCount={report.ticketsTotalCount}
        ticketTypeFilter={ticketType}
        productFilter={product}
        assigneeFilter={assignee}
        bucketFilter={bucket}
        distribution={report.distribution.total}
        onClearFilters={hasFilter ? clearFilters : undefined}
        title={copy.detailsTitle}
        extraExcludedLabels={extraExcludedLabels}
      />
    </div>
  );
}
