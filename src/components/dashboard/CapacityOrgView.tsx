"use client";

import Link from "next/link";
import { useTheme } from "@/components/theme/ThemeProvider";
import { capacityCopy, SUSTAINABILITY_TIER_DESCRIPTION, MISSING_DIMENSIONS, buildTeamInterpretation, buildGabyRead, buildHeadcountCase, buildManagementBrief } from "@/lib/capacity-view";
import { CAPACITY_TIER_LABEL, CAPACITY_TIER_TONE, THREE_TIER_LABEL, THREE_TIER_TONE, CONFIDENCE_LABEL } from "@/lib/capacity-config";
import type { CapacityOverview, CapacityTrend } from "@/lib/capacity";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { CapacityTrendChart } from "@/components/dashboard/CapacityTrendChart";
import { CapacityScenarioPanel } from "@/components/dashboard/CapacityScenarioPanel";
import { CapacityManagementBrief } from "@/components/dashboard/CapacityManagementBrief";
import { teamLabel } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

function pct(p: number | null): string {
  return p === null ? "—" : `${Math.round(p * 100)}%`;
}

export function CapacityOrgView({ overview, trend }: { overview: CapacityOverview; trend: CapacityTrend }) {
  const { theme } = useTheme();
  const copy = capacityCopy(theme);

  const headcountCase = buildHeadcountCase(overview, trend);
  const gabyRead = buildGabyRead(overview);
  const dateLabel = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const briefText = buildManagementBrief(overview, trend, headcountCase, dateLabel);

  return (
    <div className="flex flex-col gap-6">
      {/* Section 3 — Platform Operations Capacity */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard label={copy.headcountLabel} value={formatNumber(overview.headcount)} sublabel="People across SE / DBA / DevOps" />
        <MetricCard
          label={copy.availableLabel}
          value={pct(overview.availablePct)}
          sublabel="Working days minus approved leave and an assumed overhead share"
          tooltip="Available Capacity = working days in the period, minus Approved leave, minus an operational-overhead assumption (lib/capacity-config.ts — no meeting/admin data exists to measure this directly)."
        />
        <MetricCard
          label={copy.demandLabel}
          value={pct(overview.demandPct)}
          sublabel="Estimated workload demand"
          tooltip="Demand = this period's resolved-ticket volume, converted to days at this team's own trailing 3-month tickets-per-available-day pace, plus an assumed per-project day cost for active projects. Doesn't separately count time still being spent on open, unresolved tickets."
        />
        <MetricCard
          label={copy.gapLabel}
          value={pct(overview.gapPct)}
          sublabel={(overview.gapPct ?? 0) >= 0 ? "Available capacity exceeds demand" : "Demand exceeds sustainable capacity"}
          badge={{ label: CAPACITY_TIER_LABEL[overview.tier], tone: CAPACITY_TIER_TONE[overview.tier] }}
        />
        <MetricCard label={copy.sustainabilityLabel} value={CAPACITY_TIER_LABEL[overview.tier].replace(/^[^\s]+\s/, "")} sublabel={SUSTAINABILITY_TIER_DESCRIPTION[overview.tier]} />
        <MetricCard
          label={copy.projectCapacityLabel}
          value={THREE_TIER_LABEL[overview.projectCapacityTier]}
          sublabel={overview.projectCapacityTier === "low" ? "Limited room for additional project commitments" : overview.projectCapacityTier === "medium" ? "Some room, evaluate case by case" : "Meaningful room for additional project commitments"}
        />
      </div>

      {/* Gaby's Read (§13) */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900">{copy.gabyReadTitle}</h2>
        <ul className="mt-2 space-y-1.5">
          {gabyRead.map((line, i) => (
            <li key={i} className="text-sm text-neutral-700">
              {line}
            </li>
          ))}
        </ul>
      </div>

      {/* Team Comparison (§4) */}
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">{copy.teamComparisonTitle}</div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Team</th>
              <th className="px-4 py-2">HC</th>
              <th className="px-4 py-2">Demand</th>
              <th className="px-4 py-2">Capacity</th>
              <th className="px-4 py-2">Gap</th>
              <th className="px-4 py-2">Backlog</th>
              <th className="px-4 py-2">Project Load</th>
              <th className="px-4 py-2">Sustainability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {overview.teams.map((t) => (
              <tr key={t.teamKey}>
                <td className="px-4 py-2 font-medium text-neutral-900">
                  <Link href={`/${t.teamKey.toLowerCase()}/capacity`} className="hover:underline">
                    {teamLabel(t.teamName)}
                  </Link>
                </td>
                <td className="px-4 py-2">{t.headcount}</td>
                <td className="px-4 py-2">{pct(t.demandPct)}</td>
                <td className="px-4 py-2">{pct(t.availablePct)}</td>
                <td className="px-4 py-2">{pct(t.gapPct)}</td>
                <td className="px-4 py-2">
                  <Badge tone={THREE_TIER_TONE[t.backlogTier]}>{THREE_TIER_LABEL[t.backlogTier]}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={THREE_TIER_TONE[t.projectLoadTier]}>{THREE_TIER_LABEL[t.projectLoadTier]}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={CAPACITY_TIER_TONE[t.tier]}>{CAPACITY_TIER_LABEL[t.tier]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Capacity Interpretation (§5) */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900">{copy.interpretationTitle}</h2>
        <div className="mt-3 space-y-4">
          {overview.teams.map((t) => (
            <div key={t.teamKey}>
              <p className="text-sm font-medium text-neutral-900">{teamLabel(t.teamName)}</p>
              <p className="text-sm text-neutral-600 mt-0.5">{buildTeamInterpretation(t)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Can We Take On More? (§6) */}
      <CapacityScenarioPanel
        title={copy.scenarioTitle}
        baseline={{
          availableDays: overview.availableDays,
          demandDays: overview.demandDays,
          nominalDays: overview.nominalDays,
          avgAvailableDaysPerHeadcount: overview.avgAvailableDaysPerHeadcount,
          avgNominalDaysPerHeadcount: overview.avgNominalDaysPerHeadcount,
        }}
      />

      {/* Trend (§10) */}
      <CapacityTrendChart points={trend.points} consecutiveWeeksOverThreshold={trend.consecutiveWeeksOverThreshold} title={copy.trendTitle} />

      {/* Headcount Case (§11) */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900">{copy.headcountCaseTitle}</h2>
        <p className="text-sm text-neutral-700 mt-2 font-medium">{headcountCase.recommendation}</p>

        {headcountCase.evidence.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Evidence</p>
            <ul className="mt-1 list-disc list-inside space-y-1">
              {headcountCase.evidence.map((e, i) => (
                <li key={i} className="text-sm text-neutral-700">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {headcountCase.businessImpact.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Business Impact</p>
            <ul className="mt-1 list-disc list-inside space-y-1">
              {headcountCase.businessImpact.map((b, i) => (
                <li key={i} className="text-sm text-neutral-700">
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {headcountCase.options.map((o) => (
            <div key={o.key} className="rounded-lg border border-neutral-200 p-3">
              <p className="text-sm font-medium text-neutral-900">
                Option {o.key} — {o.title}
              </p>
              <p className="text-xs text-neutral-500 mt-1">{o.impact}</p>
            </div>
          ))}
        </div>
      </div>

      <CapacityManagementBrief title={copy.managementBriefTitle} text={briefText} />

      {/* Data Confidence + Insufficient Data (§14, §15) */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900">{copy.insufficientDataTitle}</h2>
        <p className="text-sm text-neutral-500 mt-1">
          This page reports only what it can compute from real data. The dimensions below aren&apos;t tracked anywhere in this app yet, so
          they&apos;re left out of the math rather than estimated.
        </p>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {MISSING_DIMENSIONS.map((d) => (
            <li key={d.key} className="text-sm text-neutral-600 flex items-start gap-2">
              <span className="text-neutral-300 mt-0.5">•</span>
              {d.label}
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-400 mt-4">
          {CONFIDENCE_LABEL.medium}: Capacity Gap is based on real ticket, leave, and headcount data, but Demand relies on a trailing
          3-month throughput baseline and an assumed per-project day cost — see each card&apos;s tooltip.
        </p>
      </div>
    </div>
  );
}
