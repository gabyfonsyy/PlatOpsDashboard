"use client";

import { useState } from "react";
import {
  computeScenario,
  defaultAssumptionFor,
  SCENARIO_LABELS,
  SCENARIO_QUESTION,
  SCENARIO_RESULT_COPY,
  type ScenarioBaseline,
  type ScenarioType,
} from "@/lib/capacity-scenario";
import { CAPACITY_TIER_LABEL } from "@/lib/capacity-config";

const SCENARIO_TYPES: ScenarioType[] = ["product", "project", "majorProject", "headcount"];

function pct(p: number | null): string {
  return p === null ? "—" : `${Math.round(p * 100)}%`;
}

/**
 * "Can We Take On More Work?" — brief §6. The assumption is ALWAYS a number the Engineering Lead
 * types in here; nothing is fabricated. Recomputes live on every keystroke, mirroring
 * BatchCalculator.tsx's no-submit-button pattern.
 */
export function CapacityScenarioPanel({ baseline, title }: { baseline: ScenarioBaseline; title: string }) {
  const [type, setType] = useState<ScenarioType>("product");
  const [assumption, setAssumption] = useState<number>(defaultAssumptionFor("product"));

  const selectType = (t: ScenarioType) => {
    setType(t);
    setAssumption(defaultAssumptionFor(t));
  };

  const result = computeScenario(baseline, type, assumption);
  const isHeadcount = type === "headcount";

  return (
    <div className="card p-5 border-t-4 border-t-sprout-400">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      <p className="text-sm text-neutral-500 mt-1">
        Pick a scenario, then type in your own assumption — this page never invents an effort estimate for you.
      </p>

      <div className="flex flex-wrap gap-2 mt-4">
        {SCENARIO_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => selectType(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              type === t ? "bg-sprout-100 border-sprout-300 text-sprout-800" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {SCENARIO_LABELS[t]}
          </button>
        ))}
      </div>

      <p className="text-xs text-neutral-500 mt-3 italic">{SCENARIO_QUESTION[type]}</p>

      <div className="flex items-end gap-3 mt-3">
        <div>
          <label className="form-label">{isHeadcount ? "Additional FTEs" : "Estimated added demand (%)"}</label>
          <input
            type="number"
            min={0}
            step={isHeadcount ? 1 : 0.5}
            value={assumption}
            onChange={(e) => setAssumption(Number(e.target.value) || 0)}
            className="form-input w-32"
          />
        </div>
        <p className="text-xs text-neutral-400 pb-2">Starting suggestion only — override freely.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Current</p>
          <p className="text-xl font-semibold text-neutral-900 mt-1">{pct(result.currentGapPct)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {pct(result.currentDemandPct)} demand vs. {pct(result.currentAvailablePct)} available
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Projected</p>
          <p className="text-xl font-semibold text-neutral-900 mt-1">{pct(result.projectedGapPct)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {pct(result.projectedDemandPct)} demand vs. {pct(result.projectedAvailablePct)} available
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-neutral-200 p-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-neutral-700">{SCENARIO_RESULT_COPY[result.projectedTier]}</p>
        <span className="text-xs font-medium text-neutral-500">{CAPACITY_TIER_LABEL[result.projectedTier]}</span>
      </div>
    </div>
  );
}
