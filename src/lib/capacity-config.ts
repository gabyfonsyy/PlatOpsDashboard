/**
 * Configurable assumptions and thresholds for the Capacity & Health page — the single place an
 * Engineering Lead edits when the model needs tuning, same pattern as the constants in
 * lib/sla-status.ts and lib/teams.ts. Nothing here is measured; every value is a labelled
 * assumption because this app has no meeting/admin-overhead, effort-estimate, or per-person
 * project-assignment data (see the Capacity & Health build's own plan for the full data audit).
 * Every UI surface that uses one of these must say so, not present it as fact.
 */
export const CAPACITY_CONFIG = {
  /**
   * Share of a working day assumed to go to meetings, admin, and coordination overhead not
   * captured anywhere in this app's data. Applied to Available Capacity. Pure assumption —
   * there is no calendar/meeting integration to measure this from.
   */
  operationalOverheadPct: 0.12,

  /** A standard workday, for converting avgCycleTimeMinutes into a days-based Demand Load. */
  minutesPerWorkday: 480,

  /** Mon–Fri only; this app tracks no team-specific work-week or holiday calendar. */
  workingDaysPerWeek: 5,

  /**
   * Assumption: team-days of capacity ONE active project is assumed to consume per month,
   * split evenly across the team's roster since no per-person project assignment exists yet.
   * Applied at the team level, not derived from any stored effort estimate.
   */
  assumedTeamDaysPerActiveProjectPerMonth: 5,

  /**
   * Capacity Gap tiering — Gap % = (Available − Demand) / Available. Thresholds are the
   * lower bound of each tier, evaluated top-down.
   */
  gapThresholds: {
    healthy: 0.1, // >= 10% buffer
    watch: 0, // 0–10% buffer
    highLoad: -0.15, // -15%–0% (demand exceeds capacity by up to 15%)
    // < -15% is Unsustainable
  },

  /**
   * "Elevated pressure" thresholds — when a team/person crosses one of these, the computed gap
   * tier is bumped up one notch (never down), mirroring lib/backlog-aging.ts's bumpRiskTier
   * pattern: a healthy-looking gap can still mask real operational strain from overdue/escalated
   * work or a growing backlog.
   */
  elevated: {
    slaOverdueRate: 0.15,
    escalationRate: 0.15,
    backlogAgingRate: 0.25,
  },

  /** Backlog-aging-rate tiering for the team comparison table's Backlog column. */
  backlogRateThresholds: { low: 0.1, medium: 0.25 }, // >= medium is High

  /** Active-project-count tiering for the team comparison table's Project Load column. */
  projectLoadThresholds: { low: 1, medium: 3 }, // 0–1 Low, 2–3 Medium, 4+ High

  /**
   * Knowledge & Ownership Risk proxy: flag a product when one person accounts for at least this
   * share of the team's resolved tickets for it in the lookback window. A concentration proxy,
   * not a stored ownership record — labelled Medium/Low confidence wherever shown.
   */
  ownershipConcentrationThreshold: 0.6,
  /** Minimum resolved-ticket sample for a product before the concentration proxy is trusted at all. */
  ownershipMinSampleSize: 5,

  /**
   * Default starting assumptions for the "Can We Take On More?" scenario calculator — always
   * user-editable in the UI (per the brief's §6: "allow the user to enter an assumption rather
   * than fabricating one"). These are just the pre-filled starting points.
   */
  scenarioDefaults: {
    productAddedDemandPct: 8,
    projectAddedDemandPct: 6,
    majorProjectAddedDemandPct: 15,
    headcountAdded: 1,
  },

  /** Trend lookback for the Demand vs Capacity chart and the Headcount Case's streak detection. */
  trendWeeks: 12,
} as const;

export type CapacityTier = "healthy" | "watch" | "highLoad" | "unsustainable";

export const CAPACITY_TIER_LABEL: Record<CapacityTier, string> = {
  healthy: "🟢 Healthy Buffer",
  watch: "🟡 Watch",
  highLoad: "🟠 High Load",
  unsustainable: "🔴 Unsustainable",
};

/** Badge's tone union only has 4 values (lib/sla-status.ts collapses a 4-tier scale into these
 * same 3 tones + neutral) — the emoji in CAPACITY_TIER_LABEL carries the fourth distinction. */
export type CapacityBadgeTone = "neutral" | "warning" | "success" | "danger";

export const CAPACITY_TIER_TONE: Record<CapacityTier, CapacityBadgeTone> = {
  healthy: "success",
  watch: "warning",
  highLoad: "warning",
  unsustainable: "danger",
};

function tierRank(t: CapacityTier): number {
  return { healthy: 0, watch: 1, highLoad: 2, unsustainable: 3 }[t];
}

/** Gap % -> base tier, before any elevated-pressure bump. */
export function tierForGapPct(gapPct: number | null): CapacityTier {
  if (gapPct === null) return "watch";
  const t = CAPACITY_CONFIG.gapThresholds;
  if (gapPct >= t.healthy) return "healthy";
  if (gapPct >= t.watch) return "watch";
  if (gapPct >= t.highLoad) return "highLoad";
  return "unsustainable";
}

/** Never downgrades — an elevated pressure signal can only push the tier toward Unsustainable. */
export function bumpTier(tier: CapacityTier, shouldBump: boolean): CapacityTier {
  if (!shouldBump) return tier;
  const order: CapacityTier[] = ["healthy", "watch", "highLoad", "unsustainable"];
  return order[Math.min(tierRank(tier) + 1, order.length - 1)];
}

export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "High Confidence",
  medium: "Medium Confidence",
  low: "Low Confidence",
};

export type ThreeTier = "low" | "medium" | "high";

export function backlogRateTier(rate: number | null): ThreeTier {
  if (rate === null) return "low";
  const t = CAPACITY_CONFIG.backlogRateThresholds;
  if (rate >= t.medium) return "high";
  if (rate >= t.low) return "medium";
  return "low";
}

export function projectCountTier(count: number): ThreeTier {
  const t = CAPACITY_CONFIG.projectLoadThresholds;
  if (count > t.medium) return "high";
  if (count > t.low) return "medium";
  return "low";
}

export const THREE_TIER_LABEL: Record<ThreeTier, string> = { low: "Low", medium: "Medium", high: "High" };
export const THREE_TIER_TONE: Record<ThreeTier, CapacityBadgeTone> = { low: "success", medium: "warning", high: "danger" };
