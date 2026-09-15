import {
  getWatchtowerReport,
  getPerformanceReport,
  getSeEfficiencyReport,
  getToolingImpactReport,
  getSePatternsReport,
  getTicketReceiptsReport,
  getCycleTimeDiagnosticsReport,
  getSeCycleRoleReport,
  getAccountCreationBottlenecksReport,
} from "@/lib/account-creation-report";
import type { OverallSlaStatus, DataUnavailable } from "@/lib/account-creation-sla";
import type { DelayArea } from "@/lib/account-creation-cycle";
import { DELAY_AREA_META } from "@/lib/account-creation-view";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable } from "@/components/dashboard/BreakdownTables";
import { AccountCreationWatchtowerBoard } from "@/components/dashboard/AccountCreationWatchtowerBoard";
import { AccountCreationDistributionTable } from "@/components/dashboard/AccountCreationDistributionTable";
import { AccountCreationDoerValidatorTable } from "@/components/dashboard/AccountCreationDoerValidatorTable";
import { AccountCreationCycleDistributionTable } from "@/components/dashboard/AccountCreationCycleDistributionTable";
import { AccountCreationSeCycleRoleTable } from "@/components/dashboard/AccountCreationSeCycleRoleTable";
import { AccountCreationBottlenecksTable } from "@/components/dashboard/AccountCreationBottlenecksTable";
import { AccountCreationToolingTable } from "@/components/dashboard/AccountCreationToolingTable";
import { AccountCreationSeTable } from "@/components/dashboard/AccountCreationSeTable";
import { AccountCreationReceiptsTable } from "@/components/dashboard/AccountCreationReceiptsTable";
import { formatPercent, formatDaysValue, formatDurationBreakdown, formatNumber } from "@/lib/format";

/**
 * Account Creation SLA control tower (ST/SE) — Phase 1: everything reusing already-synced data
 * (Day 1 start/setup, SE Cycle Time, tool-assisted comparison, workload/pattern analytics) plus a
 * Day-1-only Watchtower. L3 Endorsement/Day 2/Day 3 show "Data unavailable" honestly until Phase 2
 * (a new Jira linked-ticket sync, not built yet) lands — see lib/account-creation-sla.ts's top
 * comment. Route renamed from /monitoring/late-pickup to /monitoring/account-creation (the old
 * name predated the feature's own rename to "Account Creation Review"); late-pickup.ts/
 * LatePickupTable.tsx are gone — this supersedes them, not sits alongside them.
 */
