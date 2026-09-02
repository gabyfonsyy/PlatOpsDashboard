import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getP1SlaReport, P1_PRIORITY_VALUE } from "@/lib/p1-sla";
import { slaStatusForRate, STATUS_LABEL, STATUS_TONE } from "@/lib/sla-status";
import { resolveFilters } from "@/lib/date-ranges";
import { formatPercent, formatNumber, formatMinutesDecimalValue, formatDurationBreakdown } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CountRankTable } from "@/components/dashboard/BreakdownTables";
import { SlaTrendChart } from "@/components/dashboard/SlaTrendChart";
import { P1InsightsPanel } from "@/components/dashboard/P1InsightsPanel";
import { P1ControllabilityBreakdown } from "@/components/dashboard/P1ControllabilityBreakdown";
import { P1ProblemAreaTable } from "@/components/dashboard/P1ProblemAreaTable";
import { P1PatternsTable } from "@/components/dashboard/P1PatternsTable";
import { P1AtRiskTable } from "@/components/dashboard/P1AtRiskTable";
import { P1TicketsTable } from "@/components/dashboard/P1TicketsTable";

/** MetricCard's `trend` prop from a fraction delta, framed in percentage points. `higherIsBetter`
 * decides whether a rise reads green or red — a rising on-time rate is good, a rising overdue
 * count is not. */
function ppTrend(deltaPp: number | null, higherIsBetter: boolean) {
  if (deltaPp === null || Math.abs(deltaPp) < 0.005) return undefined;
  const points = Math.round(deltaPp * 1000) / 10;
  return {
    direction: (deltaPp > 0 ? "up" : "down") as "up" | "down",
    label: `${points > 0 ? "+" : ""}${points}pp vs previous period`,
    positive: deltaPp > 0 ? higherIsBetter : !higherIsBetter,
  };
}

