"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { capacityCopy, SUSTAINABILITY_TIER_DESCRIPTION, MISSING_DIMENSIONS, buildTeamInterpretation, buildPersonSustainability } from "@/lib/capacity-view";
import { CAPACITY_TIER_LABEL, CAPACITY_TIER_TONE, THREE_TIER_LABEL, THREE_TIER_TONE, CONFIDENCE_LABEL } from "@/lib/capacity-config";
import type { TeamCapacity, OwnershipRiskFlag } from "@/lib/capacity";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { formatNumber, formatMinutesDecimal } from "@/lib/format";

function pct(p: number | null): string {
  return p === null ? "—" : `${Math.round(p * 100)}%`;
}

const PERSON_LEVEL_TONE = { high: "danger", elevated: "warning", normal: "success" } as const;
const PERSON_LEVEL_LABEL = { high: "HIGH", elevated: "ELEVATED", normal: "NORMAL" } as const;

export function CapacityTeamView({ team, ownershipRisk }: { team: TeamCapacity; ownershipRisk: OwnershipRiskFlag[] }) {
  const { theme } = useTheme();
  const copy = capacityCopy(theme);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label={copy.headcountLabel} value={formatNumber(team.headcount)} />
        <MetricCard label={copy.availableLabel} value={pct(team.availablePct)} />
        <MetricCard label={copy.demandLabel} value={pct(team.demandPct)} />
        <MetricCard label={copy.gapLabel} value={pct(team.gapPct)} badge={{ label: CAPACITY_TIER_LABEL[team.tier], tone: CAPACITY_TIER_TONE[team.tier] }} />
      </div>

      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900">{copy.interpretationTitle}</h2>
        <p className="text-sm text-neutral-600 mt-2">{buildTeamInterpretation(team)}</p>
        <p className="text-xs text-neutral-400 mt-3">{SUSTAINABILITY_TIER_DESCRIPTION[team.tier]}</p>
      </div>

      {/* Individual drill-down (§7-§8) — inline expandable row, no per-person route in this app. */}
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">{copy.rosterTitle}</div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2" />
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Resolved (period)</th>
              <th className="px-4 py-2">Avg Cycle Time</th>
              <th className="px-4 py-2">Leave Days</th>
              <th className="px-4 py-2">Sustainability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {team.people.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                  No active roster members for this team.
                </td>
              </tr>
            )}
            {team.people.map((p) => {
              const isOpen = expanded === p.name;
              const sustainability = buildPersonSustainability(p);
              return (
                <Fragment key={p.name}>
                  <tr className="cursor-pointer hover:bg-neutral-50" onClick={() => setExpanded(isOpen ? null : p.name)}>
                    <td className="px-4 py-2 text-neutral-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                    <td className="px-4 py-2 font-medium text-neutral-900">{p.name}</td>
                    <td className="px-4 py-2 text-neutral-600">{p.roleTitle}</td>
                    <td className="px-4 py-2">{formatNumber(p.ticketsResolvedInPeriod)}</td>
                    <td className="px-4 py-2">{formatMinutesDecimal(p.avgCycleTimeMinutes)}</td>
                    <td className="px-4 py-2">{formatNumber(p.leaveDaysApproved)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={PERSON_LEVEL_TONE[sustainability.level]}>{PERSON_LEVEL_LABEL[sustainability.level]}</Badge>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 bg-neutral-50">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Workload Sustainability</p>
                            <p className="text-sm text-neutral-700 mt-1">
                              Current workload: <span className="font-medium">{PERSON_LEVEL_LABEL[sustainability.level]}</span>
                            </p>
                            {sustainability.factors.length > 0 && (
                              <ul className="mt-1.5 list-disc list-inside space-y-0.5">
                                {sustainability.factors.map((f, i) => (
                                  <li key={i} className="text-sm text-neutral-600">
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p className="text-sm text-neutral-600 mt-2">{sustainability.note}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{copy.insufficientDataTitle}</p>
                            <p className="text-xs text-neutral-500 mt-1">
                              This app doesn&apos;t track the following for individuals — shown honestly rather than estimated:
                            </p>
                            <ul className="mt-1.5 space-y-0.5">
                              {["projectAssignment", "onCall", "productOwnership", "skills", "contextSwitching"].map((key) => {
                                const dim = MISSING_DIMENSIONS.find((d) => d.key === key);
                                return dim ? (
                                  <li key={key} className="text-xs text-neutral-500 flex items-start gap-1.5">
                                    <span className="text-neutral-300">•</span>
                                    {dim.label}
                                  </li>
                                ) : null;
                              })}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Knowledge & Ownership Risk (§9) — a concentration PROXY, always labelled as such. */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 text-amber-600" />
          {copy.ownershipRiskTitle}
        </h2>
        <p className="text-sm text-neutral-500 mt-1">
          Based on who resolved this team&apos;s tickets per product over the last 180 days — not a stored ownership record, since this app
          doesn&apos;t track one. Treat as a starting question, not a verdict.
        </p>
        {ownershipRisk.length === 0 ? (
          <p className="text-sm text-neutral-400 mt-3">No product concentration crossed the flagging threshold this lookback window.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {ownershipRisk.map((r) => (
              <div key={r.product} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-neutral-900">
                  <span className="font-medium">{r.product}</span> is handled almost entirely by <span className="font-medium">{r.topAssignee}</span> (
                  {Math.round(r.topAssigneeShare * 100)}% of {r.sampleSize} resolved tickets, last 180 days).
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  Recommendation: establish backup ownership and knowledge transfer before adding responsibilities tied to this product. ·{" "}
                  {CONFIDENCE_LABEL[r.confidence]}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-base font-semibold text-neutral-900">Backlog &amp; Project Load</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
          <div className="rounded-lg border border-neutral-200 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Backlog Aging Rate</p>
            <p className="text-xl font-semibold text-neutral-900 mt-1">{pct(team.backlogAgingRate)}</p>
            <Badge tone={THREE_TIER_TONE[team.backlogTier]}>{THREE_TIER_LABEL[team.backlogTier]}</Badge>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Active Projects</p>
            <p className="text-xl font-semibold text-neutral-900 mt-1">{formatNumber(team.activeProjectCount)}</p>
            <Badge tone={THREE_TIER_TONE[team.projectLoadTier]}>{THREE_TIER_LABEL[team.projectLoadTier]}</Badge>
          </div>
          {team.hasFcrEscalation && (
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Escalation Rate</p>
              <p className="text-xl font-semibold text-neutral-900 mt-1">{pct(team.escalationRate)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
