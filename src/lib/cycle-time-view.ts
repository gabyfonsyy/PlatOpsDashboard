/**
 * Cycle Time deep-dive's Gaby's View label overlay — same idea as lib/overview-view.ts's
 * VIEW_COPY, scoped to this one page. ONLY section/table titles and microcopy differ; every
 * number, ranking, filter and threshold is identical in both registers (see
 * getCycleTimeDeepDive — theme never reaches the lib layer). Client components read `theme` via
 * useTheme() and pick `gaby` when it's "adhd", same pattern as InsightsPanel.
 *
 * Deliberately partial, per the brief: "Do not force space terminology onto every single label."
 * A few labels stay identical across both registers below because forcing a space synonym onto
 * them would only obscure the number next to it (e.g. "Ticket", "Product").
 */
export const CYCLE_TIME_COPY = {
  professional: {
    pageTitleSuffix: "Cycle Time",
    doerLabel: "Doer Cycle Time",
    validatorLabel: "Validator Cycle Time",
    totalLabel: "Total End-to-End Cycle Time",
    cycleTimeLabel: "Cycle Time",
    whatsGoingOn: "What Should I Know?",
    trendTitle: "Cycle Time Over Time",
    distributionTitle: "Cycle Time Distribution",
    breakdownTitle: "Cycle Time by Ticket Type",
    longestToExecute: "Longest to Execute",
    longestToValidate: "Longest to Validate",
    longestEndToEnd: "Longest End-to-End",
    individualTitle: "Individual Breakdown",
    patternsTitle: "Recurring Cycle Time Patterns",
    detailsTitle: "Cycle Time — Ticket Detail",
    noData: "No data for this period.",
    completed: "Completed",
    inProgress: "In Progress",
    allWork: "All SE Work",
    backendChanges: "Backend Changes",
    investigations: "Investigations",
    workCategoryLabel: "Work Category",
    investigationCycleTimeLabel: "Investigation Cycle Time",
    backendCycleTimeLabel: "Backend Changes Cycle Time",
    compositionTitle: "Backend Changes vs. Investigations",
    validationNotRequired: "Not required",
    longestInvestigationsTitle: "Longest Investigations",
  },
  gaby: {
    pageTitleSuffix: "Mission Cycle Time",
    doerLabel: "Execution Time",
    validatorLabel: "Validation Time",
    totalLabel: "Total Mission Time",
    cycleTimeLabel: "Mission Cycle Time",
    whatsGoingOn: "What Should I Know?",
    trendTitle: "Mission Time Trajectory",
    distributionTitle: "Mission Cycle Time Distribution",
    breakdownTitle: "Mission Time by Ticket Type",
    longestToExecute: "Heavy-Lift Missions",
    longestToValidate: "Slow Orbit Checks",
    longestEndToEnd: "Longest Missions",
    individualTitle: "Crew Breakdown",
    patternsTitle: "Recurring Mission Patterns",
    detailsTitle: "Mission Log — Ticket Detail",
    noData: "No signals detected in this sector.",
    completed: "Mission Complete",
    inProgress: "Mission in Progress",
    allWork: "All SE Missions",
    backendChanges: "Backend Missions",
    investigations: "Recon Missions",
    workCategoryLabel: "Mission Class",
    investigationCycleTimeLabel: "Recon Time",
    backendCycleTimeLabel: "Backend Missions Time",
    compositionTitle: "Backend Missions vs. Recon Missions",
    validationNotRequired: "Not required — recon missions fly solo",
    longestInvestigationsTitle: "Deep-Space Recon",
  },
} as const;

export type CycleTimeView = keyof typeof CYCLE_TIME_COPY;
export type CycleTimeCopy = { readonly [K in keyof (typeof CYCLE_TIME_COPY)["professional"]]: string };

export function cycleTimeCopy(theme: string | undefined): CycleTimeCopy {
  return theme === "adhd" ? CYCLE_TIME_COPY.gaby : CYCLE_TIME_COPY.professional;
}
