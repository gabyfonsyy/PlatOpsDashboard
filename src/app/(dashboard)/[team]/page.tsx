import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTeamByKey, backlogAgingAssigneeLabel } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getTicketMetrics, getInsight } from "@/lib/metrics";
import { getAutomatedScorecard } from "@/lib/automated-tickets";
import { getFcrScorecard } from "@/lib/fcr";
import { getTicketOutcomeCards, outcomeDef } from "@/lib/ticket-outcomes";
import { getP1SlaReport } from "@/lib/p1-sla";
import { slaStatusForRate, STATUS_LABEL, STATUS_TONE } from "@/lib/sla-status";
import { AUTOMATION_LABELS_COOKIE, AUTOMATION_INCLUDE_BLANK_COOKIE, resolveAutomationLabels, resolveIncludeBlank } from "@/lib/automation-labels";
import { resolveFilters, shiftPeriod } from "@/lib/date-ranges";
import { vsPreviousTrend } from "@/lib/period-trend";
import { getKpiBaselines, baselineTrend } from "@/lib/kpi-baselines";
import { getReviewWaitScorecard } from "@/lib/review-wait";
import { REVIEW_TARGET_COOKIE, parseReviewTargetCookie, fmtDur } from "@/lib/review-wait-view";
import {
  formatMinutesDecimalValue,
  formatDaysValue,
  formatDaysValueCeil,
  formatDurationBreakdown,
  formatDurationBreakdownWithSeconds,
  formatPercent,
  formatNumber,
} from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { KpiBaselineControl } from "@/components/dashboard/KpiBaselineControl";
import { MetricsSeriesChart } from "@/components/dashboard/MetricsSeriesChart";
import { DistributionChart } from "@/components/dashboard/DistributionChart";
import { InsightPanel } from "@/components/dashboard/InsightPanel";
import { OutcomeCard } from "@/components/dashboard/OutcomeCard";
import { TicketOutcomesSectionIntro } from "@/components/dashboard/TicketOutcomesCopy";

