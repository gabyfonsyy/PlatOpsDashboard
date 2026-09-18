import type { Theme } from "@/lib/theme";
import { topDriver, type DriverRow, type DriverVerdict } from "@/lib/business-review-drivers";

/**
 * Theme-aware, DATA-DEPENDENT copy for Business Review Prep's per-metric insight sentences.
 * Deliberately separate from the static <Copy serious playful> pairs used for section headers
 * (those are fixed strings and belong directly in the components, matching lib/nav.ts's
 * pre-hydration-safe pattern) — this file's output depends on the computed numbers, the same split
 * lib/ticket-outcomes-view.ts's ticketOutcomeCopy already establishes for dynamic copy.
 *
 * Every sentence here is built entirely from already-computed facts (metric label, % diff, driver
 * rows, verdict) — never a place to add new interpretation. lib/business-review-ai.ts's prose is
 * the *optional* upgrade over this; this is what renders instantly and what renders when the AI
 * call is unavailable or fails.
 */

export function formatPct(pctDiff: number | null): string {
  if (pctDiff === null) return "—";
  const sign = pctDiff > 0 ? "+" : "";
  return `${sign}${pctDiff.toFixed(1)}%`;
}

function topDriverPhrase(rows: DriverRow[]): { key: string; change: number } | null {
  const top = topDriver(rows);
  return top ? { key: top.key, change: top.change } : null;
}

/**
 * The deterministic fallback/instant-paint sentence, per the brief's section 7 confirmed/possible/
 * no-clear-driver distinction. Template strings only — no model call. See lib/business-review-ai.ts
 * for the optional AI-authored upgrade over this same set of facts.
 */
export function buildInsightSentence(
  metricLabel: string,
  pctDiff: number | null,
  isNew: boolean,
  driverRows: DriverRow[],
  verdict: DriverVerdict,
  theme: Theme
): string {
  const gaby = theme === "adhd";
  const pctText = formatPct(pctDiff);
  const direction = pctDiff === null ? "changed" : pctDiff > 0 ? "increased" : pctDiff < 0 ? "decreased" : "held steady";

  if (isNew) {
    return gaby
      ? `👣 ${metricLabel} showed up brand new this period — nothing to compare it to yet.`
      : `${metricLabel} has no prior-period baseline to compare against (previous period was zero).`;
  }
  if (pctDiff === null) {
    return gaby ? `😴 ${metricLabel} was quiet — no activity either period.` : `${metricLabel} shows no activity in either period.`;
  }

  const driver = topDriverPhrase(driverRows);

  if (verdict === "confirmed" && driver) {
    return gaby
      ? `🚀 ${metricLabel} ${direction} ${pctText} this period. The main passenger on this rocket? ${driver.key}, which moved by ${driver.change > 0 ? "+" : ""}${driver.change}.`
      : `${metricLabel} ${direction} ${pctText}, primarily driven by ${driver.key} (${driver.change > 0 ? "+" : ""}${driver.change}).`;
  }
  if (verdict === "possible" && driver) {
    return gaby
      ? `🛰️ ${metricLabel} ${direction} ${pctText}. ${driver.key} looks like a contributor (${driver.change > 0 ? "+" : ""}${driver.change}), but it's not sitting alone at the top.`
      : `${metricLabel} ${direction} ${pctText}. ${driver.key} is a possible contributor (${driver.change > 0 ? "+" : ""}${driver.change}), though causality isn't conclusively established.`;
  }
  return gaby
    ? `🤷 ${metricLabel} ${direction} ${pctText}, but nothing in the data points clearly at why — cause not determined from available data.`
    : `${metricLabel} ${direction} ${pctText}. Cause not determined from available data.`;
}
