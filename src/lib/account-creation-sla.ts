import {
  manilaHour,
  isWeekendManila,
  manilaDateOnlyUtc,
  nextBusinessDayUtc,
  endOfManilaDayUtc,
  toManilaDateString,
} from "@/lib/manila-date";

/**
 * Account Creation SLA engine — pure functions, no I/O. Absorbs and generalizes what
 * lib/late-pickup.ts used to do (11 AM Manila cutoff, Day1/Day2 business-day math), plus the
 * Production/Sandbox/Sandbox+DataLoading classification and the independent per-milestone status
 * model Gaby specced.
 *
 * PHASE 1 vs PHASE 2 — read this before touching milestone logic:
 * Day 1 SE Start (first_out_of_backlog_todo) and Day 1 SE Setup Completion (cycle_time_end) are
 * already-synced data, computed for real below. Day 1 L3 Endorsement, Day 2, and Day 3 need a
 * linked "L3 board" ticket this app doesn't sync yet (Phase 2, not built) — every ticket's
 * `day1L3Endorsement`/`day2`/`day3` field returns DATA_UNAVAILABLE unconditionally until then.
 * `deriveTicketSla`'s signature and `rollupOverallStatus`'s branching are both already written to
 * handle real Phase 2 data, so landing Phase 2 only means filling in those three fields — no
 * rendering logic changes.
 */

// ---------------------------------------------------------------- Track / label classification

export type TrackType = "production" | "sandbox";

const PRODUCTION_LABELS = ["partialsyncsso", "fullsyncsso", "partialsync", "fullsync"];
const SANDBOX_LABELS = ["sb-fullsyncsso", "sb-partialsyncsso"];
const DATA_LOADING_LABEL = "sb-dataloading";

