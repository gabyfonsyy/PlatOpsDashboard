import type { BadgeTone } from "@/lib/sla-status";
import { DATA_UNAVAILABLE, type OverallSlaStatus, type DataUnavailable } from "@/lib/account-creation-sla";
import type { DelayArea } from "@/lib/account-creation-cycle";

/**
 * Account Creation's Gaby's View label overlay — same partial-overlay pattern as
 * lib/ticket-outcomes-view.ts. Only section intros/taglines/empty-state copy differ; every
 * number, ranking and status is identical in both registers (none of account-creation-report.ts's
 * functions take a theme parameter). Client components read `theme` via useTheme() and pick
 * `gaby` when it's "adhd".
 */

/**
 * Overall-status -> label/tone/emoji, colocated here (not lib/sla-status.ts) since that file's
 * SlaStatus/RiskTier enums are P1 SLA-specific values that don't overlap with this page's
 * on_track/at_risk/breached/completed/pending/data_unavailable model. Reuses the same 3 Badge
 * tones rather than inventing a 4th, same reuse-over-invention call sla-status.ts's own doc
 * comment made.
 */
export const OVERALL_STATUS_META: Record<OverallSlaStatus | DataUnavailable, { label: string; tone: BadgeTone; emoji: string }> = {
  on_track: { label: "On Track", tone: "success", emoji: "🟢" },
  at_risk: { label: "At Risk", tone: "warning", emoji: "🟡" },
  breached: { label: "Breached", tone: "danger", emoji: "🔴" },
  completed: { label: "Completed", tone: "success", emoji: "🔵" },
  pending: { label: "Pending", tone: "neutral", emoji: "⚪" },
  [DATA_UNAVAILABLE]: { label: "Data unavailable", tone: "neutral", emoji: "—" },
};

/** Per-milestone status -> label/tone. Every milestone type shares this one map (string-keyed
 * rather than one Record per enum) since the value sets overlap heavily and the labels read fine
 * across all four milestones. */
export const MILESTONE_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  not_started: { label: "Not Started", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "neutral" },
  completed: { label: "Completed", tone: "success" },
  late: { label: "Late", tone: "danger" },
  at_risk: { label: "At Risk", tone: "warning" },
  pending: { label: "Pending", tone: "neutral" },
  endorsed: { label: "Endorsed", tone: "success" },
  // "L3 not needed" vs "L3 needed but never endorsed" isn't distinguishable from data alone — this
  // reads as an inference from absence of evidence past the deadline, never a confirmed miss.
  missing: { label: "No Linked L3 Found", tone: "warning" },
  not_applicable: { label: "N/A", tone: "neutral" },
  [DATA_UNAVAILABLE]: { label: "Data unavailable", tone: "neutral" },
};
/** Delay-area -> label/tone, neutral language per Section 8's explicit guidance ("delay
 * concentration"/"bottleneck", never "blame") — reuses the same 3 Badge tones as every other map
 * on this page rather than inventing a 4th. */
export const DELAY_AREA_META: Record<DelayArea, { label: string; tone: BadgeTone }> = {
  se_work_delay: { label: "SE Work Delay", tone: "warning" },
  peer_review_delay: { label: "Peer Review Delay", tone: "warning" },
  no_significant_delay: { label: "No Significant Delay", tone: "success" },
  unable_to_determine: { label: "Unable to Determine", tone: "neutral" },
};

