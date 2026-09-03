/**
 * Lead Time deep-dive's Gaby's View label overlay — same idea as lib/cycle-time-view.ts's
 * CYCLE_TIME_COPY, scoped to this one page. ONLY section/table titles and microcopy differ; every
 * number, ranking, filter and threshold is identical in both registers (getLeadTimeDeepDive never
 * takes a theme parameter). Client components read `theme` via useTheme() and pick `gaby` when
 * it's "adhd", same pattern as InsightsPanel / CycleTimeDeepDive.
 *
 * Deliberately partial, per the brief (section 21): "Keep the personality subtle... think NASA
 * mission control, but Gaby runs the ops room." Table column headers (Ticket, Product, Created →
 * Resolved, ...) stay identical in both registers — relabeling every cell would obscure the
 * numbers next to them, not just this section's titles.
 */
export const LEAD_TIME_COPY = {
  professional: {
    pageTitleSuffix: "Lead Time",
    leadTimeLabel: "Lead Time",
    activeWorkLabel: "Active Work",
    waitingLabel: "Waiting / On-Hold",
    whatsGoingOn: "What Should I Know?",
    trendTitle: "Lead Time Over Time",
    distributionTitle: "Lead Time Distribution",
    breakdownTitle: "What's Driving Lead Time?",
    flowTitle: "Where Is Time Being Spent?",
    activeWorkCardTitle: "Lead Time vs. Active Work",
    longestOverall: "Longest Overall",
    longestBackend: "Longest Backend Changes",
    longestInvestigations: "Longest Investigations",
    outliersTitle: "Long-Running Work & Outliers",
    individualTitle: "Individual Breakdown",
    patternsTitle: "Recurring Lead Time Patterns",
    detailsTitle: "Lead Time — Ticket Detail",
    allWork: "All SE Work",
    backendChanges: "Backend Changes",
    investigations: "Investigations",
    workCategoryLabel: "Work Category",
    compositionTitle: "Backend Changes vs. Investigations",
    workMixTitle: "SE Work Mix",
    noData: "No data for this period.",
  },
  gaby: {
    pageTitleSuffix: "Mission Elapsed Time",
    leadTimeLabel: "Mission Elapsed Time",
    activeWorkLabel: "Mission Activity",
    waitingLabel: "Holding Pattern",
    whatsGoingOn: "What Should I Know?",
    trendTitle: "Mission Time Trajectory",
    distributionTitle: "Mission Elapsed Time Distribution",
    breakdownTitle: "What's Driving Mission Time?",
    flowTitle: "Where Is Time Being Spent?",
    activeWorkCardTitle: "Elapsed Time vs. Mission Activity",
    longestOverall: "Longest Missions",
    longestBackend: "Longest Backend Missions",
    longestInvestigations: "Longest Recon Missions",
    outliersTitle: "Anomalies Detected",
    individualTitle: "Crew Breakdown",
    patternsTitle: "Recurring Mission Patterns",
    detailsTitle: "Mission Log — Ticket Detail",
    allWork: "All SE Missions",
    backendChanges: "Backend Missions",
    investigations: "Recon Missions",
    workCategoryLabel: "Mission Class",
    compositionTitle: "Backend Missions vs. Recon Missions",
    workMixTitle: "Mission Composition",
    noData: "No signals detected in this sector.",
  },
} as const;

export type LeadTimeView = keyof typeof LEAD_TIME_COPY;
export type LeadTimeCopy = { readonly [K in keyof (typeof LEAD_TIME_COPY)["professional"]]: string };

export function leadTimeCopy(theme: string | undefined): LeadTimeCopy {
  return theme === "adhd" ? LEAD_TIME_COPY.gaby : LEAD_TIME_COPY.professional;
}
