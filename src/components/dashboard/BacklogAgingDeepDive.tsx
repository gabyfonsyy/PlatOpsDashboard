"use client";

import { useState } from "react";
import type { BacklogAgingDeepDiveReport } from "@/lib/backlog-aging";
import { useTheme } from "@/components/theme/ThemeProvider";
import { backlogAgingCopy } from "@/lib/backlog-aging-view";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { BacklogHealthCard } from "@/components/dashboard/BacklogHealthCard";
import { BacklogTrendChart } from "@/components/dashboard/BacklogTrendChart";
import { AgeingRateTrendChart } from "@/components/dashboard/AgeingRateTrendChart";
import { BacklogAgeDistributionChart } from "@/components/dashboard/BacklogAgeDistributionChart";
import { BacklogBreakdownTable } from "@/components/dashboard/BacklogBreakdownTable";
import { AgeingRateBreakdownTable } from "@/components/dashboard/AgeingRateBreakdownTable";
import { TimeInStatusTable } from "@/components/dashboard/TimeInStatusTable";
import { BacklogOpenTicketsTable } from "@/components/dashboard/BacklogOpenTicketsTable";
import { BacklogAgingTable } from "@/components/dashboard/BacklogAgingTable";
import { formatNumber, formatPercent, formatAgeDays } from "@/lib/format";

function ageDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return undefined;
  const deltaPct = (current - previous) / previous;
  if (Math.abs(deltaPct) < 0.05) return undefined;
  return {
    direction: (deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${deltaPct > 0 ? "+" : ""}${Math.round(deltaPct * 1000) / 10}% vs previous period`,
    // Age growing is never good; shrinking is the improvement.
    positive: deltaPct < 0,
  };
}

function countDelta(current: number, previous: number, positiveIsGrowth: boolean | null) {
  if (previous === 0) return undefined;
  const deltaPct = (current - previous) / previous;
  if (Math.abs(deltaPct) < 0.05) return undefined;
  return {
    direction: (deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${deltaPct > 0 ? "+" : ""}${Math.round(deltaPct * 1000) / 10}% vs previous period`,
    positive: positiveIsGrowth === null ? null : deltaPct > 0 ? positiveIsGrowth : !positiveIsGrowth,
  };
}

function ratePtsDelta(deltaPts: number | null) {
  if (deltaPts === null || Math.abs(deltaPts) < 0.5) return undefined;
  return {
    direction: (deltaPts > 0 ? "up" : "down") as "up" | "down",
    label: `${deltaPts > 0 ? "+" : ""}${deltaPts} pts vs previous period`,
    positive: deltaPts < 0, // a worse (higher) Ageing Rate is never the improvement
  };
}

/**
 * The Backlog & Ageing deep-dive body — Current Backlog → Health → Flow/Trend → Age Distribution
 * → Aging Risk / What Needs My Attention → Resolution Timeliness (Ageing Rate + its breakdowns)
 * → Team/Category/Owner breakdowns → Time in Status → Oldest/Stale → Insights → ticket details.
 * Mirrors LeadTimeDeepDive's / CycleTimeDeepDive's composition pattern.
 *
 * Cross-filtering is INTENTIONALLY PARTIAL, same deliberate scope line the Lead Time deep-dive
 * already drew (see its own doc comment): clicking a breakdown-table row or an age-bucket bar
 * sets LOCAL CLIENT STATE that filters only the bottom ticket-detail table — the summary cards,
 * health, trend, distribution and breakdown tables above stay backlog-wide. Owner/Priority/
 * Product/Status are therefore click-to-filter on their own breakdown tables rather than a
 * separate server-scoping dropdown; the only SERVER-side re-scope on this page is the SE Work
 * Category toggle (`?workCategory=`), same as Lead Time and Cycle Time.
 */
