/**
 * Capacity & Health's Gaby's View label overlay + narrative/brief text generation — same
 * partial-overlay pattern as lib/backlog-aging-view.ts's BACKLOG_AGING_COPY: only titles and
 * microcopy differ between registers, every number/ranking/threshold is identical. Kept subtle
 * per her "NASA Mission Control, but Gaby runs the ops room" instruction.
 *
 * The narrative builders below (buildTeamInterpretation, buildGabyRead, buildHeadcountCase,
 * buildManagementBrief) are pure functions over already-computed lib/capacity.ts data — every
 * sentence they produce traces to a real field on the objects passed in. No new numbers are
 * invented here, only sentences describing numbers computed elsewhere.
 */
import type { CapacityOverview, TeamCapacity, CapacityTrend, PersonCapacity } from "@/lib/capacity";
import { CAPACITY_TIER_LABEL, type CapacityTier } from "@/lib/capacity-config";
import { teamLabel } from "@/lib/utils";

export const CAPACITY_COPY = {
  professional: {
    pageTitleSuffix: "Capacity & Health",
    headcountLabel: "Current Headcount",
    availableLabel: "Estimated Available Capacity",
    demandLabel: "Demand",
    gapLabel: "Capacity Gap",
    sustainabilityLabel: "Sustainability Risk",
    projectCapacityLabel: "Project Capacity",
    teamComparisonTitle: "Team Comparison",
    interpretationTitle: "Capacity Interpretation",
    scenarioTitle: "Can We Take On More Work?",
    trendTitle: "Demand vs. Capacity Trend",
    headcountCaseTitle: "Headcount Case",
    managementBriefTitle: "Management Brief",
    gabyReadTitle: "Gaby's Read",
    rosterTitle: "Team Roster",
    ownershipRiskTitle: "Knowledge & Ownership Risk",
    insufficientDataTitle: "What This Page Can't Tell You Yet",
  },
  gaby: {
    pageTitleSuffix: "Mission Readiness",
    headcountLabel: "Crew on Deck",
    availableLabel: "Estimated Available Thrust",
    demandLabel: "Mission Load",
    gapLabel: "Thrust Gap",
    sustainabilityLabel: "Hull Stress",
    projectCapacityLabel: "New-Mission Room",
    teamComparisonTitle: "Fleet Comparison",
    interpretationTitle: "Mission Control's Read",
    scenarioTitle: "Can We Take On Another Mission?",
    trendTitle: "Thrust vs. Load Trajectory",
    headcountCaseTitle: "The Case for More Crew",
    managementBriefTitle: "ManCom Transmission",
    gabyReadTitle: "Gaby's Read",
    rosterTitle: "Crew Roster",
    ownershipRiskTitle: "🚨 Single-Point-of-Failure Scan",
    insufficientDataTitle: "Instruments We Don't Have Yet",
  },
} as const;

export type CapacityCopy = { readonly [K in keyof (typeof CAPACITY_COPY)["professional"]]: string };

export function capacityCopy(theme: string | undefined): CapacityCopy {
  return theme === "adhd" ? CAPACITY_COPY.gaby : CAPACITY_COPY.professional;
}

export const SUSTAINABILITY_TIER_DESCRIPTION: Record<CapacityTier, string> = {
  healthy: "Capacity looks healthy — there's real buffer for normal variability and some additional work.",
  watch: "Team is operating close to sustainable limits. Additional work should be evaluated carefully.",
  highLoad: "Demand is approaching or exceeding sustainable capacity. We're running hot.",
  unsustainable: "Demand consistently exceeds available capacity. The numbers are asking for help.",
};

/** Data this app genuinely does not have anywhere — shown honestly instead of a fabricated number,
 * per the brief's own §15 guardrail. */
export const MISSING_DIMENSIONS: { key: string; label: string }[] = [
  { key: "onCall", label: "On-call / operational duty roster" },
  { key: "projectAssignment", label: "Per-person project assignment, deadline, phase, and effort estimate" },
  { key: "productOwnership", label: "Stored primary/secondary product or service ownership" },
  { key: "skills", label: "Specialized skills / competency records" },
  { key: "rework", label: "Rework / reopened-ticket counts" },
  { key: "complexity", label: "Ticket complexity or story-point sizing" },
  { key: "unplannedWork", label: "Unplanned / interrupt-work flag" },
  { key: "meetingOverhead", label: "Meeting / admin overhead (an assumption in this model, not measured)" },
  { key: "contextSwitching", label: "Context switching (needs the categories above to compute)" },
];

function pct(p: number | null): string {
  return p === null ? "—" : `${Math.round(p * 100)}%`;
}

