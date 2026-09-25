import type { DriverRow, DriverVerdict, MixShiftFlag } from "@/lib/business-review-drivers";

/**
 * Prompt-building for Business Review Prep's AI-authored explanation prose. Mirrors
 * api/ai/incident-feedback/route.ts's split exactly: the HARD RULES below make "use only the
 * facts given, never invent a cause/number" explicit and non-negotiable, the same discipline that
 * route's FEEDBACK_SYSTEM_PROMPT already enforces for a different feature. The model never sees
 * raw ticket data or decides what caused anything — it only receives the deterministic engine's
 * (lib/business-review-drivers.ts) already-computed verdict and rephrases it as prose.
 */

export const NARRATIVE_SYSTEM_PROMPT = [
  "You write one short business-review sentence from a pre-computed set of facts about a metric change.",
  "",
  "HARD RULES:",
  "- Use ONLY the numbers and dimension names given in the facts below. Never invent a cause, a number, a percentage, a team, or a dimension not present in the input.",
  "- Never contradict the given verdict (confirmed / possible / none). If verdict is \"none\" and no mix-shift fact is given, say plainly that no clear driver was found — do not speculate a cause to fill the sentence.",
  "- If a mix-shift fact IS given, that means no single category's own pace explains the change, but a shift in which categories the volume falls into does, for roughly the given % of the change. Say that plainly instead of naming any one category as the driver.",
  "- 1-3 sentences. Plain business language, specific over generic.",
  "- Respond with a JSON object only: {\"narrative\": \"...\"}.",
].join("\n");

export type NarrativeFacts = {
  metricLabel: string;
  current: number;
  previous: number;
  pctDiff: number | null;
  isNew: boolean;
  driverRows: DriverRow[];
  verdict: DriverVerdict;
  /** "adhd" gets the Gaby-View voice via lib/ai-voice.ts's voiceForTheme; anything else is Standard. */
  theme: string;
  /** Duration metrics (Lead/Cycle Time) only — see buildDurationDriver's doc comment. Null/undefined
   * for every count/rate-based metric, and whenever mix shift isn't the dominant unexplained factor. */
  mixShift?: MixShiftFlag | null;
};

/**
 * The generic ai_insight_cache table (my-work.sql) keys on (user_email, context, entity_id,
 * source_version) — this is the ONE place that decides what those last two mean for Business
 * Review Prep narratives, shared by lib/business-review.ts's cache READ (on every page render,
 * fast, never calls the model) and api/ai/business-review-narrative/route.ts's cache READ+WRITE
 * (only on an explicit "get AI take" click). Both must compute the identical key from the same
 * facts, or a click's result would never be found by the next render's read.
 */
export const NARRATIVE_CACHE_CONTEXT = "business_review_narrative";

export function narrativeCacheKey(facts: Pick<NarrativeFacts, "metricLabel" | "current" | "previous" | "driverRows" | "verdict" | "theme" | "mixShift">) {
  return {
    entityId: facts.metricLabel,
    version: JSON.stringify({ c: facts.current, p: facts.previous, d: facts.driverRows, v: facts.verdict, t: facts.theme, m: facts.mixShift ?? null }),
  };
}

export function buildNarrativePrompt(facts: NarrativeFacts): string {
  const topDrivers = facts.driverRows
    .filter((r) => r.key !== "Other")
    .slice(0, 4)
    .map((r) => `  - ${r.key}: ${r.previous} -> ${r.current} (${r.change > 0 ? "+" : ""}${r.change}, contribution ${r.contribution === null ? "n/a" : `${Math.round(r.contribution * 1000) / 10}%`})`)
    .join("\n");

  return [
    "FACTS (the only source of truth — do not add to this):",
    `- Metric: ${facts.metricLabel}`,
    `- Previous: ${facts.previous}`,
    `- Current: ${facts.current}`,
    `- % change: ${facts.isNew ? "n/a (no prior-period baseline)" : facts.pctDiff === null ? "n/a (no activity)" : `${facts.pctDiff.toFixed(2)}%`}`,
    `- Driver verdict: ${facts.verdict}`,
    "- Top driver rows (dimension: previous -> current, change, contribution to total change):",
    topDrivers || "  (none)",
    facts.mixShift
      ? `- Mix shift: no single category's own pace explains the change; a shift in ticket mix accounts for roughly ${Math.round(Math.abs(facts.mixShift.pctOfTotalChange ?? 0) * 1000) / 10}% of it.`
      : "",
    "",
    "Write the narrative now, following the HARD RULES exactly.",
  ].join("\n");
}
