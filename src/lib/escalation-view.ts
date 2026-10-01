import { resolveRegister } from "@/lib/theme";

/** Escalation Rate deep-dive copy, both registers — same pattern as lib/fcr-view.ts. Client-safe. */
export const ESCALATION_COPY = {
  professional: {
    howMuch: "How much are we escalating?",
    rateLabel: "Escalation Rate",
    escalatedLabel: "Escalated Tickets",
    fcrLabel: "Resolved on First Contact",
    avgDestLabel: "Teams per Escalation",
    whoLeaning: "Who are we leaning on?",
    whoLeaningCaveat:
      "One row per team. A ticket escalated to DevOps and L3 counts once for DevOps and once for L3, so shares can add up to more than 100%.",
    dependencies: "Where SE support dependencies land",
    whatsEscalated: "What's getting escalated?",
    whatsEscalatedCaveat: "Some work needs specialist help by nature. Read each rate with its ticket count; this is not a ranking of people.",
    matrix: "What kind of ticket → which team?",
    matrixCaveat: "Escalated tickets by type and receiving team. A ticket sent to two teams appears in both columns.",
    complexity: "How complex are the escalations?",
    complexityCaveat: "Escalated tickets by how many teams they needed. Observed differences, not cause and effect.",
    impact: "First contact vs escalated",
    impactCaveat: "How much extra operational time is associated with escalation — an observed difference, not a cause.",
    isItChanging: "Is it changing?",
    destTrend: "Escalations by team over time",
    tickets: "Escalated tickets",
    dataQuality: "Data quality",
    whatShouldIKnow: "What Should I Know?",
  },
  gaby: {
    howMuch: "✨ How much are we escalating?",
    rateLabel: "Escalation Rate",
    escalatedLabel: "Needed extra help",
    fcrLabel: "Solved first time",
    avgDestLabel: "Teams per escalation",
    whoLeaning: "Who are we leaning on?",
    whoLeaningCaveat: "Each team gets its own count — DevOps + L3 on one ticket = 1 for DevOps and 1 for L3.",
    dependencies: "Where our dependencies land",
    whatsEscalated: "What's getting escalated?",
    whatsEscalatedCaveat: "Some tickets just need a specialist. Always read the % with the ticket count.",
    matrix: "Which tickets go to which team?",
    matrixCaveat: "One ticket to two teams shows up in both columns.",
    complexity: "How complex are the escalations?",
    complexityCaveat: "One team vs several — what it looks like, not why.",
    impact: "Solved first time vs escalated",
    impactCaveat: "The extra time that comes with escalation — observed, not blamed.",
    isItChanging: "Is it changing?",
    destTrend: "Which teams we lean on, over time",
    tickets: "The escalated tickets",
    dataQuality: "Data health check",
    whatShouldIKnow: "What Should I Know?",
  },
} as const;

export type EscalationCopy = { readonly [K in keyof (typeof ESCALATION_COPY)["professional"]]: string };

export function escalationCopy(theme: string | undefined): EscalationCopy {
  return resolveRegister<EscalationCopy>(theme, ESCALATION_COPY);
}
