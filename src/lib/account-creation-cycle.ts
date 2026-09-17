import { minutesBetween } from "@/lib/manila-date";
import type { AccountCreationTicketSla, PeerReviewCycleRaw, SeWorkCycleRaw } from "@/lib/account-creation-sla";

/**
 * SE-execution-vs-peer-review cycle-time breakdown — pure functions, no I/O, same split as
 * account-creation-sla.ts. Builds a per-ticket timeline from se_work_cycles_json (Section 1: In
 * Progress -> For Peer Review) and peer_review_cycles_json (Section 2: For Peer Review -> On
 * Hold/For Checking), then attributes delay to whichever stage actually consumed the time
 * (Section 3) — never the total ticket duration.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const QUALIFYING_REVIEW_EXIT_STATUSES = ["on hold", "for checking"];

/** Same business rule as account-creation-report.ts's validatorMinutesFor / peer-review.ts's
 * getCompletedPeerReviewCycles — the first exit to On Hold/For Checking is what "completes" a
 * review cycle. Not reinvented here, just re-applied per stage instead of summed once. */
export function isQualifyingReviewExit(exitedToStatus: string | null | undefined): boolean {
  return QUALIFYING_REVIEW_EXIT_STATUSES.includes((exitedToStatus || "").toLowerCase());
}

export type CycleStageType = "se_work" | "peer_review";

export type CycleStage = {
  stage: CycleStageType;
  /** 1-based, counted within its own stage type — "SE Work Cycle 1"/"SE Rework Cycle 2", "Review Cycle 1"/"Review Cycle 2" (Section 11). */
  cycleNumber: number;
  /** se_work: who did the work (assigneeAtEntry — the original SE). peer_review: the reviewer (reviewerAtEntry). */
  ownerAtStart: string | null;
  /** se_work only: who actually handed it off (assigneeAtExit), when different from ownerAtStart. Always null for peer_review — deliberately never the deprecated exit-assignee `reviewer` field (see peer-review.ts's own doc comment on why that's a real misattribution risk). */
  ownerAtEnd: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Elapsed against `nowIso` when the stage is still open — a real, honestly-labelled live duration (Section 12), not null. */
  durationMinutes: number | null;
  /** peer_review only. */
  exitedToStatus: string | null;
};

/**
 * Merges se_work_cycles_json + peer_review_cycles_json into one chronological RAW timeline —
 * Section 11's "at minimum, the raw timeline should remain available" requirement. Every cycle is
 * kept, including a peer-review exit back to In Progress (rework) or any other non-qualifying
 * exit — nothing is dropped at this layer, only the aggregate stats below apply the qualifying-exit
 * filter.
 */
export function buildTicketCycleTimeline(
  seWorkCycles: SeWorkCycleRaw[] | null,
  peerReviewCycles: PeerReviewCycleRaw[] | null,
  nowIso: string
): CycleStage[] {
  const seStages: CycleStage[] = (seWorkCycles || [])
    .filter((c): c is SeWorkCycleRaw & { enteredAt: string } => Boolean(c.enteredAt))
    .map((c) => ({
      stage: "se_work" as const,
      cycleNumber: 0,
      ownerAtStart: c.assigneeAtEntry || null,
      ownerAtEnd: c.assigneeAtExit || null,
      startedAt: c.enteredAt,
      endedAt: c.exitedAt || null,
      durationMinutes: round2(minutesBetween(c.enteredAt, c.exitedAt || nowIso)),
      exitedToStatus: null,
    }));

  const reviewStages: CycleStage[] = (peerReviewCycles || [])
    .filter((c): c is PeerReviewCycleRaw & { enteredAt: string } => Boolean(c.enteredAt))
    .map((c) => ({
      stage: "peer_review" as const,
      cycleNumber: 0,
      ownerAtStart: c.reviewerAtEntry || null,
      ownerAtEnd: null,
      startedAt: c.enteredAt,
      endedAt: c.exitedAt || null,
      durationMinutes: round2(minutesBetween(c.enteredAt, c.exitedAt || nowIso)),
      exitedToStatus: c.exitedToStatus || null,
    }));

  const merged = [...seStages, ...reviewStages].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));

  let seCount = 0;
  let reviewCount = 0;
  for (const s of merged) {
    if (s.stage === "se_work") s.cycleNumber = ++seCount;
    else s.cycleNumber = ++reviewCount;
  }

  return merged;
}

export type CycleTimelineSummary = {
  /** Sum of every SE-work cycle — every In Progress span is real work time, no exit-status filter needed. */
  totalSeWorkMinutes: number | null;
  /** Sum of qualifying review cycles only (exit to On Hold/For Checking, or still open) — same rule as validatorMinutesFor, applied per-cycle instead of once. */
  totalReviewMinutes: number | null;
  totalWorkflowMinutes: number | null;
  longestStage: CycleStage | null;
};