/** Section 5's per-team executive-friendly narrative, generated from real TeamCapacity fields. */
export function buildTeamInterpretation(team: TeamCapacity): string {
  const name = teamLabel(team.teamName);
  const verb =
    team.tier === "healthy"
      ? "is operating within sustainable capacity"
      : team.tier === "watch"
        ? "is operating close to sustainable capacity"
        : team.tier === "highLoad"
          ? "is operating above sustainable capacity"
          : "is significantly over sustainable capacity";
  const gapPct = team.gapPct ?? 0;
  const direction = gapPct >= 0 ? "buffer" : "gap";
  const gapAbs = Math.abs(Math.round(gapPct * 100));
  const driverText = team.drivers.length
    ? `The largest contributors are ${team.drivers.join(", ")}.`
    : "No single driver stands out from the data available this period.";
  const closing =
    gapPct < 0
      ? "Based on the current workload trend, adding another supported product or project would likely require additional capacity, scope reduction, or redistribution of existing responsibilities."
      : "Based on the current workload trend, there is measurable room to absorb additional scope before capacity becomes a constraint.";

  return `${name} ${verb}. Current demand is estimated at ${pct(team.demandPct)} against approximately ${pct(team.availablePct)} available capacity, creating a ${gapAbs}-point ${direction}. ${driverText} ${closing}`;
}

/** Section 13's short, human interpretive lines — always grounded in real deltas, never a
 * standalone claim. Capped at 3 lines so this stays a highlight reel, not a second report. */
export function buildGabyRead(overview: CapacityOverview): string[] {
  const lines: string[] = [];

  if (overview.tier === "unsustainable") {
    lines.push("The numbers are asking for help. Demand is consistently outpacing what this team can sustainably carry.");
  } else if (overview.tier === "highLoad") {
    lines.push("The team isn't drowning yet, but we're removing the life jacket.");
  } else if (overview.tier === "watch") {
    lines.push("Capacity is technically available, but the remaining buffer is too small to comfortably absorb incidents or unexpected work.");
  } else {
    lines.push("Capacity looks healthy across the org right now.");
  }

  const ranked = [...overview.teams].sort((a, b) => (b.gapPct ?? 0) - (a.gapPct ?? 0));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (best && worst && best.teamKey !== worst.teamKey && (best.gapPct ?? 0) - (worst.gapPct ?? 0) > 0.1) {
    lines.push(
      `${teamLabel(best.teamName)} has spare capacity, but transferring work to ${teamLabel(worst.teamName)} may not be practical if the demand is skill-specific.`
    );
  }

  for (const t of overview.teams) {
    const totalPersonDemand = t.people.reduce((s, p) => s + p.demandDays, 0);
    const top = t.people[0];
    if (top && totalPersonDemand > 0 && t.people.length >= 3) {
      const share = top.demandDays / totalPersonDemand;
      if (share >= 0.35) {
        lines.push(
          `${teamLabel(t.teamName)} workload is increasingly concentrated — one person accounts for roughly ${Math.round(share * 100)}% of the team's measured demand this period. The immediate problem may be distribution rather than total headcount.`
        );
        break;
      }
    }
  }

  return lines.slice(0, 3);
}

/** Section 8's "Workload Sustainability" — a systemic-dependency read, never a performance
 * judgement (see the brief's §15 guardrail: don't diagnose burnout, don't label underperformance). */
export function buildPersonSustainability(person: PersonCapacity): { level: "high" | "elevated" | "normal"; factors: string[]; note: string } {
  const factors: string[] = [];
  if (person.ticketsResolvedInPeriod > 0) {
    factors.push(`${person.ticketsResolvedInPeriod} ticket${person.ticketsResolvedInPeriod === 1 ? "" : "s"} resolved this period`);
  }
  if (person.slaOverdueRate !== null && person.slaOverdueRate > 0) {
    factors.push(`${Math.round(person.slaOverdueRate * 100)}% resolved beyond due date`);
  }
  if (person.escalationRate !== null && person.escalationRate > 0) {
    factors.push(`${Math.round(person.escalationRate * 100)}% escalation rate`);
  }
  if (person.leaveDaysApproved > 0) {
    factors.push(`${person.leaveDaysApproved} approved leave day${person.leaveDaysApproved === 1 ? "" : "s"} this period`);
  }

  const level: "high" | "elevated" | "normal" = person.tier === "unsustainable" ? "high" : person.tier === "highLoad" ? "elevated" : "normal";
  const note =
    level === "high"
      ? "This person's measured workload consistently exceeds their available capacity this period. Consider workload redistribution or backup ownership rather than reading this as an individual performance signal."
      : level === "elevated"
        ? "This person's measured workload is trending above sustainable levels. Worth watching over the next few periods before concluding it's structural."
        : "No elevated workload signal from the data available this period.";

  return { level, factors, note };
}

export type HeadcountCaseOption = { key: string; title: string; impact: string };

export type HeadcountCase = {
  recommend: boolean;
  recommendation: string;
  evidence: string[];
  businessImpact: string[];
  options: HeadcountCaseOption[];
};

