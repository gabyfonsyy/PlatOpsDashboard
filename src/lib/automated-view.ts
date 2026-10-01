import { resolveRegister } from "@/lib/theme";

/**
 * Automated Tickets deep-dive copy, both registers — same pattern as lib/review-wait-view.ts.
 * Gaby's View only warms the wording; every number, ranking and filter is identical in both, and
 * theme never reaches lib/automated-tickets.ts.
 *
 * Client-safe on purpose (no server imports).
 */
export const AUTOMATED_COPY = {
  professional: {
    bigPicture: "The big picture",
    shareLabel: "Automated Share",
    countLabel: "Automated Tickets",
    leadLabel: "Median Lead Time",
    cycleLabel: "Median Cycle Time",
    whatShouldIKnow: "What Should I Know?",
    trend: "Is automation carrying more or less?",
    trendChart: "Automated tickets over time",
    labelTrend: "Which automations are growing?",
    labelTrendCaveat: "Automated tickets carrying each label, this period vs the previous one. A ticket with two labels counts under both.",
    vsManual: "Automated vs manual",
    vsManualCaveat:
      "Manual = a real person is the Assigned SE and no catalogued automation label. Calendar time, same spans as Lead Time and Cycle Time.",
    avoidedLabel: "Manual-equivalent cycle time",
    absorbedLabel: "SE time on automation-raised tickets",
    pickers: "Who picks them up?",
    pickersCaveat:
      "Tickets that qualify by automation label but have a person as Assigned SE. Context for workload, not a performance measure.",
    whatIsIt: "What's being automated?",
    dataQuality: "Data quality",
    untaggedTitle: "Untagged tickets: who to tag",
    candidatesTitle: "Labels on bot-owned tickets you haven't catalogued",
    noData: "No automated tickets in this period.",
    noPickers: "No automation-labelled tickets were picked up by a person in this period.",
  },
  gaby: {
    bigPicture: "✨ The big picture",
    shareLabel: "Handled by automation",
    countLabel: "Automated tickets",
    leadLabel: "Typical lead time",
    cycleLabel: "Typical cycle time",
    whatShouldIKnow: "What Should I Know?",
    trend: "Is automation pulling more weight?",
    trendChart: "Automation over time",
    labelTrend: "Which bots got busier?",
    labelTrendCaveat: "Each label's automated tickets, now vs last period. Two labels on one ticket = counted under both.",
    vsManual: "Bot vs by hand",
    vsManualCaveat: "By hand = a real SE owns it and it has no automation label. Calendar time, same as Lead/Cycle Time.",
    avoidedLabel: "Cycle time the bot took off our plate",
    absorbedLabel: "SE time on bot-raised tickets",
    pickers: "Who's catching the bot's tickets?",
    pickersCaveat: "Bot-raised tickets a person picked up. Who's carrying the follow-up — not a scorecard.",
    whatIsIt: "What's the automation doing?",
    dataQuality: "Data health check",
    untaggedTitle: "Untagged tickets: who should be tagged?",
    candidatesTitle: "Bot labels not in your catalogue yet",
    noData: "No automated tickets in this window yet.",
    noPickers: "Nobody had to pick up a bot-raised ticket this period. 🎉",
  },
} as const;

export type AutomatedCopy = { readonly [K in keyof (typeof AUTOMATED_COPY)["professional"]]: string };

export function automatedCopy(theme: string | undefined): AutomatedCopy {
  return resolveRegister<AutomatedCopy>(theme, AUTOMATED_COPY);
}