function splitLabels(labels: string | null | undefined): string[] {
  return (labels || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** null = an Account Creation ticket carrying neither label set — its own visible bucket, never dropped. */
export function classifyTrackType(labels: string | null | undefined): TrackType | null {
  const list = splitLabels(labels);
  if (SANDBOX_LABELS.some((l) => list.includes(l))) return "sandbox";
  if (PRODUCTION_LABELS.some((l) => list.includes(l))) return "production";
  return null;
}

export function hasDataLoadingStage(labels: string | null | undefined): boolean {
  return splitLabels(labels).includes(DATA_LOADING_LABEL);
}

// -------------------------------------------------------------------------- SLA date math

/** Manila calendar date a ticket becomes "Day 1 owned" — moved verbatim from late-pickup.ts. */
export function computeDay1Date(created: Date): Date {
  const dateOnly = manilaDateOnlyUtc(created);
  return manilaHour(created) < 11 && !isWeekendManila(created) ? dateOnly : nextBusinessDayUtc(dateOnly);
}

export function computeDay2Date(day1Date: Date): Date {
  return nextBusinessDayUtc(day1Date);
}

export function computeDay3Date(day2Date: Date): Date {
  return nextBusinessDayUtc(day2Date);
}

/** Before/at-or-after the 11 AM Manila cutoff — its own field since Section 41 wants it as a standalone comparison axis, not just an internal input to computeDay1Date. */
export type CutoffSide = "before_11am" | "at_or_after_11am";

export function classifyCutoffSide(created: Date): CutoffSide {
  return manilaHour(created) < 11 ? "before_11am" : "at_or_after_11am";
}

// -------------------------------------------------------------------------------- Status types

export const DATA_UNAVAILABLE = "data_unavailable" as const;
export type DataUnavailable = typeof DATA_UNAVAILABLE;

export type Day1SeSetupStatus = "not_started" | "in_progress" | "completed" | "late" | "at_risk";
export type Day1L3EndorsementStatus = "pending" | "endorsed" | "late" | "missing";
export type Day2Status = "pending" | "completed" | "late" | "at_risk";
export type Day3Status = "pending" | "completed" | "late" | "at_risk" | "not_applicable";
export type OverallSlaStatus = "on_track" | "at_risk" | "breached" | "completed" | "pending";

export type Day1SeSetupMilestone = {
  status: Day1SeSetupStatus | DataUnavailable;
  startedAt: string | null; // first_out_of_backlog_todo
  completedAt: string | null; // cycle_time_end
  dueAt: string; // day1End, ISO
};

export type Day1L3EndorsementMilestone = {
  status: Day1L3EndorsementStatus | DataUnavailable;
  l3IssueKey: string | null;
  endorsedAt: string | null;
  dueAt: string;
  /** Ticket Escalation = L3 seen but no linked ticket confirmed — a footnote, never a status source. */
  escalationFieldFlagged: boolean;
};

export type Day2Milestone = {
  status: Day2Status | DataUnavailable;
  completedAt: string | null;
  dueAt: string;
};

export type Day3Milestone = {
  status: Day3Status | DataUnavailable;
  completedAt: string | null;
  dueAt: string | null; // null when not_applicable
};

export type AccountCreationTicketSla = {
  issueKey: string;
  trackType: TrackType | null;
  hasDataLoading: boolean;
  cutoffSide: CutoffSide;
  seName: string;
  created: string;
  day1Date: string; // ISO, the Manila-midnight instant Day 1 date math is built from
  day1SeSetup: Day1SeSetupMilestone;
  day1L3Endorsement: Day1L3EndorsementMilestone;
  day2: Day2Milestone;
  day3: Day3Milestone;
  overallStatus: OverallSlaStatus | DataUnavailable;
  resolvedDatetime: string | null;
};

// ------------------------------------------------------------------------- Day 1 SE Setup logic

/**
 * "At risk" here means Section 28's Due-Today/Due-Soon idea folded into this 5-value enum: the
 * milestone hasn't happened, but its own due date is today, so calling it "not_started"/
 * "in_progress" would hide that the window is closing, and calling it "late" would be wrong since
 * the day isn't over yet. Genuinely overdue (now > dueAt, still not completed) is "late" — the
 * same label a late COMPLETION gets, since both are "this milestone missed its window" from an
 * SLA-monitoring standpoint; which one it was is still visible from completedAt being null or not.
 */
function day1SeSetupStatus(
  startedAt: string | null,
  completedAt: string | null,
  dueAtIso: string,
  nowIso: string
): Day1SeSetupStatus {
  if (completedAt) return completedAt <= dueAtIso ? "completed" : "late";
  if (nowIso > dueAtIso) return "late";
  if (toManilaDateString(nowIso) === toManilaDateString(dueAtIso)) return "at_risk";
  return startedAt ? "in_progress" : "not_started";
}

// ---------------------------------------------------------------------------------- Day 3 status

function day3Status(
  hasDataLoading: boolean,
  day2CompletedAt: string | null,
  dueAtIso: string | null,
  nowIso: string
): Day3Status | DataUnavailable {
  if (!hasDataLoading) return "not_applicable";
  // Phase 1: Day 3 shares Day 2's completion signal (the same L3 ticket reaching "For Checking"),
  // but Phase 1 has no L3 data at all — always unavailable until Phase 2, regardless of hasDataLoading.
  return DATA_UNAVAILABLE;
}

// --------------------------------------------------------------------------------- Entry point

export type PeerReviewCycleRaw = {
  enteredAt?: string;
  exitedAt?: string;
  exitedToStatus?: string;
  reviewerAtEntry?: string;
};

export type AccountCreationTicketRow = {
  issue_key: string;
  created: string;
  first_out_of_backlog_todo: string | null;
  cycle_time_end: string | null;
  resolved_datetime: string | null;
  assigned_se: string | null;
  labels: string | null;
  escalation_value: string | null;
  /** For SE Efficiency's validator/reviewer time — not SLA math, kept here only because every
   * fetch shares one row shape (same convention as lib/tool-assisted.ts's TicketRow). */
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

export function deriveTicketSla(row: AccountCreationTicketRow, nowIso: string = new Date().toISOString()): AccountCreationTicketSla {
  const created = new Date(row.created);
  const day1Date = computeDay1Date(created);
  const day2Date = computeDay2Date(day1Date);
  const day3Date = computeDay3Date(day2Date);
  const day1End = endOfManilaDayUtc(day1Date).toISOString();
  const day2End = endOfManilaDayUtc(day2Date).toISOString();
  const trackType = classifyTrackType(row.labels);
  const dataLoading = hasDataLoadingStage(row.labels);

  const day1SeSetup: Day1SeSetupMilestone = {
    status: day1SeSetupStatus(row.first_out_of_backlog_todo, row.cycle_time_end, day1End, nowIso),
    startedAt: row.first_out_of_backlog_todo,
    completedAt: row.cycle_time_end,
    dueAt: day1End,
  };

  // Ticket Escalation = L3 is unreliable for TIMING (Gaby: "only mostly populated once the ST
  // ticket is done") — flagged as a footnote only, never used to set day1L3Endorsement.status.
  const escalationFieldFlagged = (row.escalation_value || "").trim().toUpperCase() === "L3";

  const day1L3Endorsement: Day1L3EndorsementMilestone = {
    status: DATA_UNAVAILABLE, // Phase 2: needs the linked L3 ticket's own `created` timestamp
    l3IssueKey: null,
    endorsedAt: null,
    dueAt: day1End,
    escalationFieldFlagged,
  };

  const day2: Day2Milestone = {
    status: DATA_UNAVAILABLE, // Phase 2: needs the linked L3 ticket's first "For Checking" transition
    completedAt: null,
    dueAt: day2End,
  };

  const day3Due = dataLoading ? endOfManilaDayUtc(day3Date).toISOString() : null;
  const day3: Day3Milestone = {
    status: day3Status(dataLoading, null, day3Due, nowIso),
    completedAt: null,
    dueAt: day3Due,
  };

  return {
    issueKey: row.issue_key,
    trackType,
    hasDataLoading: dataLoading,
    cutoffSide: classifyCutoffSide(created),
    seName: row.assigned_se || "(unassigned)",
    created: row.created,
    day1Date: day1Date.toISOString(),
    day1SeSetup,
    day1L3Endorsement,
    day2,
    day3,
    overallStatus: rollupOverallStatus(day1SeSetup, day1L3Endorsement, day2, day3, row.resolved_datetime),
    resolvedDatetime: row.resolved_datetime,
  };
}

// ------------------------------------------------------------------------------------- Rollup

/**
 * Stage-aware precedence — never marks a downstream stage breached while Day 1 is still the
 * active stage. Written to handle real Phase 2 day1L3/day2/day3 values already, so Phase 2 only
 * has to fill those fields in; this function's branching doesn't change.
 */
export function rollupOverallStatus(
  day1SeSetup: Day1SeSetupMilestone,
  day1L3: Day1L3EndorsementMilestone,
  day2: Day2Milestone,
  day3: Day3Milestone,
  resolvedDatetime: string | null
): OverallSlaStatus | DataUnavailable {
  if (day1SeSetup.status === DATA_UNAVAILABLE) return DATA_UNAVAILABLE;
  if (day1SeSetup.status === "not_started") return "pending";
  if (day1SeSetup.status === "at_risk") return "at_risk";
  if (day1SeSetup.status === "in_progress") return "on_track";
  if (day1SeSetup.status === "late") return "breached"; // Day 1 itself is a known, confirmed miss

  // day1SeSetup.status === "completed" from here: Day 1 met its own deadline. The overall verdict
  // now depends on stages Day 1's own success says nothing about.
  const l3Bad = day1L3.status === "late" || day1L3.status === "missing";
  const day2Bad = day2.status === "late" || day2.status === "at_risk";
  const day3Bad = day3.status === "late" || day3.status === "at_risk";
  if (l3Bad || day2Bad || day3Bad) return "breached";

  if (day1L3.status === DATA_UNAVAILABLE || day2.status === DATA_UNAVAILABLE || day3.status === DATA_UNAVAILABLE) {
    // We know Day 1 succeeded but can't see L3/Day 2/Day 3 — an honest "we don't know", not a
    // guessed "on track"/"completed".
    return DATA_UNAVAILABLE;
  }

  const l3Done = day1L3.status === "endorsed";
  const day2Done = day2.status === "completed";
  const day3Done = day3.status === "completed" || day3.status === "not_applicable";
  if (l3Done && day2Done && day3Done) return resolvedDatetime ? "completed" : "on_track";
  return "on_track"; // nothing flagged yet, still progressing
}

// ------------------------------------------------------------------------ Day 1 start compliance

/**
 * Section 9's classification — a SEPARATE question from day1SeSetup.status above (Section 10:
 * "do not treat To Do -> In Progress as proof Setup was completed"). This is only about whether
 * the SE STARTED on the expected day, judged by calendar date, not by end-of-day like the setup
 * milestone — "on the expected Day 1" means any time that day counts.
 */
export type Day1StartCompliance = "started_on_time" | "started_late" | "not_started" | "not_applicable";

export function deriveDay1StartCompliance(
  startedAt: string | null,
  day1DateIso: string,
  day1EndIso: string,
  nowIso: string
): Day1StartCompliance {
  if (!day1DateIso) return "not_applicable";
  if (!startedAt) return nowIso > day1EndIso ? "not_started" : "not_applicable";
  const startedDate = toManilaDateString(startedAt);
  const day1Date = toManilaDateString(day1DateIso);
  if (!startedDate || !day1Date) return "not_applicable";
  return startedDate === day1Date ? "started_on_time" : "started_late";
}

/** Business days late, for a started_late ticket. Calendar-day diff, weekends already excluded from the comparison basis (day1Date is itself a business day, and a late start is always AFTER it). */
export function businessDaysLate(startedAt: string, day1DateIso: string): number {
  let cursor = manilaDateOnlyUtc(new Date(day1DateIso));
  const target = manilaDateOnlyUtc(new Date(startedAt));
  let days = 0;
  while (cursor.getTime() < target.getTime()) {
    cursor = nextBusinessDayUtc(cursor);
    days++;
  }
  return days;
}