export default async function TeamDashboardPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);

  // Automated tickets are defined on the Assigned SE field, so the card only exists for teams
  // that own their tickets through it (SE/ST). Skipped entirely elsewhere rather than fetched and
  // hidden — a team without the field has nothing to count.
  const hasAssignedSe = backlogAgingAssigneeLabel(team) === "Assigned SE";
  // The same cookie the drill-down reads, so the card counts the population she configured there
  // rather than the built-in default. Without this the card and the page it links to disagree the
  // moment she edits the automation-label catalogue.
  const automationLabels = resolveAutomationLabels(cookies().get(AUTOMATION_LABELS_COOKIE)?.value);
  const includeBlankSe = resolveIncludeBlank(cookies().get(AUTOMATION_INCLUDE_BLANK_COOKIE)?.value);
  // The previous period of the same length, for each card's "vs previous period" line.
  const prevPeriod = shiftPeriod(range, period, -1);
  const [metrics, insight, automated, p1Sla, outcomeCards, baselines, prevMetrics, fcr] = await Promise.all([
    getTicketMetrics(team.team_key, range, period, issueType),
    getInsight(`TEAM:${team.team_key}`),
    hasAssignedSe
      ? getAutomatedScorecard(team.team_key, range, period, issueType, automationLabels, includeBlankSe)
      : Promise.resolve(null),
    team.has_p1_sla_tracking ? getP1SlaReport(team.team_key, range, period, issueType) : Promise.resolve(null),
    getTicketOutcomeCards(team.team_key, range, period, issueType),
    getKpiBaselines(team.team_key),
    getTicketMetrics(team.team_key, range, prevPeriod, issueType),
    // Same population as the FCR deep-dive (lib/fcr.ts), not GAS metrics_daily — blank FCR values
    // are excluded there and the card must agree with the page it links to.
    team.has_fcr_escalation ? getFcrScorecard(team.team_key, range, period, issueType) : Promise.resolve(null),
  ]);
  // Same population + target as the Review Wait deep-dive it links to (lib/review-wait.ts), not the
  // GAS metrics_daily.peer_review_wait_* columns (bucketed by ticket created date, older exit rule).
  // Needs the baselines for the target, so it runs after the batch above rather than inside it.
  const reviewWait = team.has_peer_review_tracking
    ? await getReviewWaitScorecard(team.team_key, range, period, {
        issueType,
        baseline: baselines.review_wait,
        targetOverrideMinutes: parseReviewTargetCookie(cookies().get(REVIEW_TARGET_COOKIE)?.value),
      })
    : null;
  const baselineComputedAt = baselines.lead_time?.computed_at ?? null;

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // Carried onto every scorecard drill-down so each opens on the same period the card was read on.
  const filterQuery = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>{teamLabel(team.team_name)}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Jira project <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">{team.jira_project_key}</code>{" "}
            · <Link href={`/${team.team_key.toLowerCase()}/performance`} className="text-sprout-600 hover:underline">
              View performance breakdown
            </Link>
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <KpiBaselineControl computedAt={baselineComputedAt} />

      <InsightPanel insight={insight} scope={`TEAM:${team.team_key}`} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Ticket Volume"
          value={formatNumber(metrics.ticketsCreated)}
          sublabel={`${formatNumber(metrics.ticketsResolvedInPeriod)} resolved`}
          trend={vsPreviousTrend(metrics.ticketsCreated, prevMetrics.ticketsCreated, { better: "neutral" })}
          baseline={{ label: `Previous period: ${formatNumber(prevMetrics.ticketsCreated)} created` }}
          tooltip={
            team.has_peer_review_tracking
              ? "Total tickets created during the selected period. The sublabel shows how many tickets were resolved during the period (by resolved date)."
              : "Total tickets created during the selected period. The sublabel shows how many tickets were resolved during the period — moved to Ready for Checking or Cancelled (by resolved date)."
          }
        />
        <MetricCard
          label="Lead Time"
          value={formatDaysValue(metrics.leadTimeAvgMinutes)}
          sublabel={formatDurationBreakdown(metrics.leadTimeAvgMinutes)}
          tooltip={
            team.has_peer_review_tracking
              ? "Average time from ticket creation to resolution, across all tickets resolved in the period. Shown in days; the subnote breaks the same value down into days/hours/minutes. Click through for the deep-dive (top assignee/product/label, longest tickets)."
              : "Average time from ticket creation until it moved to Ready for Checking or Cancelled, across all tickets resolved in the period. Shown in days; the subnote breaks the same value down into days/hours/minutes. Click through for the deep-dive (top assignee/product/label, longest tickets)."
          }
          href={`/${team.team_key.toLowerCase()}/lead-cycle-time?${filterQuery}&metric=lead`}
          trend={vsPreviousTrend(metrics.leadTimeAvgMinutes, prevMetrics.leadTimeAvgMinutes, { better: "lower" })}
          baseline={baselineLabel(baselineTrend(metrics.leadTimeAvgMinutes, baselines.lead_time, { lowerIsBetter: true, formatValue: formatDaysValue }))}
        />
        <MetricCard
          label="Cycle Time"
          value={formatDaysValueCeil(metrics.cycleTimeAvgMinutes)}
          sublabel={formatDurationBreakdownWithSeconds(metrics.cycleTimeAvgMinutes)}
          tooltip={
            team.has_peer_review_tracking
              ? "Average actual-work time (out of Backlog/To Do to reaching review) plus average peer-review time, counted independent of resolution. Shown in days, rounded up to 2 decimals. Click through for the actual-work and peer-review averages as separate values."
              : "Average time from when the ticket moved out of Backlog/To Do until it moved to Ready for Checking or Cancelled, across tickets resolved in the period. Shown in days, rounded up to 2 decimals. Click through for the deep-dive (top assignee/product/label, longest tickets)."
          }
          href={`/${team.team_key.toLowerCase()}/lead-cycle-time?${filterQuery}&metric=cycle`}
          trend={vsPreviousTrend(metrics.cycleTimeAvgMinutes, prevMetrics.cycleTimeAvgMinutes, { better: "lower" })}
          baseline={baselineLabel(baselineTrend(metrics.cycleTimeAvgMinutes, baselines.cycle_time_total, { lowerIsBetter: true, formatValue: formatDaysValueCeil }))}
        />
        {team.has_peer_review_tracking && (
          <MetricCard
            label="Review Wait Time"
            value={formatDaysValue(reviewWait?.stats.avgMinutes ?? null)}
            sublabel={
              reviewWait && reviewWait.stats.avgMinutes !== null
                ? `${fmtDur(reviewWait.stats.avgMinutes)} avg · median ${fmtDur(reviewWait.stats.medianMinutes)}${reviewWait.stats.p90Minutes !== null ? ` · P90 ${fmtDur(reviewWait.stats.p90Minutes)}` : ""}`
                : undefined
            }
            tooltip="Average time a ticket sits in For Peer Review before moving to On Hold, For Checking, Archived or Rejected, per review cycle that started in the period (pass-throughs under a minute aren't counted). Shown in days; calendar time, same basis as Cycle Time. Click through for reviewer load, the review queue, the longest reviews and what's driving them."
            href={`/${team.team_key.toLowerCase()}/review-wait?${filterQuery}`}
            trend={vsPreviousTrend(reviewWait?.stats.avgMinutes, reviewWait?.comparison?.previousAvgMinutes, { better: "lower" })}
            baseline={
              reviewWait?.stats.withinTargetPct != null && reviewWait.target.minutes !== null
                ? { label: `${formatPercent(reviewWait.stats.withinTargetPct, 0)} within ${fmtDur(reviewWait.target.minutes)} target` }
                : undefined
            }
          />
        )}
        <MetricCard
          label="Backlog Aging"
          value={formatPercent(metrics.backlogAgingRate, 2)}
          sublabel={`${formatNumber(metrics.overdueCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved overdue`}
          tooltip={
            team.has_peer_review_tracking
              ? "Overdue tickets ÷ total tickets resolved in the period, excluding Technical Story (internal engineering work, whose due dates are self-imposed). Overdue = resolved after the due date (resolved date > due date). Click through for the ticket-by-ticket list."
              : "Overdue tickets ÷ total tickets resolved (moved to Ready for Checking or Cancelled) in the period. Overdue = resolved after the due date (resolved date > due date). Click through for the ticket-by-ticket list."
          }
          href={`/${team.team_key.toLowerCase()}/backlog-aging?${filterQuery}`}
          trend={vsPreviousTrend(metrics.backlogAgingRate, prevMetrics.backlogAgingRate, { better: "lower", mode: "pts" })}
          baseline={baselineLabel(baselineTrend(metrics.backlogAgingRate, baselines.ageing_rate, { lowerIsBetter: true, formatValue: (v) => formatPercent(v, 2) }))}
        />
        {automated && (
          <MetricCard
            label="Automated Tickets"
            value={formatPercent(automated.automatedShare)}
            sublabel={`${formatNumber(automated.automatedCount)} of ${formatNumber(automated.resolvedInPeriod)} resolved${automated.includeBlank ? " · incl. blank SE" : ""}`}
            trend={vsPreviousTrend(automated.automatedShare, automated.previous?.automatedShare, { better: "higher", mode: "pts" })}
            baseline={baselineLabel(
              baselineTrend(
                automated.automatedShare,
                // With blank SE included, the stored (default-definition) baseline would compare a
                // different population — use the live one computed under the same rule instead.
                automated.liveBaseline
                  ? { team_key: team.team_key, metric: "automated_share", value: automated.liveBaseline.value, sample_count: automated.liveBaseline.sampleCount, period_label: "2026-Q1+Q2", computed_at: "" }
                  : baselines.automated_share,
                { lowerIsBetter: false, formatValue: (v) => formatPercent(v) }
              )
            )}
            tooltip="Share of tickets resolved in the period that automation handled: Assigned SE is the automation account, or the ticket carries one of your catalogued automation labels. A blank Assigned SE no longer counts — those are tagging gaps, listed under Data quality on the drill-down. Archived and Rejected automated tickets are left out of the count but every resolved ticket stays in the denominator. Higher is better. Click through for trends, automated vs manual, and the ticket list."
            href={`/${team.team_key.toLowerCase()}/automated?${filterQuery}`}
          />
        )}
        {team.has_fcr_escalation && (
          <>
            <MetricCard
              label="FCR Rate"
              value={formatPercent(fcr ? fcr.current.rate : metrics.fcrRate)}
              sublabel={
                fcr
                  ? `${formatNumber(fcr.current.fcr)} / ${formatNumber(fcr.current.resolved)} resolved on first contact${fcr.smallSample ? " · Small sample" : ""}`
                  : `${formatNumber(metrics.fcrYesCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved FCR = Yes`
              }
              tooltip="Tickets marked FCR = Yes ÷ tickets resolved in the period with FCR = Yes or No (by resolved date). A blank FCR value is left out of both sides. The change is in percentage points vs the previous period. Click through for what drives it and where the follow-up work comes from."
              href={`/${team.team_key.toLowerCase()}/fcr?${filterQuery}`}
              trend={fcr ? vsPreviousTrend(fcr.current.rate, fcr.previous?.rate, { better: "higher", mode: "pts" }) : undefined}
              baseline={
                fcr
                  ? {
                      label: [
                        fcr.previous ? `Previous period: ${formatPercent(fcr.previous.rate)}` : null,
                        baselines.fcr_rate?.value != null ? `Baseline (${baselines.fcr_rate.period_label}): ${formatPercent(Number(baselines.fcr_rate.value))}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    }
                  : baselineLabel(baselineTrend(metrics.fcrRate, baselines.fcr_rate, { lowerIsBetter: false, formatValue: (v) => formatPercent(v) }))
              }
              badge={fcr?.smallSample ? { label: "Small sample", tone: "warning" } : undefined}
            />
            <MetricCard
              label="Escalation Rate"
              value={formatPercent(metrics.escalationRate)}
              sublabel={`${formatNumber(metrics.escalationCount)} of ${formatNumber(metrics.ticketsResolvedInPeriod)} resolved escalated`}
              tooltip="Tickets whose Ticket Escalation is set to something other than N/A, CA, SE, or blank ÷ total tickets resolved in the period. Click through for where the work went, counted per receiving team."
              href={`/${team.team_key.toLowerCase()}/escalation?${filterQuery}`}
            />
          </>
        )}
        {team.has_p1_sla_tracking && p1Sla && (
          <MetricCard
            label="P1 SLA Compliance"
            value={formatPercent(p1Sla.onTimeRate)}
            sublabel={`${formatNumber(p1Sla.onTimeCount)} of ${formatNumber(p1Sla.decided)} decided`}
            badge={
              (() => {
                const status = slaStatusForRate(p1Sla.onTimeRate);
                return status ? { label: STATUS_LABEL[status], tone: STATUS_TONE[status] } : undefined;
              })()
            }
            tooltip={`P1 (Very Urgent) tickets created in the period, resolved on/before due date ÷ (resolved + open-and-already-overdue). Filtered by CREATE date, not resolved date — a ticket still open and not yet due is excluded until its outcome is known. Click through for the full pulse: trend, why tickets overdue, where the problems concentrate, and which open P1s are at risk right now.`}
            href={`/${team.team_key.toLowerCase()}/p1-sla?${filterQuery}`}
          />
        )}
        {team.has_holding_reason && (
          <MetricCard
            label="Avg. On-Hold Pickup Time"
            value={formatMinutesDecimalValue(metrics.onHoldAvgPickupMinutes)}
            sublabel={formatDurationBreakdown(metrics.onHoldAvgPickupMinutes)}
            tooltip="Average total time tickets spent On Hold, across tickets placed on hold at least once. Click through for holding reasons and the longest holds."
            href={`/${team.team_key.toLowerCase()}/on-hold?${filterQuery}`}
          />
        )}
      </div>

      {outcomeCards.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-neutral-900">Ticket Outcomes</h2>
          <TicketOutcomesSectionIntro />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
            {outcomeCards.map((card) => {
              const def = outcomeDef(card.outcome);
              return (
                <OutcomeCard
                  key={card.outcome}
                  label={def.cardLabel}
                  outcome={card.outcome}
                  value={formatNumber(card.count)}
                  sublabel={
                    card.resolvedInPeriod
                      ? `${formatPercent(card.share)} of ${formatNumber(card.resolvedInPeriod)} resolved`
                      : undefined
                  }
                  tooltip={`Tickets resolved in the period whose status is ${def.statusLabel}, divided by every ticket ${teamLabel(team.team_name)} resolved in the period. Click through for the ${def.reasonLabel.toLowerCase()} breakdown and the ticket list.`}
                  href={`/${team.team_key.toLowerCase()}/${card.outcome}?${filterQuery}`}
                  breakdown={card.byReason}
                />
              );
            })}
          </div>
        </div>
      )}

      <MetricsSeriesChart series={metrics.series} />

      {team.has_holding_reason && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DistributionChart title="Ticket Holding Reasons" data={metrics.holdingReasonBreakdown} labelKey="reason" />
        </div>
      )}
    </div>
  );
}

/**
 * Lead/Cycle/Ageing used to put the Q1+Q2 baseline comparison in the card's coloured `trend` slot.
 * That slot now carries "vs previous period" (like Review Wait Time), so the baseline comparison —
 * same text, including its % difference — moves to the quiet second line underneath.
 */
function baselineLabel(t: ReturnType<typeof baselineTrend>): { label: string } | undefined {
  return t ? { label: t.label } : undefined;
}
