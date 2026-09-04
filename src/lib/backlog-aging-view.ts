/**
 * Backlog & Ageing deep-dive's Gaby's View label overlay — same partial-overlay pattern as
 * lib/lead-time-view.ts's LEAD_TIME_COPY / lib/cycle-time-view.ts's CYCLE_TIME_COPY, scoped to
 * this one page. ONLY section/table titles and insight microcopy differ; every number, ranking,
 * filter and threshold is identical in both registers (getBacklogAgingDeepDive never takes a
 * theme parameter). Client components read `theme` via useTheme() and pick `gaby` when it's
 * "adhd", same pattern as InsightsPanel / LeadTimeDeepDive / CycleTimeDeepDive.
 *
 * Vocabulary is the brief's own section 46 table verbatim — kept subtle per her instruction
 * ("NASA Mission Control, but Gaby runs the ops room"): table column headers stay identical in
 * both registers, only titles/insight text change.
 */
export const BACKLOG_AGING_COPY = {
  professional: {
    pageTitleSuffix: "Backlog & Ageing",
    backlogLabel: "Backlog",
    ageLabel: "Age",
    ageingRateLabel: "Ageing Rate",
    agingRiskLabel: "Aging Risk",
    staleLabel: "Stale",
    oldestLabel: "Oldest",
    backlogTrendLabel: "Backlog Trend",
    backlogHealthLabel: "Backlog Health",
    workCategoryLabel: "Work Category",
    backendChanges: "Backend Changes",
    investigations: "Investigations",
    issueTypeLabel: "Issue Type",
    ownerLabel: "Assigned Owner",
    completedLabel: "Completed",
    incomingLabel: "Incoming",
    waitingStatusLabel: "Waiting",
    allWork: "All SE Work",

    summaryTitle: "Current Backlog",
    ageSummaryTitle: "Current Backlog Age",
    timelinessTitle: "Resolution Timeliness",
    healthTitle: "Backlog Health",
    trendTitle: "Backlog Trend",
    ageDistributionTitle: "Current Backlog Age Distribution",
    agingRiskTitle: "Aging Risk",
    attentionTitle: "What Needs My Attention?",
    staleTitle: "Stale / No-Movement Tickets",
    timeInStatusTitle: "Time in Current Status",
    ageingRateTrendTitle: "Ageing Rate Trend",
    byWorkCategoryTitle: "Current SE Backlog by Work Category",
    ageingRateByWorkCategoryTitle: "Ageing Rate by SE Work Category",
    byIssueTypeTitle: "SE Backlog by Issue Type",
    ageingRateByIssueTypeTitle: "Ageing Rate by SE Issue Type",
    byPriorityTitle: "Backlog Risk by Priority",
    byProductTitle: "Backlog Risk by Product",
    byOwnerTitle: "Backlog by Assigned Owner",
    oldestTicketsTitle: "Oldest Tickets",
    whatsGoingOn: "What Should I Know?",
    ticketDetailsTitle: "Backlog — Ticket Detail",
    overdueTicketDetailsTitle: "Resolved Beyond Due Date",
    noData: "No data for this period.",
  },
  gaby: {
    pageTitleSuffix: "Mission Queue",
    backlogLabel: "Mission Queue",
    ageLabel: "Mission Age",
    ageingRateLabel: "Mission Timeliness",
    agingRiskLabel: "Mission Risk",
    staleLabel: "Stalled Missions",
    oldestLabel: "Ancient Missions",
    backlogTrendLabel: "Queue Trajectory",
    backlogHealthLabel: "Mission Queue Status",
    workCategoryLabel: "Mission Class",
    backendChanges: "Backend Missions",
    investigations: "Recon Missions",
    issueTypeLabel: "Mission Type",
    ownerLabel: "Mission Operator",
    completedLabel: "Mission Cleared",
    incomingLabel: "New Missions",
    waitingStatusLabel: "Holding Pattern",
    allWork: "All SE Missions",

    summaryTitle: "Current Mission Queue",
    ageSummaryTitle: "Current Mission Age",
    timelinessTitle: "Mission Timeliness",
    healthTitle: "Mission Queue Status",
    trendTitle: "Queue Trajectory",
    ageDistributionTitle: "Current Mission Age Distribution",
    agingRiskTitle: "Mission Risk",
    attentionTitle: "What Needs My Attention?",
    staleTitle: "Stalled Missions",
    timeInStatusTitle: "Time in Current Status",
    ageingRateTrendTitle: "Mission Timeliness Trend",
    byWorkCategoryTitle: "Current SE Mission Queue by Class",
    ageingRateByWorkCategoryTitle: "Mission Timeliness by SE Mission Class",
    byIssueTypeTitle: "SE Mission Queue by Type",
    ageingRateByIssueTypeTitle: "Mission Timeliness by SE Mission Type",
    byPriorityTitle: "Mission Risk by Priority",
    byProductTitle: "Mission Risk by Product",
    byOwnerTitle: "Mission Queue by Operator",
    oldestTicketsTitle: "Ancient Missions",
    whatsGoingOn: "What Should I Know?",
    ticketDetailsTitle: "Mission Log — Ticket Detail",
    overdueTicketDetailsTitle: "Resolved Beyond Due Date",
    noData: "No signals detected in this sector.",
  },
} as const;

export type BacklogAgingCopy = { readonly [K in keyof (typeof BACKLOG_AGING_COPY)["professional"]]: string };

export function backlogAgingCopy(theme: string | undefined): BacklogAgingCopy {
  return theme === "adhd" ? BACKLOG_AGING_COPY.gaby : BACKLOG_AGING_COPY.professional;
}
