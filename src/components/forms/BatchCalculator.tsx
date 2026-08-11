"use client";

import { useState } from "react";
import { computeProjection } from "@/lib/projection";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

type Field = "totalItems" | "batchSize" | "batchesPerWeek" | "startDate" | "targetDate";

/** Standalone bidirectional batch/projection calculator (not tied to a saved project). */
export function BatchCalculator() {
  const [v, setV] = useState<Record<Field, string>>({
    totalItems: "",
    batchSize: "",
    batchesPerWeek: "",
    startDate: "",
    targetDate: "",
  });

  const set = (f: Field) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((prev) => ({ ...prev, [f]: e.target.value }));

  const p = computeProjection({
    totalItems: v.totalItems,
    batchSize: v.batchSize,
    batchesPerWeek: v.batchesPerWeek,
    startDate: v.startDate || null,
    targetDate: v.targetDate || null,
  });

  const dash = (n?: number) => (n === undefined ? "—" : n.toLocaleString());

  return (
    <div className="card p-5 border-t-4 border-t-sprout-400">
      <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-sprout-500" />
        Batch Projection Calculator
      </h2>
      <p className="text-sm text-neutral-500 mt-1">
        Fixed batch size at a weekly cadence. Fill total items + batch size, then either a cadence
        (→ completion date) or a target date (→ required cadence).
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
        <div>
          <label className="form-label">Total Items</label>
          <input type="number" min={0} value={v.totalItems} onChange={set("totalItems")} className="form-input" placeholder="500" />
        </div>
        <div>
          <label className="form-label">Batch Size</label>
          <input type="number" min={0} value={v.batchSize} onChange={set("batchSize")} className="form-input" placeholder="50" />
        </div>
        <div>
          <label className="form-label">Batches / Week</label>
          <input type="number" min={0} step="0.5" value={v.batchesPerWeek} onChange={set("batchesPerWeek")} className="form-input" placeholder="2" />
        </div>
        <div>
          <label className="form-label">Start Date</label>
          <input type="date" value={v.startDate} onChange={set("startDate")} className="form-input" />
        </div>
        <div>
          <label className="form-label">Target Date</label>
          <input type="date" value={v.targetDate} onChange={set("targetDate")} className="form-input" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
        <Stat label="Total Batches" value={dash(p.totalBatches)} sub={p.itemsPerWeek ? `${p.itemsPerWeek.toLocaleString()} items/week` : undefined} />
        <Stat
          label="Projected Completion"
          value={p.completionDate ? formatManilaDate(p.completionDate) : "—"}
          sub={p.weeksNeeded ? `${p.weeksNeeded} week${p.weeksNeeded === 1 ? "" : "s"} at current cadence` : "enter a cadence"}
          badge={p.onTrack === null ? undefined : p.onTrack ? <Badge tone="success">On track</Badge> : <Badge tone="danger">Behind target</Badge>}
        />
        <Stat
          label="Required Cadence"
          value={p.requiredBatchesPerWeek ? `${p.requiredBatchesPerWeek}/week` : "—"}
          sub={
            p.requiredBatchesPerWeek
              ? `${dash(p.requiredItemsPerWeek)} items/week over ${p.weeksAvailable} week${p.weeksAvailable === 1 ? "" : "s"}`
              : "enter a target date"
          }
        />
      </div>
    </div>
  );
}

function Stat({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
        {badge}
      </div>
      <p className="text-xl font-semibold text-neutral-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-500 mt-0.5">{sub}</p>}
    </div>
  );
}
