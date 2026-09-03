"use client";

import { useState } from "react";
import type { LeadTimeDeepDiveReport } from "@/lib/lead-cycle-time";
import { useTheme } from "@/components/theme/ThemeProvider";
import { leadTimeCopy } from "@/lib/lead-time-view";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { LeadTimeTrendChart } from "@/components/dashboard/LeadTimeTrendChart";
import { LeadTimeDistributionChart } from "@/components/dashboard/LeadTimeDistributionChart";
import { LeadTimeBreakdownTable } from "@/components/dashboard/LeadTimeBreakdownTable";
import { LeadTimeCategoryComparison } from "@/components/dashboard/LeadTimeCategoryComparison";
import { LeadTimeActiveWorkCard } from "@/components/dashboard/LeadTimeActiveWorkCard";
import { LeadTimeFlowBreakdown } from "@/components/dashboard/LeadTimeFlowBreakdown";
import { LeadTimeOutliersTable } from "@/components/dashboard/LeadTimeOutliersTable";
import { LeadTimePatternsTable } from "@/components/dashboard/LeadTimePatternsTable";
import { LeadTimeTicketsTable } from "@/components/dashboard/LeadTimeTicketsTable";
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

/** Lower Lead Time is always the improvement (unlike a compliance rate), so a decrease reads green. */
function leadTimeTrend(delta: { deltaPct: number | null } | undefined) {
  if (!delta || delta.deltaPct === null || Math.abs(delta.deltaPct) < 0.005) return undefined;
  const pct = Math.round(delta.deltaPct * 1000) / 10;
  return {
    direction: (delta.deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${pct > 0 ? "+" : ""}${pct}% vs previous period`,
    positive: delta.deltaPct < 0,
  };
}

/** Completed-ticket volume isn't inherently good or bad, so its trend arrow stays neutral-colored. */
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
 * The Lead Time drill-down body: pulse -> insights -> [Work Category composition, SE only] ->
 * [Lead Time vs. Active Work, SE only] -> trend -> distribution -> breakdown -> individual ->
 * bottleneck (flow) -> outliers -> patterns -> details. Owns the three cross-filters (work type,
 * product, distribution bucket) as local state — see LeadTimeTicketsTable's doc comment for why
 * only the details table, not the charts/summary tables above it, is scoped by them.
 *
 * Work Category (Backend Changes vs. Investigations) re-scopes the WHOLE report server-side via
 * the page's URL param — see getLeadTimeDeepDive's `workCategory` parameter and the
 * CycleTimeWorkCategoryToggle rendered above this component in page.tsx (reused as-is: it's
 * page-agnostic, not Cycle-Time-specific despite the file name).
 */
export function LeadTimeDeepDive({
  report,
  jiraBaseUrl,
  extraExcludedLabels,
}: {
  report: LeadTimeDeepDiveReport;
  jiraBaseUrl?: string;
  /** User-added label exclusions (lib/excluded-labels.ts) — resolved server-side from the cookie
   * and passed down so the ticket table's Labels column honors them without a client refetch. */
  extraExcludedLabels: string[];
}) {
  const { theme } = useTheme();
  const copy = leadTimeCopy(theme);
  const allSeWork = report.categoryComparison !== null;

  const [workType, setWorkType] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);

  const hasFilter = Boolean(workType || product || assignee || bucket);
  const clearFilters = () => {
    setWorkType(null);
    setProduct(null);
    setAssignee(null);
    setBucket(null);
  };

  const c = report.comparison;

  const longestWorkTitle =
    report.workCategory === "backend" ? copy.longestBackend : report.workCategory === "investigations" ? copy.longestInvestigations : copy.longestOverall;

  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================ PULSE */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          label={`Median ${copy.leadTimeLabel}`}
          value={`${fmtDaysValue(report.pulse.medianMinutes)}d`}
          sublabel={daysBreakdown(report.pulse.medianMinutes)}
          trend={leadTimeTrend(c?.medianMinutes)}
          tooltip="The midpoint completed ticket's Lead Time — the fairest single read of a typical ticket, since a handful of very slow tickets can't drag it around the way they drag the average. Lower is better."
        />
        <MetricCard
          label={`Average ${copy.leadTimeLabel}`}
          value={`${fmtDaysValue(report.pulse.avgMinutes)}d`}
          sublabel={daysBreakdown(report.pulse.avgMinutes)}
          trend={leadTimeTrend(c?.avgMinutes)}
          tooltip="Mean Lead Time across completed tickets. Useful for overall comparison, but a few very slow tickets can pull it upward — read it next to Median."
        />
        <MetricCard
          label={`P75 ${copy.leadTimeLabel}`}
          value={`${fmtDaysValue(report.pulse.p75Minutes)}d`}
          sublabel="75th percentile"
          tooltip="3 in 4 completed tickets finished at or below this Lead Time."
        />
        <MetricCard
          label={`P90 ${copy.leadTimeLabel}`}
          value={report.pulse.p90Minutes === null ? "N/A" : `${fmtDaysValue(report.pulse.p90Minutes)}d`}
          sublabel={report.pulse.p90Minutes === null ? "Needs a larger sample" : "90th percentile — the long tail"}
          trend={leadTimeTrend(c?.p90Minutes)}
          tooltip="9 in 10 completed tickets finished at or below this Lead Time. Shows how bad the slowest work gets, which the median and average both hide."
        />
        <MetricCard
          label="Completed Work"
          value={formatNumber(report.pulse.count)}
          sublabel="Counted in every figure above"
          trend={volumeTrend(c?.count)}
          tooltip="Number of completed tickets contributing to every Lead Time figure on this page."
        />
      </div>

      <InsightsPanel insights={report.insights} positiveHighlights={report.positiveHighlights} title={copy.whatsGoingOn} />

      {/* ============================================== WORK CATEGORY COMPOSITION (SE, All Work) */}
      {allSeWork && report.categoryComparison && (
        <LeadTimeCategoryComparison title={copy.compositionTitle} rows={report.categoryComparison} />
      )}

      {/* Investigations have no Validator stage — never implied here since this card only ever
          shows Doer/Validator when workflowModel is "doer-validator" (see LeadTimeActiveWorkCard). */}
      <LeadTimeActiveWorkCard
        pulse={report.pulse}
        activeWork={report.activeWork}
        insight={report.activeVsWaitingInsight}
        title={copy.activeWorkCardTitle}
        leadTimeLabel={copy.leadTimeLabel}
        activeWorkLabel={copy.activeWorkLabel}
        waitingLabel={copy.waitingLabel}
      />

      {/* ============================================================ TREND */}
      <LeadTimeTrendChart trend={report.trend} title={copy.trendTitle} />

      {/* ====================================================== DISTRIBUTION */}
      <LeadTimeDistributionChart
        distribution={report.distribution}
        percentiles={report.percentiles}
        selectedBucket={bucket}
        onSelectBucket={setBucket}
        title={copy.distributionTitle}
      />

      {/* ========================================================= BREAKDOWN */}
      <div>
        <h2 className="mb-3">{copy.breakdownTitle}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LeadTimeBreakdownTable
            title="By Work Type"
            keyLabel="Work Type"
            rows={report.byWorkType}
            selectedKey={workType}
            onSelect={setWorkType}
            categoryLabels={allSeWork ? { backend: copy.backendChanges, investigations: copy.investigations, other: "Other" } : undefined}
          />
          <LeadTimeBreakdownTable title="By Product" keyLabel="Product" rows={report.byProduct} selectedKey={product} onSelect={setProduct} />
        </div>
      </div>

      {/* ==================================================== INDIVIDUAL */}
      {report.byAssignee.length > 0 && (
        <LeadTimeBreakdownTable
          title={`${copy.individualTitle} — ${report.assigneeLabel}`}
          keyLabel={report.assigneeLabel}
          rows={report.byAssignee}
          selectedKey={assignee}
          onSelect={setAssignee}
          showCategoryMix={allSeWork}
        />
      )}

      {/* ============================================================== FLOW */}
      <LeadTimeFlowBreakdown flow={report.flow} />

      {/* ========================================================== OUTLIERS */}
      <LeadTimeOutliersTable
        rows={report.longRunning}
        assigneeLabel={report.assigneeLabel}
        jiraBaseUrl={jiraBaseUrl}
        totalCount={report.longRunningTotalCount}
        title={longestWorkTitle}
      />

      <LeadTimePatternsTable rows={report.patterns} title={copy.patternsTitle} />

      <ExcludedLabelsEditor labels={extraExcludedLabels} />

      {/* ============================================================= DETAILS */}
      <LeadTimeTicketsTable
        tickets={report.tickets}
        assigneeLabel={report.assigneeLabel}
        jiraBaseUrl={jiraBaseUrl}
        totalCount={report.ticketsTotalCount}
        workTypeFilter={workType}
        productFilter={product}
        assigneeFilter={assignee}
        bucketFilter={bucket}
        distribution={report.distribution}
        onClearFilters={hasFilter ? clearFilters : undefined}
        extraExcludedLabels={extraExcludedLabels}
        title={copy.detailsTitle}
      />
    </div>
  );
}
