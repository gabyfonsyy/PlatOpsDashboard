import { resolveRegister } from "@/lib/theme";

/**
 * Review Wait Time deep-dive copy, both registers — same pattern as lib/cycle-time-view.ts. The
 * professional register already uses the brief's friendly labels ("Who is waiting?", "What's
 * getting stuck?"); Gaby's View only warms the wording further. Every number, ranking, threshold
 * and filter is identical in both — theme never reaches lib/review-wait.ts.
 *
 * Client-safe on purpose (no server imports): the client components read it, and so does the
 * target cookie below.
 */
export const REVIEW_WAIT_COPY = {
  professional: {
    pageTitleSuffix: "Review Wait Time",
    avgLabel: "Review Wait Time",
    medianLabel: "Median",
    p90Label: "P90",
    withinTargetLabel: "% Within Target",
    bigPicture: "The big picture",
    whereIsTheWait: "Where is the wait?",
    whoIsWaiting: "Who is waiting?",
    queueHealth: "Review Queue Health",
    whatsStuck: "What's getting stuck?",
    longestReviews: "Longest Reviews",
    why: "Why?",
    patterns: "Observed patterns",
    efficiency: "Review efficiency",
    trend: "Are we getting faster or slower at peer review?",
    trendChart: "Review Wait Time over time",
    queueChart: "Review queue volume over time",
    dataQuality: "Data quality",
    whatShouldIKnow: "What Should I Know?",
    queueEmpty: "Nothing waiting for review right now.",
    noData: "No completed reviews in this period.",
    reviewerCaveat:
      "Read these alongside volume and queue depth — a high average over a few reviews, or reviews that arrived into a deep queue, isn't a performance signal on its own.",
    patternsCaveat: "Observed patterns in this period's data — starting points for a conversation, not conclusions about anyone's performance.",
  },
  gaby: {
    pageTitleSuffix: "Review Wait Time",
    avgLabel: "Review Wait Time",
    medianLabel: "Typical wait",
    p90Label: "Slowest 10% start at",
    withinTargetLabel: "On target",
    bigPicture: "✨ The big picture",
    whereIsTheWait: "Where is the wait?",
    whoIsWaiting: "Who is waiting?",
    queueHealth: "Review Queue Health",
    whatsStuck: "What's getting stuck?",
    longestReviews: "Longest Reviews",
    why: "Why is it waiting?",
    patterns: "Things I noticed",
    efficiency: "How smooth is review?",
    trend: "Are we getting faster or slower?",
    trendChart: "Wait time trajectory",
    queueChart: "Queue volume over time",
    dataQuality: "Data health check",
    whatShouldIKnow: "What Should I Know?",
    queueEmpty: "Queue's clear — nothing waiting on a reviewer. 🎉",
    noData: "No reviews finished in this window yet.",
    reviewerCaveat:
      "Context first: someone with 3 reviews and a high average isn't the same story as someone carrying half the queue. Volume and queue depth are right there for a reason.",
    patternsCaveat: "Patterns, not verdicts — these are where to look, not who to blame.",
  },
} as const;

export type ReviewWaitCopy = { readonly [K in keyof (typeof REVIEW_WAIT_COPY)["professional"]]: string };

export function reviewWaitCopy(theme: string | undefined): ReviewWaitCopy {
  return resolveRegister<ReviewWaitCopy>(theme, REVIEW_WAIT_COPY);
}

/**
 * The configurable review-time target, as a per-browser cookie override on top of the Q1+Q2
 * 2026 baseline — same posture as the excluded-labels / automation-labels cookies. Absent = use
 * the baseline. Stored in MINUTES.
 */
export const REVIEW_TARGET_COOKIE = "platops-review-wait-target";

export function parseReviewTargetCookie(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(decodeURIComponent(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Client-side only. `null` clears the override (back to the baseline). */
export function persistReviewTargetCookie(minutes: number | null): void {
  try {
    document.cookie =
      minutes === null
        ? `${REVIEW_TARGET_COOKIE}=; path=/; max-age=0; samesite=lax`
        : `${REVIEW_TARGET_COOKIE}=${Math.round(minutes)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // Cookies blocked: the server keeps using the baseline.
  }
}

/** Minutes -> "0.28" (days, 2 dp). The headline unit on this page, like Cycle Time's. */
export function fmtDays(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined ? "—" : (minutes / 1440).toFixed(2);
}

/** Minutes -> "6h 42m" / "2d 3h" / "18m" — the human sublabel under a days value. */
export function fmtDur(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const total = Math.round(minutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  return n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`;
}

/** Segmentation keys carry a sort prefix ("3 · Wed") so they order naturally; strip it for display. */
export function segmentLabel(key: string): string {
  return key.replace(/^\d+ · /, "");
}