/** Same, but for a relative % delta (volume, resolution time) rather than a rate already in pp. */
function pctTrend(deltaPct: number | null, higherIsBetter: boolean) {
  if (deltaPct === null || Math.abs(deltaPct) < 0.005) return undefined;
  const pct = Math.round(deltaPct * 1000) / 10;
  return {
    direction: (deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${pct > 0 ? "+" : ""}${pct}% vs previous period`,
    positive: deltaPct > 0 ? higherIsBetter : !higherIsBetter,
  };
}

export default async function P1SlaPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_p1_sla_tracking) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const report = await getP1SlaReport(team.team_key, range, period, issueType);

  const issueTypes = team.issue_types_csv ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  const status = slaStatusForRate(report.onTimeRate);
  const c = report.comparison;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link
            href={`/${team.team_key.toLowerCase()}?${query}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — P1 SLA Compliance</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Team performance, SLA health, and incident delay analysis. Priority = &ldquo;{P1_PRIORITY_VALUE}&rdquo;
            tickets created in the period — a ticket still open past its due date already counts as a miss; one
            still open but not yet due is excluded until its outcome is known.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      {/* ============================================================ PULSE */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          label="SLA Compliance"
          value={formatPercent(report.onTimeRate)}
          sublabel={`${formatNumber(report.onTimeCount)} of ${formatNumber(report.decided)} decided`}
          badge={status ? { label: STATUS_LABEL[status], tone: STATUS_TONE[status] } : undefined}
          trend={c ? ppTrend(c.onTimeRate.deltaPp, true) : undefined}
          tooltip="Resolved on/before due date ÷ (resolved + open-and-already-overdue) P1 tickets created in the period. Tickets still open and not yet due are excluded — their outcome isn't known yet. Healthy ≥95%, Watch ≥90%, At Risk ≥80%, Critical below."
        />
        <MetricCard
          label="P1 Volume"
          value={formatNumber(report.createdInPeriod)}
          sublabel={`${formatNumber(report.pendingCount)} still open, not yet due`}
          trend={c ? pctTrend(c.createdInPeriod.deltaPct, false) : undefined}
          tooltip="Every P1 (Very Urgent) ticket created in the period, regardless of whether it has resolved yet."
        />
        <MetricCard
          label="SLA Breaches"
          value={formatNumber(report.overdueCount)}
          sublabel={`of ${formatNumber(report.decided)} decided${report.avgDaysOverdue !== null ? ` · avg ${report.avgDaysOverdue}d late` : ""}`}
          tooltip="Resolved after the due date, or still open and already past it."
        />
        <MetricCard
          label="Avg Resolution"
          value={formatMinutesDecimalValue(report.avgResolutionMinutes)}
          sublabel={formatDurationBreakdown(report.avgResolutionMinutes)}
          trend={c ? pctTrend(c.avgResolutionMinutes.deltaPct, false) : undefined}
          tooltip="Mean time from creation to resolution across P1s created in the period that have resolved so far. A few very slow tickets can pull this upward — read it next to Median."
        />
        <MetricCard
          label="Median Resolution"
          value={formatMinutesDecimalValue(report.medianResolutionMinutes)}
          sublabel={formatDurationBreakdown(report.medianResolutionMinutes)}
          trend={c ? pctTrend(c.medianResolutionMinutes.deltaPct, false) : undefined}
          tooltip="The midpoint P1's resolution time — usually the fairer read of a typical P1, since a handful of very slow tickets can't drag it around the way they drag the average."
        />
        <MetricCard
          label="Delay Involves Another Team"
          value={formatPercent(report.crossTeamDelayRate)}
          sublabel={`${formatNumber(report.crossTeamDelayCount)} of ${formatNumber(report.overdueCount)} overdue`}
          tooltip={`Of the overdue P1 tickets, how many carry a real Ticket Escalation or a holding reason naming a dependency on another team ("Platform Operations dependency", "L3 Support dependency", "Security Operations dependency"). See Is the Delay Within the Team's Control? below.`}
        />
      </div>

      <P1InsightsPanel insights={report.insights} positiveHighlights={report.positiveHighlights} />

      {/* ============================================================ TREND */}
      <SlaTrendChart trend={report.trend} />

      {/* ================================================================ WHY */}
      <div>
        <h2 className="mb-3">Why Are We Missing SLA?</h2>
        <div className="flex flex-col gap-4">
          <P1ControllabilityBreakdown controllability={report.controllability} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CountRankTable
              title="Why Overdue P1s Stalled"
              keyLabel="Holding Reason"
              rows={report.byHoldingReason}
              countLabel="Holds"
              emptyMessage="No holding reasons recorded on overdue P1 tickets this period."
            />
            <CountRankTable
              title="Escalated To"
              keyLabel="Team"
              rows={report.byEscalationTarget}
              emptyMessage="No overdue P1 tickets were escalated this period."
            />
          </div>
          <CountRankTable
            title="Most Frequent Label — Overdue P1 Tickets"
            keyLabel="Label"
            rows={report.byLabel}
            description="Triage/alerting bookkeeping labels (p1-alerted, jira_escalated, ffup-1, ffup-2, autoclose-nonresponse, crf, update-companypolicy, expedite, acc-d1se, decode, routed-secops, triage-complete, detailing-revisit, triage-round-1, triage-round-2) are excluded — they tag process, not subject matter."
            emptyMessage="No labels on overdue P1 tickets this period."
          />
        </div>
      </div>

      {/* ============================================================== WHERE */}
      <div>
        <h2 className="mb-3">Where Are We Seeing the Most Issues?</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <P1ProblemAreaTable title="By Product" keyLabel="Product" rows={report.byProduct} />
          <P1ProblemAreaTable title="By Issue Type" keyLabel="Issue Type" rows={report.byIssueType} />
          <P1ProblemAreaTable title={`By ${report.assigneeLabel}`} keyLabel={report.assigneeLabel} rows={report.byAssignee} />
        </div>
        <div className="mt-4">
          <P1PatternsTable rows={report.patterns} />
        </div>
      </div>

      {/* =============================================================== ACTION */}
      <div>
        <h2 className="mb-3">What Needs Attention Now?</h2>
        <P1AtRiskTable tickets={report.atRisk} assigneeLabel={report.assigneeLabel} jiraBaseUrl={process.env.JIRA_BASE_URL} />
      </div>

      {/* =============================================================== DETAILS */}
      <P1TicketsTable
        tickets={report.tickets}
        assigneeLabel={report.assigneeLabel}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
        totalCount={report.ticketsTotalCount}
      />
    </div>
  );
}
