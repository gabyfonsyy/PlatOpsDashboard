/**
 * Shared status-tier vocabulary for the P1 SLA Compliance page — one place to tune thresholds
 * rather than scattering magic numbers across the KPI card, the trend chart's reference line, and
 * the at-risk ticket table. Two SEPARATE tier systems, because they answer different questions:
 *
 *   SlaStatus  — how healthy is the period's COMPLIANCE RATE (a % already computed from decided
 *                tickets). Read top-down: healthy is the good end.
 *   RiskTier   — how close is ONE STILL-OPEN ticket to breaching its own due date (a fraction of
 *                its own SLA window consumed). Read bottom-up: critical is the urgent end.
 *
 * Both compress to the same three Badge tones (success/warning/danger) since that's what
 * src/components/ui/Badge.tsx actually offers — a fourth distinct hue was deliberately not added
 * to the design system just for this page (see the P1 SLA build's design-reuse brief). Critical
 * is visually distinguished from At Risk not by a new color but by reusing the existing
 * `.signal-critical` pulse convention (globals.css / TaskBoard.tsx) on top of the same danger tone.
 */

export type SlaStatus = "healthy" | "watch" | "atRisk" | "critical";
export type RiskTier = "healthy" | "watch" | "atRisk" | "critical";

/** On-time RATE thresholds (fraction, 0-1). >= healthy is Healthy, down to < atRisk is Critical. */
export const SLA_STATUS_THRESHOLDS = {
  healthy: 0.95,
  watch: 0.9,
  atRisk: 0.8,
};

/** % of a ticket's OWN due-date window already elapsed (0-1+) for a still-open, not-yet-due P1. */
export const RISK_TIER_THRESHOLDS = {
  watch: 0.5,
  atRisk: 0.75,
  critical: 0.9,
};

export function slaStatusForRate(rate: number | null): SlaStatus | null {
  if (rate === null) return null;
  if (rate >= SLA_STATUS_THRESHOLDS.healthy) return "healthy";
  if (rate >= SLA_STATUS_THRESHOLDS.watch) return "watch";
  if (rate >= SLA_STATUS_THRESHOLDS.atRisk) return "atRisk";
  return "critical";
}

export function riskTierForConsumed(consumedFraction: number): RiskTier {
  if (consumedFraction >= RISK_TIER_THRESHOLDS.critical) return "critical";
  if (consumedFraction >= RISK_TIER_THRESHOLDS.atRisk) return "atRisk";
  if (consumedFraction >= RISK_TIER_THRESHOLDS.watch) return "watch";
  return "healthy";
}

export const STATUS_LABEL: Record<SlaStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  atRisk: "At Risk",
  critical: "Critical",
};

/** Badge's tone union — kept local rather than imported so this file has no component dependency. */
export type BadgeTone = "neutral" | "warning" | "success" | "danger";

export const STATUS_TONE: Record<SlaStatus, BadgeTone> = {
  healthy: "success",
  watch: "warning",
  atRisk: "danger",
  critical: "danger",
};

/** `--ok-500` etc. — for anything driving `.signal`'s `--signal-rgb` custom property directly. */
export const STATUS_SIGNAL_VAR: Record<SlaStatus, string> = {
  healthy: "var(--ok-500)",
  watch: "var(--warn-500)",
  atRisk: "var(--danger-500)",
  critical: "var(--danger-500)",
};