export const ACCOUNT_CREATION_COPY = {
  professional: {
    pageTitle: "Account Creation Review",
    pageIntro:
      "Operational SLA monitoring for ST Account Creation tickets — Day 1 setup, L3 endorsement and completion, and SE cycle time.",
    watchtowerTitle: "Watchtower",
    watchtowerIntro: "Are we actually moving these tickets when we're supposed to?",
    day1MonitoringTitle: "Did the ticket actually move?",
    day1MonitoringIntro: "Assigning a ticket and touching a ticket are two different events.",
    onTrackTagline: "Progressing within SLA.",
    atRiskTagline: "Not yet breached, but the deadline is close.",
    breachedTagline: "A required milestone passed without completion.",
    day1NotStartedTagline: "Past the expected Day 1 start with no work logged yet.",
    lateStartTagline: "Started, just after the expected Day 1.",
    seComplianceTitle: "SE Patterns",
    seComplianceIntro: "Day 1 start compliance and workload context, by assigned SE.",
    historicalTitle: "Performance",
    historicalIntro: "Actual SLA compliance over completed tickets in the selected period.",
    workloadTitle: "Workload Context",
    workloadIntro: "Account Creation load alongside each SE's total ST volume for the period.",
    cycleTimeDiagnosticsTitle: "Cycle Time Diagnostics",
    cycleTimeDiagnosticsIntro: "Where the SE-owned stage actually loses time — execution vs. peer review.",
    bottlenecksTitle: "Account Creation Bottlenecks",
    bottlenecksIntro: "Process bottlenecks and workload concentration, not a leaderboard.",
    emptyState: "Nothing in this period.",
  },
  gaby: {
    pageTitle: "Account Creation Watchtower 🚦",
    pageIntro:
      "Okay besties, let's see who's cruising, who's cutting it close, and which tickets have decided to test our patience.",
    watchtowerTitle: "Watchtower 🚦",
    watchtowerIntro: "The important question: are we actually moving these tickets when we're supposed to?",
    day1MonitoringTitle: "Did the ticket actually move? 👀",
    day1MonitoringIntro: "Because assigning a ticket and touching a ticket are, unfortunately, two different things.",
    onTrackTagline: "We love a ticket that knows how to behave. ✨",
    atRiskTagline: "Not technically late... yet. But the clock is doing its little thing.",
    breachedTagline: "🚨 We have officially entered the 'okay, what happened here?' zone.",
    day1NotStartedTagline: "The ticket is sitting in To Do. The SLA clock is not sitting with it.",
    lateStartTagline: "Eventually started. Unfortunately, 'eventually' is not an SLA category.",
    seComplianceTitle: "SE Patterns 👀",
    seComplianceIntro: "Patterns > vibes. Let's look at the receipts.",
    historicalTitle: "Okay, but how are we ACTUALLY doing?",
    historicalIntro: "The SLA says two days. The data has receipts. Let's see what actually happened.",
    workloadTitle: "Workload Context",
    workloadIntro: "Before we point fingers, let's check whether someone's calendar is on fire.",
    cycleTimeDiagnosticsTitle: "Where'd the Time Go? ⏱",
    cycleTimeDiagnosticsIntro: "Was it the doing, or the waiting-for-a-thumbs-up? Let's find out.",
    bottlenecksTitle: "Account Creation Bottlenecks",
    bottlenecksIntro: "Not a leaderboard, we promise — just where the queue actually backs up.",
    emptyState: "Beautiful. Nothing is currently on fire. 🔥",
  },
} as const;

export type AccountCreationCopy = {
  pageTitle: string;
  pageIntro: string;
  watchtowerTitle: string;
  watchtowerIntro: string;
  day1MonitoringTitle: string;
  day1MonitoringIntro: string;
  onTrackTagline: string;
  atRiskTagline: string;
  breachedTagline: string;
  day1NotStartedTagline: string;
  lateStartTagline: string;
  seComplianceTitle: string;
  seComplianceIntro: string;
  historicalTitle: string;
  historicalIntro: string;
  workloadTitle: string;
  workloadIntro: string;
  cycleTimeDiagnosticsTitle: string;
  cycleTimeDiagnosticsIntro: string;
  bottlenecksTitle: string;
  bottlenecksIntro: string;
  emptyState: string;
};

export function accountCreationCopy(theme: string | undefined): AccountCreationCopy {
  return theme === "adhd" ? ACCOUNT_CREATION_COPY.gaby : ACCOUNT_CREATION_COPY.professional;
}