export default async function AccountCreationPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { range, period } = resolveFilters(searchParams);
  const overallStatusFilter = typeof searchParams.overallStatus === "string" ? (searchParams.overallStatus as OverallSlaStatus | DataUnavailable) : undefined;

  const [watchtower, performance, efficiency, tooling, patterns, receipts, cycleDiagnostics, seCycleRoles, bottlenecks] = await Promise.all([
    getWatchtowerReport(range, period),
    getPerformanceReport(range, period),
    getSeEfficiencyReport(range, period),
    getToolingImpactReport(range, period),
    getSePatternsReport(range, period),
    getTicketReceiptsReport(range, period, { overallStatus: overallStatusFilter }),
    getCycleTimeDiagnosticsReport(range, period),
    getSeCycleRoleReport(range, period),
    getAccountCreationBottlenecksReport(range, period),
  ]);

  const jiraBaseUrl = process.env.JIRA_BASE_URL;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>Account Creation Review</h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-3xl">
            SLA monitoring and accountability for ST Account Creation tickets — Day 1 setup, SE Cycle Time, tool-assisted
            comparison, and SE patterns. L3 Endorsement/Realm Creation/Data Loading milestones show &quot;Data unavailable&quot;
            until the L3-linkage data pipeline (Phase 2) lands — never a fabricated status.
          </p>
        </div>
        <FilterBar />
      </div>

      {/* 1. Watchtower — current operational state */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Active Account Creation Tickets" value={formatNumber(watchtower.activeCount)} />
        <MetricCard
          label="🟢 On Track"
          value={formatNumber(watchtower.counts.on_track)}
          href={`?overallStatus=on_track#receipts`}
        />
        <MetricCard
          label="🟡 At Risk"
          value={formatNumber(watchtower.counts.at_risk)}
          href={`?overallStatus=at_risk#receipts`}
        />
        <MetricCard
          label="🔴 Breached"
          value={formatNumber(watchtower.counts.breached)}
          href={`?overallStatus=breached#receipts`}
        />
        <MetricCard
          label="⏱ Day 1 Not Started"
          value={formatNumber(watchtower.day1NotStartedCount)}
          tooltip="Assigned SE has not moved the ticket into In Progress by the expected Day 1."
        />
        <MetricCard
          label="👤 SE Start Compliance"
          value={formatPercent(watchtower.seStartComplianceRate)}
          tooltip="Share of active tickets where the assigned SE started on the expected Day 1."
        />
        <MetricCard
          label="L3 Endorsement Compliance"
          value="—"
          tooltip="Not yet trackable — needs the L3-linkage data pipeline (Phase 2)."
        />
        <MetricCard
          label="Data Loading Compliance"
          value="—"
          tooltip="Not yet trackable — needs the L3-linkage data pipeline (Phase 2)."
        />
      </div>

      <AccountCreationWatchtowerBoard tickets={watchtower.tickets} jiraBaseUrl={jiraBaseUrl} />

      {/* 2. Performance — historical actual-vs-expected */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Actual SLA — Day 1 SE Setup"
          value={formatPercent(performance.day1SeSetup.complianceRate)}
          sublabel={`${formatNumber(performance.day1SeSetup.withinSla)} / ${formatNumber(performance.day1SeSetup.total)} within SLA`}
          tooltip="Expected SLA vs Observed Performance for the Day 1 SE Setup stage, over tickets whose Day 1 stage reached a real end state (completed or late) in the period."
        />
        <MetricCard label="L3 Endorsement" value="—" tooltip="Not yet trackable (Phase 2)." />
        <MetricCard label="L3 Completion" value="—" tooltip="Not yet trackable (Phase 2)." />
        <MetricCard label="Data Loading" value="—" tooltip="Not yet trackable (Phase 2)." />
      </div>

      <CountRankTable
        title="Day 1 SE Setup — Actual vs Expected"
        keyLabel="Outcome"
        countLabel="Tickets"
        rows={[
          { key: "Within SLA", count: performance.day1SeSetup.withinSla, share: performance.day1SeSetup.total ? performance.day1SeSetup.withinSla / performance.day1SeSetup.total : null },
          { key: "Late", count: performance.day1SeSetup.late, share: performance.day1SeSetup.total ? performance.day1SeSetup.late / performance.day1SeSetup.total : null },
        ]}
        emptyMessage="No Day 1 stages reached completion or lateness in this period yet."
      />

      {/* 3. SE Efficiency */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Median SE Cycle Time"
          value={formatDaysValue(efficiency.doer.medianMinutes)}
          sublabel={[formatDurationBreakdown(efficiency.doer.medianMinutes), `${formatNumber(efficiency.doer.count)} tickets`].filter(Boolean).join(" · ")}
          tooltip="Doer time: To Do → For Peer Review, median across measurable tickets created in the period. See the Doer vs Validator table below for the reviewer's own time."
        />
        <MetricCard label="Average" value={formatDaysValue(efficiency.doer.avgMinutes)} sublabel={formatDurationBreakdown(efficiency.doer.avgMinutes)} />
        <MetricCard label="P75" value={formatDaysValue(efficiency.doer.p75Minutes)} />
        <MetricCard label="P90" value={formatDaysValue(efficiency.doer.p90Minutes)} />
      </div>

      <AccountCreationDoerValidatorTable doer={efficiency.doer} validator={efficiency.validator} combinedAvgMinutes={efficiency.combinedAvgMinutes} />

      <AccountCreationDistributionTable buckets={efficiency.distribution} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CountRankTable
          title="Cycle Time by Track Type"
          keyLabel="Track"
          countLabel="Tickets"
          rows={efficiency.byTrackType.map((r) => ({ key: r.trackType, count: r.stats.count, share: null }))}
          emptyMessage="No measurable cycle times."
        />
        <CountRankTable
          title="Cycle Time by 11 AM Cutoff"
          keyLabel="Created"
          countLabel="Tickets"
          rows={efficiency.byCutoffSide.map((r) => ({ key: r.cutoffSide === "before_11am" ? "Before 11 AM" : "At/after 11 AM", count: r.stats.count, share: null }))}
          emptyMessage="No measurable cycle times."
        />
      </div>

      {/* 3b. Cycle Time Diagnostics — SE execution vs. peer review breakdown */}
      <div>
        <h2 className="font-serif text-lg font-medium text-neutral-900">Cycle Time Diagnostics</h2>
        <p className="text-sm text-neutral-500 mt-0.5 max-w-3xl">
          Where the SE-owned stage actually loses time — In Progress → For Peer Review (SE execution) vs. For Peer Review →
          On Hold/For Checking (peer review). SE-side delay reuses the Day-1 SLA lateness rule above; review-side delay uses
          one new configurable threshold (2h) since no existing SLA covers review duration.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Avg Total Cycle Time"
          value={formatDaysValue(cycleDiagnostics.total.avgMinutes)}
          sublabel={[formatDurationBreakdown(cycleDiagnostics.total.avgMinutes), `${formatNumber(cycleDiagnostics.total.count)} tickets`].filter(Boolean).join(" · ")}
        />
        <MetricCard
          label="Avg SE Work Time"
          value={formatDaysValue(cycleDiagnostics.seWork.avgMinutes)}
          sublabel={formatDurationBreakdown(cycleDiagnostics.seWork.avgMinutes)}
        />
        <MetricCard
          label="Avg Review Time"
          value={formatDaysValue(cycleDiagnostics.review.avgMinutes)}
          sublabel={formatDurationBreakdown(cycleDiagnostics.review.avgMinutes)}
        />
        <MetricCard
          label="% Delayed in SE Work"
          value={formatPercent(cycleDiagnostics.pctDelayedSeWork)}
          tooltip="Reuses the existing Day-1 SLA lateness rule — share of measurable tickets where the SE-work stage missed it."
        />
        <MetricCard
          label="% Delayed in Review"
          value={formatPercent(cycleDiagnostics.pctDelayedReview)}
          tooltip="Share of measurable tickets whose peer-review time exceeded the 2h configurable threshold."
        />
      </div>

      <AccountCreationCycleDistributionTable
        seWorkDistribution={cycleDiagnostics.seWorkDistribution}
        reviewDistribution={cycleDiagnostics.reviewDistribution}
      />

      <CountRankTable
        title="Where Are Account Creations Getting Delayed?"
        keyLabel="Delay Area"
        countLabel="Tickets"
        rows={(Object.keys(cycleDiagnostics.delayCounts) as DelayArea[]).map((area) => {
          const total = Object.values(cycleDiagnostics.delayCounts).reduce((s, c) => s + c, 0);
          return {
            key: DELAY_AREA_META[area].label,
            count: cycleDiagnostics.delayCounts[area],
            share: total ? cycleDiagnostics.delayCounts[area] / total : null,
          };
        })}
        description="Never guessed from the total ticket duration — see 'Unable to Determine' for tickets missing SE-work or review history."
        emptyMessage="No Account Creation tickets in this period."
      />

      <AccountCreationSeCycleRoleTable asOriginalSe={seCycleRoles.asOriginalSe} asReviewer={seCycleRoles.asReviewer} />

      <AccountCreationBottlenecksTable rows={bottlenecks.rows} />

      {/* 4. Tooling Impact */}
      <AccountCreationToolingTable report={tooling} />

      {/* 5. SE Patterns */}
      <AccountCreationSeTable bySe={patterns.bySe} />
      <CountRankTable
        title="Delay Attribution"
        keyLabel="Side"
        countLabel="Tickets"
        rows={[
          { key: "SE-side (Day 1 setup late)", count: patterns.delayAttribution.seSideCount, share: null },
          { key: "Unknown / not yet trackable", count: patterns.delayAttribution.unknownCount, share: null },
        ]}
        description="L3-side attribution isn't trackable yet — needs the L3-linkage data pipeline (Phase 2)."
      />

      {/* 6. Ticket Receipts */}
      <AccountCreationReceiptsTable
        tickets={receipts.tickets}
        cycles={receipts.cycles}
        totalCount={receipts.totalCount}
        jiraBaseUrl={jiraBaseUrl}
        id="receipts"
      />
    </div>
  );
}
