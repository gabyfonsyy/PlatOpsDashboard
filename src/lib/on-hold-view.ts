import { resolveRegister } from "@/lib/theme";

/**
 * On-Hold Wait Time deep-dive copy, both registers — same pattern as lib/escalation-view.ts. Every
 * number, ranking and filter is identical in both; theme never reaches lib/on-hold.ts. Client-safe.
 */
export const ON_HOLD_COPY = {
  professional: {
    howMuch: "How much time are we waiting?",
    waitLabel: "On-Hold Wait Time",
    heldLabel: "Tickets On Hold",
    currentLabel: "Currently On Hold",
    totalLabel: "Total On-Hold Time",
    cycleShareLabel: "Cycle Time On Hold",
    efficiency: "Supporting measures",
    whatShouldIKnow: "What Should I Know?",
    whyWaiting: "What's keeping us waiting?",
    whyWaitingCaveat:
      "By Ticket Holding Reason, per hold. Frequency (how often) and impact (how much time) are shown side by side. A rare reason can still cost the most time.",
    leaders: "Largest sources of On-Hold time",
    howBad: "Who's been waiting the longest?",
    howBadCaveat: "The current queue is a live snapshot, not limited to the selected period. Holds still open aren't counted in the averages above.",
    queue: "Current On-Hold queue",
    stale: "Needs attention",
    longest: "Longest completed holds",
    whereNext: "Where do tickets go after the wait?",
    whereNextCaveat: "The status each hold ended in. Archived and Rejected are kept as their own outcomes, not counted as work resuming.",
    matrix: "Holding reason × next status",
    cycle: "How much of our cycle is waiting?",
    cycleCaveat:
      "How time is split, not what caused it. Cycle Time counts only holds between leaving To Do and reaching review. Lead Time counts every hold.",
    timeSplit: "Where does ticket time go?",
    whoHolds: "Where is On-Hold time concentrated?",
    whoHoldsCaveat:
      "Ticket mix, requester response and outside dependencies all drive hold time. Read each row with its ticket count. This is an observed pattern, not a ranking of people or teams.",
    repeat: "Repeat holds",
    isItChanging: "Is it changing?",
    reasonTrend: "Holding reasons over time",
    tickets: "Hold episodes",
    dataQuality: "Data quality",
  },
  gaby: {
    howMuch: "✨ How much time are we waiting?",
    waitLabel: "On-Hold Wait Time",
    heldLabel: "Went on hold",
    currentLabel: "Waiting right now",
    totalLabel: "Total time waiting",
    cycleShareLabel: "Cycle spent waiting",
    efficiency: "The small print",
    whatShouldIKnow: "What Should I Know?",
    whyWaiting: "What's keeping us waiting?",
    whyWaitingCaveat: "How often each reason comes up vs how much time it eats. Those two aren't the same thing!",
    leaders: "The biggest time sinks",
    howBad: "Who's been waiting the longest?",
    howBadCaveat: "The queue is live right now, whatever period you picked. Open holds stay out of the averages until they finish.",
    queue: "Waiting right now",
    stale: "Needs a nudge",
    longest: "Longest finished waits",
    whereNext: "Where do tickets go after the wait?",
    whereNextCaveat: "Archived and Rejected stay as themselves. Those aren't \"back to work\".",
    matrix: "Why it waited → where it went",
    cycle: "How much of our cycle is waiting?",
    cycleCaveat: "Where the time goes, not why. Cycle = To Do → review; Lead = every hold.",
    timeSplit: "Where does ticket time go?",
    whoHolds: "Where is the waiting piling up?",
    whoHoldsCaveat: "Lots of things outside our control drive this. Always read it with the ticket count. Patterns, not blame.",
    repeat: "Back on hold again",
    isItChanging: "Is it changing?",
    reasonTrend: "What we're waiting on, over time",
    tickets: "Every hold",
    dataQuality: "Data health check",
  },
} as const;

export type OnHoldCopy = { readonly [K in keyof (typeof ON_HOLD_COPY)["professional"]]: string };

export function onHoldCopy(theme: string | undefined): OnHoldCopy {
  return resolveRegister<OnHoldCopy>(theme, ON_HOLD_COPY);
}

/**
 * A duration in the unit that reads best at its size (the brief's rule): a day or more reads as
 * "2.4 days" with the "2d 9h 36m" breakdown under it; under a day reads as "6h 42m" with "0.28 days"
 * under it, so the two always convert into each other.
 */
export function fmtHold(minutes: number | null | undefined): { primary: string; secondary: string | undefined } {
  if (minutes === null || minutes === undefined) return { primary: "—", secondary: undefined };
  if (minutes >= 1440) {
    const days = minutes / 1440;
    return { primary: `${days.toFixed(1)} day${days.toFixed(1) === "1.0" ? "" : "s"}`, secondary: breakdown(minutes) };
  }
  return { primary: breakdown(minutes), secondary: `${(minutes / 1440).toFixed(2)} days` };
}

/** "2d 9h 36m" / "6h 42m" / "18m". */
export function breakdown(minutes: number): string {
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

/** One-string version for sentences and deltas: "2.4 days" or "6h 42m". */
export function holdText(minutes: number | null | undefined): string {
  return fmtHold(minutes).primary;
}

/**
 * Stale-hold threshold, a per-browser cookie override on top of the Q1+Q2 2026 P75 hold — same
 * posture as the Review Wait target cookie. Stored in MINUTES; absent = use the baseline P75.
 */
export const ON_HOLD_THRESHOLD_COOKIE = "platops-on-hold-threshold";

export function parseOnHoldThresholdCookie(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(decodeURIComponent(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Client-side only. `null` clears the override (back to the baseline P75). */
export function persistOnHoldThresholdCookie(minutes: number | null): void {
  try {
    document.cookie =
      minutes === null
        ? `${ON_HOLD_THRESHOLD_COOKIE}=; path=/; max-age=0; samesite=lax`
        : `${ON_HOLD_THRESHOLD_COOKIE}=${Math.round(minutes)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // Cookies blocked: the server keeps using the baseline.
  }
}
