/**
 * Pure "Can We Take On More?" scenario math — no data fetching, so this is safe to import
 * straight into a client component (mirrors lib/projection.ts's split from its data-fetching
 * siblings). Per the brief's §6, the added-demand assumption is ALWAYS user-entered here, never
 * invented: callers must pass a real percentage/headcount typed in by the Engineering Lead.
 *
 * Available/Demand are expressed as a % of NOMINAL capacity (working days × headcount, before
 * leave/overhead) — the same framing lib/capacity.ts uses for its org/team cards, so a scenario's
 * "Projected" figure reads on the same scale as the snapshot it started from.
 */
import { CAPACITY_CONFIG, tierForGapPct, type CapacityTier } from "@/lib/capacity-config";

export type ScenarioType = "product" | "project" | "majorProject" | "headcount";

export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  product: "+1 Product",
  project: "+1 Project",
  majorProject: "+1 Major Project",
  headcount: "+1 Headcount",
};

export const SCENARIO_QUESTION: Record<ScenarioType, string> = {
  product: "If the team takes ownership of one additional product, what happens?",
  project: "If the team takes on another medium-sized project, what happens?",
  majorProject: "If the team takes on a high-complexity project, what happens?",
  headcount: "What would one additional FTE change?",
};

/** Starting point only — always shown as editable in the UI, never as a fixed fact. */
export function defaultAssumptionFor(type: ScenarioType): number {
  switch (type) {
    case "product":
      return CAPACITY_CONFIG.scenarioDefaults.productAddedDemandPct;
    case "project":
      return CAPACITY_CONFIG.scenarioDefaults.projectAddedDemandPct;
    case "majorProject":
      return CAPACITY_CONFIG.scenarioDefaults.majorProjectAddedDemandPct;
    case "headcount":
      return CAPACITY_CONFIG.scenarioDefaults.headcountAdded;
  }
}

export type ScenarioBaseline = {
  availableDays: number;
  demandDays: number;
  nominalDays: number;
  /** Only needed for the headcount scenario — org Available/Nominal days per existing FTE, so
   * "+N FTE" is translated into added capacity the same way today's people are counted. */
  avgAvailableDaysPerHeadcount: number;
  avgNominalDaysPerHeadcount: number;
};

export type ScenarioResult = {
  currentAvailablePct: number | null;
  currentDemandPct: number | null;
  currentGapPct: number | null;
  projectedAvailablePct: number | null;
  projectedDemandPct: number | null;
  projectedGapPct: number | null;
  projectedTier: CapacityTier;
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function computeScenario(baseline: ScenarioBaseline, type: ScenarioType, assumption: number): ScenarioResult {
  const { availableDays, demandDays, nominalDays, avgAvailableDaysPerHeadcount, avgNominalDaysPerHeadcount } = baseline;

  let projectedAvailableDays = availableDays;
  let projectedDemandDays = demandDays;
  let projectedNominalDays = nominalDays;

  if (type === "headcount") {
    const addedFte = Math.max(0, assumption);
    projectedAvailableDays = availableDays + addedFte * avgAvailableDaysPerHeadcount;
    projectedNominalDays = nominalDays + addedFte * avgNominalDaysPerHeadcount;
  } else {
    projectedDemandDays = demandDays * (1 + Math.max(0, assumption) / 100);
  }

  const currentAvailablePct = nominalDays > 0 ? round4(availableDays / nominalDays) : null;
  const currentDemandPct = nominalDays > 0 ? round4(demandDays / nominalDays) : null;
  const currentGapPct = currentAvailablePct !== null && currentDemandPct !== null ? round4(currentAvailablePct - currentDemandPct) : null;

  const projectedAvailablePct = projectedNominalDays > 0 ? round4(projectedAvailableDays / projectedNominalDays) : null;
  const projectedDemandPct = projectedNominalDays > 0 ? round4(projectedDemandDays / projectedNominalDays) : null;
  const projectedGapPct =
    projectedAvailablePct !== null && projectedDemandPct !== null ? round4(projectedAvailablePct - projectedDemandPct) : null;

  return {
    currentAvailablePct,
    currentDemandPct,
    currentGapPct,
    projectedAvailablePct,
    projectedDemandPct,
    projectedGapPct,
    projectedTier: tierForGapPct(projectedGapPct),
  };
}

export const SCENARIO_RESULT_COPY: Record<CapacityTier, string> = {
  healthy: "✅ Comfortable — capacity absorbs this without material strain.",
  watch: "⚠️ Possible, but leaves limited operational buffer.",
  highLoad: "🟠 Risky — demand would approach or exceed sustainable capacity.",
  unsustainable: "🔴 Not advisable without added capacity, scope reduction, or redistribution.",
};
