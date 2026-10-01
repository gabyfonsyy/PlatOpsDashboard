import { resolveRegister } from "@/lib/theme";

/**
 * FCR Rate deep-dive copy, both registers — same pattern as lib/review-wait-view.ts. Every number,
 * ranking and filter is identical in both; theme never reaches lib/fcr.ts. Client-safe.
 */
export const FCR_COPY = {
  professional: {
    howAreWeDoing: "How are we doing?",
    rateLabel: "FCR Rate",
    resolvedLabel: "Resolved Tickets",
    fcrLabel: "FCR Tickets",
    nonFcrLabel: "Non-FCR Tickets",
    splitTitle: "Resolved on first contact vs needed follow-up",
    relatedTitle: "Alongside other SE metrics",
    relatedCaveat: "Same tickets, side by side. Context, not cause and effect.",
    whatShouldIKnow: "What Should I Know?",
    whatsDriving: "What's driving it?",
    whatsDrivingCaveat:
      "FCR differs naturally by ticket type, complexity and process. Read every rate next to its ticket count; this is not a ranking of people.",
    whereLosing: "Where are we losing first-contact resolution?",
    whereLosingCaveat: "Ranked by follow-up volume, not by lowest rate — a 70% category with 100 tickets matters more than a 50% one with 4.",
    whereWent: "Where did the follow-ups go?",
    whatKeepsComingBack: "What keeps coming back?",
    whatKeepsComingBackCaveat:
      "Product + label combinations with more follow-ups than the team rate predicts. Candidates for runbooks, documentation, access or automation — some will need another team by nature.",
    isItChanging: "Is it changing?",
    tickets: "Tickets",
    dataQuality: "Data quality",
    noData: "No resolved tickets in this period.",
  },
  gaby: {
    howAreWeDoing: "✨ How are we doing?",
    rateLabel: "First Contact Resolution",
    resolvedLabel: "Resolved",
    fcrLabel: "Solved first time",
    nonFcrLabel: "Needed follow-up",
    splitTitle: "First time vs follow-up",
    relatedTitle: "The rest of the picture",
    relatedCaveat: "Same tickets, other lenses — patterns to look into, not proof of anything.",
    whatShouldIKnow: "What Should I Know?",
    whatsDriving: "What's driving it?",
    whatsDrivingCaveat: "Different work, different FCR. Always read the % with the ticket count — 2 tickets isn't a trend.",
    whereLosing: "Where are we losing first-contact resolution?",
    whereLosingCaveat: "Sorted by how much follow-up work, not by the lowest %.",
    whereWent: "Where did the follow-ups go?",
    whatKeepsComingBack: "What keeps coming back?",
    whatKeepsComingBackCaveat: "Repeat-work hotspots — where a runbook, access fix or bot could save the most back-and-forth.",
    isItChanging: "Is it changing?",
    tickets: "The tickets",
    dataQuality: "Data health check",
    noData: "Nothing resolved in this window yet.",
  },
} as const;

export type FcrCopy = { readonly [K in keyof (typeof FCR_COPY)["professional"]]: string };

export function fcrCopy(theme: string | undefined): FcrCopy {
  return resolveRegister<FcrCopy>(theme, FCR_COPY);
}

export const SEGMENT_LABELS: Record<string, string> = {
  se: "Assigned SE",
  issueType: "Ticket Type",
  reporter: "Reporter",
  priority: "Priority",
  product: "Product",
  month: "Month",
  week: "Week",
  dow: "Day of Week",
};