export function BacklogAgingDeepDive({
  report,
  jiraBaseUrl,
}: {
  report: BacklogAgingDeepDiveReport;
  jiraBaseUrl?: string;
}) {
  const { theme } = useTheme();
  const copy = backlogAgingCopy(theme);

  const [owner, setOwner] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);

  const hasFilter = Boolean(owner || category || issueType || status || bucket);
  const clearFilters = () => {
    setOwner(null);
    setCategory(null);
    setIssueType(null);
    setStatus(null);
    setBucket(null);
  };

  const s = report.summary;
  const c = report.currentAge.comparison;
  const rt = report.resolutionTimeliness;

  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================ CURRENT BACKLOG */}
      <div>
        <h2 className="mb-3">{copy.summaryTitle}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            label={copy.backlogLabel}
            value={formatNumber(s.endingBacklog)}
            sublabel={`${formatNumber(s.openingBacklog)} at period start`}
            trend={countDelta(s.backlogDelta.current, s.backlogDelta.previous, false)}
            tooltip="Every currently-open ticket for this team, right now — not scoped to the selected period."
          />
          <MetricCard
            label={copy.incomingLabel}
            value={formatNumber(s.incoming)}
            sublabel="created this period"
            tooltip="Tickets created during the selected period."
          />
          <MetricCard
            label={copy.completedLabel}
            value={formatNumber(s.completed)}
            sublabel="resolved this period"
            tooltip="Tickets resolved during the selected period."
          />
          <MetricCard
            label="Net Backlog Change"
            value={`${s.netChange > 0 ? "+" : ""}${formatNumber(s.netChange)}`}
            sublabel={s.netChange > 0 ? "Incoming > Completed — growing" : s.netChange < 0 ? "Completed > Incoming — shrinking" : "Incoming ≈ Completed — stable"}
            tooltip="Incoming minus Completed for the selected period."
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3">{copy.ageSummaryTitle}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <MetricCard label="Median Age" value={formatAgeDays(report.currentAge.medianAgeDays)} trend={ageDelta(c.medianAgeDays.current, c.medianAgeDays.previous)} tooltip="Midpoint age of every currently open ticket." />
          <MetricCard label="Average Age" value={formatAgeDays(report.currentAge.avgAgeDays)} tooltip="Mean age of every currently open ticket." />
          <MetricCard label="P75 Age" value={formatAgeDays(report.currentAge.p75AgeDays)} tooltip="3 in 4 open tickets are at or below this age." />
          <MetricCard label="P90 Age" value={formatAgeDays(report.currentAge.p90AgeDays)} trend={ageDelta(c.p90AgeDays.current, c.p90AgeDays.previous)} tooltip="9 in 10 open tickets are at or below this age — the long tail." />
          <MetricCard label={copy.oldestLabel} value={formatAgeDays(report.currentAge.oldestAgeDays)} sublabel={report.currentAge.oldestTicketKey ?? undefined} trend={ageDelta(c.oldestAgeDays.current, c.oldestAgeDays.previous)} tooltip="Age of the single oldest open ticket." />
        </div>
      </div>

      <InsightsPanel insights={report.insights} positiveHighlights={[]} title={copy.whatsGoingOn} />

      <BacklogHealthCard status={report.health.status} signals={report.health.signals} title={copy.healthTitle} />

      {/* ============================================================ FLOW / TREND */}
      <BacklogTrendChart trend={report.trend} incomingLabel={copy.incomingLabel} completedLabel={copy.completedLabel} title={copy.trendTitle} />

      {/* ====================================================== AGE DISTRIBUTION */}
      <BacklogAgeDistributionChart distribution={report.ageDistribution} currentAge={report.currentAge} selectedBucket={bucket} onSelectBucket={setBucket} title={copy.ageDistributionTitle} />

      {/* ============================================================= AGING RISK */}
      <div>
        <h2 className="mb-3">{copy.agingRiskTitle}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard label="Critical" value={formatNumber(report.agingRiskSummary.critical)} className={report.agingRiskSummary.critical > 0 ? "border-red-200" : undefined} />
          <MetricCard label="Aging Risk" value={formatNumber(report.agingRiskSummary.atRisk)} />
          <MetricCard label="Watch" value={formatNumber(report.agingRiskSummary.watch)} />
          <MetricCard label="Normal" value={formatNumber(report.agingRiskSummary.healthy)} />
        </div>
      </div>

      {/* ================================================ WHAT NEEDS ATTENTION */}
      <div className="flex flex-col gap-4">
        <h2>{copy.attentionTitle}</h2>
        {report.attention.concentration && (
          <div className="card p-4 text-sm text-neutral-700">
            {theme === "adhd" ? report.attention.concentration.text.gaby : report.attention.concentration.text.professional}
          </div>
        )}
        {report.attention.criticalAging.length > 0 && (
          <BacklogOpenTicketsTable rows={report.attention.criticalAging} assigneeLabel={report.assigneeLabel} jiraBaseUrl={jiraBaseUrl} title="Critical Aging" emptyLabel="No critical-aging tickets." />
        )}
        {report.attention.dueDateRisk.length > 0 && (
          <BacklogOpenTicketsTable rows={report.attention.dueDateRisk} assigneeLabel={report.assigneeLabel} jiraBaseUrl={jiraBaseUrl} title="Due-Date Risk" emptyLabel="No due-date-risk tickets." />
        )}
        {report.attention.stalled.length > 0 && (
          <BacklogOpenTicketsTable rows={report.attention.stalled} assigneeLabel={report.assigneeLabel} jiraBaseUrl={jiraBaseUrl} title="Stalled" emptyLabel="No stalled tickets." />
        )}
      </div>

      {/* ===================================================== RESOLUTION TIMELINESS */}
      <div>
        <h2 className="mb-3">{copy.timelinessTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label={copy.ageingRateLabel}
            value={formatPercent(rt.ageingRate, 2)}
            sublabel={`${formatNumber(rt.beyondDue)} of ${formatNumber(rt.resolved)} resolved overdue`}
            trend={ratePtsDelta(rt.comparison.deltaPts)}
            tooltip="Resolved beyond due date ÷ total resolved, for the selected period. Unrelated to current backlog age."
          />
          <MetricCard label="Total Resolved" value={formatNumber(rt.resolved)} sublabel="the rate's denominator" />
          <MetricCard label="Resolved Beyond Due Date" value={formatNumber(rt.beyondDue)} sublabel="the rate's numerator" />
        </div>
      </div>

      <AgeingRateTrendChart trend={report.ageingRateTrend} title={copy.ageingRateTrendTitle} />

      {report.hasWorkCategorySplit && report.ageingRateByWorkCategory.length > 0 && (
        <AgeingRateBreakdownTable title={copy.ageingRateByWorkCategoryTitle} keyLabel={copy.workCategoryLabel} rows={report.ageingRateByWorkCategory.map((r) => ({ ...r, key: r.key === "backend" ? copy.backendChanges : copy.investigations }))} />
      )}
      {report.hasWorkCategorySplit && report.ageingRateByIssueType.length > 0 && (
        <AgeingRateBreakdownTable title={copy.ageingRateByIssueTypeTitle} keyLabel={copy.issueTypeLabel} rows={report.ageingRateByIssueType} />
      )}

      <BacklogAgingTable tickets={report.overdueTickets} assigneeLabel={report.assigneeLabel} jiraBaseUrl={jiraBaseUrl} title={copy.overdueTicketDetailsTitle} />

      {/* ========================================================= BREAKDOWNS */}
      {report.hasWorkCategorySplit && report.byWorkCategory.length > 0 && (
        <BacklogBreakdownTable
          title={copy.byWorkCategoryTitle}
          keyLabel={copy.workCategoryLabel}
          rows={report.byWorkCategory.map((r) => ({ ...r, key: r.key === "backend" ? copy.backendChanges : copy.investigations }))}
          selectedKey={category ? (category === "backend" ? copy.backendChanges : copy.investigations) : null}
          onSelect={(k) => setCategory(k === null ? null : k === copy.backendChanges ? "backend" : "investigations")}
        />
      )}

      <BacklogBreakdownTable title={copy.byIssueTypeTitle} keyLabel={copy.issueTypeLabel} rows={report.byIssueType} selectedKey={issueType} onSelect={setIssueType} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BacklogBreakdownTable title={copy.byPriorityTitle} keyLabel="Priority" rows={report.byPriority} />
        <BacklogBreakdownTable title={copy.byProductTitle} keyLabel="Product" rows={report.byProduct} />
      </div>

      <TimeInStatusTable rows={report.timeInStatus} title={copy.timeInStatusTitle} selectedKey={status} onSelect={setStatus} />

      <BacklogBreakdownTable
        title={`${copy.byOwnerTitle} — ${report.assigneeLabel}`}
        keyLabel={report.assigneeLabel}
        rows={report.byOwner}
        selectedKey={owner}
        onSelect={setOwner}
        showWorkCategoryMix={report.hasWorkCategorySplit}
      />

      {/* ==================================================== OLDEST / STALE */}
      <BacklogOpenTicketsTable rows={report.oldestTickets} assigneeLabel={report.assigneeLabel} jiraBaseUrl={jiraBaseUrl} title={copy.oldestTicketsTitle} emptyLabel="No open backlog." />

      {report.staleTickets.length > 0 && (
        <BacklogOpenTicketsTable
          rows={report.staleTickets}
          assigneeLabel={report.assigneeLabel}
          jiraBaseUrl={jiraBaseUrl}
          title={`${copy.staleTitle} (${formatNumber(report.staleTotalCount)} total)`}
          emptyLabel="No stalled tickets."
        />
      )}

      {/* ============================================================= DETAILS */}
      <BacklogOpenTicketsTable
        rows={report.tickets}
        assigneeLabel={report.assigneeLabel}
        jiraBaseUrl={jiraBaseUrl}
        title={copy.ticketDetailsTitle}
        searchable
        totalCount={report.ticketsTotalCount}
        ownerFilter={owner}
        categoryFilter={category}
        issueTypeFilter={issueType}
        statusFilter={status}
        bucketFilter={bucket}
        distribution={report.ageDistribution}
        onClearFilters={hasFilter ? clearFilters : undefined}
      />
    </div>
  );
}
