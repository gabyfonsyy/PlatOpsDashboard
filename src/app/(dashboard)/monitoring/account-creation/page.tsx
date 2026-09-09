import {
  getWatchtowerReport,
  getPerformanceReport,
  getSeEfficiencyReport,
  getToolingImpactReport,
  getSePatternsReport,
  getTicketReceiptsReport,
} from "@/lib/account-creation-report";
import type { OverallSlaStatus, DataUnavailable } from "@/lib/account-creation-sla";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable } from "@/components/dashboard/BreakdownTables";
import { AccountCreationWatchtowerBoard } from "@/components/dashboard/AccountCreationWatchtowerBoard";
import { AccountCreationDistributionTable } from "@/components/dashboard/AccountCreationDistributionTable";
import { AccountCreationDoerValidatorTable } from "@/components/dashboard/AccountCreationDoerValidatorTable";
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

  const [watchtower, performance, efficiency, tooling, patterns, receipts] = await Promise.all([
    getWatchtowerReport(range, period),
    getPerformanceReport(range, period),
    getSeEfficiencyReport(range, period),
    getToolingImpactReport(range, period),
    getSePatternsReport(range, period),
    getTicketReceiptsReport(range, period, { overallStatus: overallStatusFilter }),
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
      <AccountCreationReceiptsTable tickets={receipts.tickets} totalCount={receipts.totalCount} jiraBaseUrl={jiraBaseUrl} id="receipts" />
    </div>
  );
}