/** Section 11 — evidence and options, never a headcount recommendation from one metric alone. */
export function buildHeadcountCase(overview: CapacityOverview, trend: CapacityTrend): HeadcountCase {
  const recommend = overview.tier === "highLoad" || overview.tier === "unsustainable";
  const evidence: string[] = [];

  if (trend.consecutiveWeeksOverThreshold >= 3) {
    evidence.push(`Demand has exceeded estimated sustainable capacity for ${trend.consecutiveWeeksOverThreshold} consecutive weeks.`);
  }
  if (overview.gapPct !== null) {
    evidence.push(`Current org-wide capacity buffer is approximately ${pct(overview.gapPct)}.`);
  }
  const highLoadTeams = overview.teams.filter((t) => t.tier === "highLoad" || t.tier === "unsustainable");
  if (highLoadTeams.length) {
    evidence.push(
      `${highLoadTeams.map((t) => teamLabel(t.teamName)).join(", ")} ${highLoadTeams.length === 1 ? "is" : "are"} operating above sustainable capacity.`
    );
  }
  if (overview.activeProjectCount > 0) {
    evidence.push(`${overview.activeProjectCount} active project${overview.activeProjectCount === 1 ? "" : "s"} currently competing with BAU/support work.`);
  }
  const highBacklogTeams = overview.teams.filter((t) => t.backlogTier === "high");
  if (highBacklogTeams.length) {
    evidence.push(`${highBacklogTeams.map((t) => teamLabel(t.teamName)).join(", ")} ${highBacklogTeams.length === 1 ? "shows" : "show"} a high backlog-aging rate.`);
  }

  const businessImpact = recommend
    ? [
        "Additional projects may increase SLA risk.",
        "Backlog aging may continue to increase.",
        "Operational resilience may decrease.",
        "Existing project delivery may be affected.",
        "Key-person dependency may increase.",
      ]
    : [];

  const options: HeadcountCaseOption[] = [
    { key: "A", title: "Add Headcount", impact: "Expected impact: reduce capacity gap and create operational buffer." },
    { key: "B", title: "Reduce Scope", impact: "Delay or deprioritize lower-value project work." },
    { key: "C", title: "Redistribute Work", impact: "Move selected responsibilities to a team with sustainable spare capacity — practical only where the demand isn't skill-specific." },
    { key: "D", title: "Maintain Current State", impact: "Continue with current staffing, accepting elevated operational risk." },
  ];

  const recommendation = recommend
    ? "Additional capacity should be considered for the team(s) flagged above, weighed against the alternative options below rather than treated as the only answer."
    : "Current data does not support a headcount recommendation at this time — capacity looks sustainable across the org.";

  return { recommend, recommendation, evidence, businessImpact, options };
}

/** Section 12's "Generate Management Brief" output — plain text so it pastes cleanly into
 * email/Slack/Docs (no file-export infrastructure exists anywhere else in this app). */
export function buildManagementBrief(overview: CapacityOverview, trend: CapacityTrend, headcountCase: HeadcountCase, dateLabel: string): string {
  const lines: string[] = [];
  lines.push("CAPACITY & HEALTH — MANAGEMENT BRIEF");
  lines.push(dateLabel);
  lines.push("");
  lines.push("EXECUTIVE SUMMARY");
  lines.push(
    `Platform Operations is carrying an estimated ${pct(overview.demandPct)} demand against ${pct(overview.availablePct)} available capacity across ${overview.headcount} people — a ${pct(overview.gapPct)} ${((overview.gapPct ?? 0) >= 0 ? "buffer" : "gap")}. Status: ${CAPACITY_TIER_LABEL[overview.tier]}.`
  );
  lines.push("");
  lines.push("WHAT CHANGED");
  lines.push(
    trend.consecutiveWeeksOverThreshold > 0
      ? `Demand has exceeded estimated sustainable capacity for ${trend.consecutiveWeeksOverThreshold} consecutive week${trend.consecutiveWeeksOverThreshold === 1 ? "" : "s"}.`
      : `No sustained multi-week overload pattern detected in the last ${trend.points.length} weeks.`
  );
  lines.push("");
  lines.push("CAPACITY ASSESSMENT");
  for (const t of overview.teams) {
    lines.push(`- ${teamLabel(t.teamName)}: ${pct(t.demandPct)} demand vs. ${pct(t.availablePct)} available (${CAPACITY_TIER_LABEL[t.tier]})`);
  }
  lines.push("");
  lines.push("RISKS");
  for (const b of headcountCase.businessImpact.length ? headcountCase.businessImpact : ["No elevated operational, delivery, SLA, or resilience risk identified from current data."]) {
    lines.push(`- ${b}`);
  }
  lines.push("");
  lines.push("EVIDENCE");
  for (const e of headcountCase.evidence.length ? headcountCase.evidence : ["No strong multi-week evidence pattern at this time."]) {
    lines.push(`- ${e}`);
  }
  lines.push("");
  lines.push("RECOMMENDATION");
  lines.push(headcountCase.recommendation);
  lines.push("");
  lines.push("OPTIONS & TRADE-OFFS");
  for (const o of headcountCase.options) {
    lines.push(`- Option ${o.key} — ${o.title}: ${o.impact}`);
  }
  lines.push("");
  lines.push("DECISION NEEDED");
  lines.push(
    headcountCase.recommend
      ? "Determine whether Platform Operations should absorb the additional workload as-is, or whether additional capacity, scope reduction, or redistribution should be approved."
      : "No immediate decision required — surfaced here for visibility ahead of any new scope discussions."
  );
  return lines.join("\n");
}