export function summarizeTimeline(stages: CycleStage[]): CycleTimelineSummary {
  const seStages = stages.filter((s) => s.stage === "se_work");
  const totalSeWorkMinutes = seStages.length ? round2(seStages.reduce((sum, s) => sum + (s.durationMinutes || 0), 0)) : null;

  // An open review cycle (still "In Progress" per Section 12) counts toward the running total even
  // though it hasn't reached a qualifying exit yet — its elapsed time so far is real.
  const qualifyingReviewStages = stages.filter(
    (s) => s.stage === "peer_review" && (s.endedAt === null || isQualifyingReviewExit(s.exitedToStatus))
  );
  const totalReviewMinutes = qualifyingReviewStages.length
    ? round2(qualifyingReviewStages.reduce((sum, s) => sum + (s.durationMinutes || 0), 0))
    : null;

  const totalWorkflowMinutes =
    totalSeWorkMinutes !== null || totalReviewMinutes !== null ? round2((totalSeWorkMinutes || 0) + (totalReviewMinutes || 0)) : null;

  const longestStage = stages.reduce<CycleStage | null>((longest, s) => {
    if (s.durationMinutes === null) return longest;
    if (!longest || (longest.durationMinutes ?? -1) < s.durationMinutes) return s;
    return longest;
  }, null);

  return { totalSeWorkMinutes, totalReviewMinutes, totalWorkflowMinutes, longestStage };
}

/**
 * The one new configurable number this feature adds (Section 6: "reuse the existing SLA rules
 * where appropriate, don't invent a wholly new one"). SE-side delay reuses the existing Day-1 SLA
 * lateness rule instead (see deriveDelayAttribution) — there's no existing rule for review
 * duration at all, so this is the only place a new threshold is genuinely needed. Exported so it's
 * the one place to tune it.
 */
export const REVIEW_DELAY_THRESHOLD_MINUTES = 120;

export type DelayArea = "se_work_delay" | "peer_review_delay" | "no_significant_delay" | "unable_to_determine";

export type DelayAttribution = {
  area: DelayArea;
  owner: string | null;
  /** The two underlying signals, exposed independently of `area` — a ticket can be delayed on
   * BOTH sides at once even though `area` (Section 3's majority-of-time rule) only ever names one.
   * Section 13A's "% Delayed in SE Work" / "% Delayed in Review" summary cards need these directly,
   * not derived back out of `area`, or a both-delayed ticket would silently only count once. */
  seDelayed: boolean;
  reviewDelayed: boolean;
};

/**
 * Section 3's rule, followed literally: never attribute delay from the total ticket duration.
 * SE-side "delayed" reuses day1SeSetup's existing Day-1-end-of-day SLA lateness (a real per-ticket
 * deadline, tighter than a flat number). Review-side "delayed" uses REVIEW_DELAY_THRESHOLD_MINUTES,
 * the one new number this feature adds. When both fire, the stage carrying the MAJORITY of the
 * cycle time wins the attribution — not whichever crossed its threshold by more.
 */
export function deriveDelayAttribution(
  ticket: AccountCreationTicketSla,
  summary: CycleTimelineSummary,
  timeline: CycleStage[]
): DelayAttribution {
  const seDelayed = ticket.day1SeSetup.status === "late";
  const reviewDelayed = summary.totalReviewMinutes !== null && summary.totalReviewMinutes > REVIEW_DELAY_THRESHOLD_MINUTES;

  const lastSeStage = [...timeline].reverse().find((s) => s.stage === "se_work") || null;
  const lastReviewStage = [...timeline].reverse().find((s) => s.stage === "peer_review") || null;
  const seOwner = lastSeStage?.ownerAtStart ?? null;
  const reviewOwner = lastReviewStage?.ownerAtStart ?? null;

  if (!seDelayed && !reviewDelayed) {
    // Neither signal even measurable (e.g. pre-tracking history with no se_work cycles at all) is
    // an honest "we don't know," never the same as a confirmed on-time ticket.
    if (summary.totalSeWorkMinutes === null && summary.totalReviewMinutes === null) {
      return { area: "unable_to_determine", owner: null, seDelayed, reviewDelayed };
    }
    return { area: "no_significant_delay", owner: null, seDelayed, reviewDelayed };
  }

  if (seDelayed && !reviewDelayed) return { area: "se_work_delay", owner: seOwner, seDelayed, reviewDelayed };
  if (reviewDelayed && !seDelayed) return { area: "peer_review_delay", owner: reviewOwner, seDelayed, reviewDelayed };

  const seMinutes = summary.totalSeWorkMinutes ?? 0;
  const reviewMinutes = summary.totalReviewMinutes ?? 0;
  return seMinutes >= reviewMinutes
    ? { area: "se_work_delay", owner: seOwner, seDelayed, reviewDelayed }
    : { area: "peer_review_delay", owner: reviewOwner, seDelayed, reviewDelayed };
}
