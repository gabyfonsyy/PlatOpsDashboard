"use client";

import { useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { CycleTimeDistributions, CycleTimePercentiles } from "@/lib/lead-cycle-time";

function fmtDays(minutes: number | null): string {
  return minutes === null ? "N/A" : `${(minutes / 1440).toFixed(2)}d`;
}

type MetricKey = "total" | "doer" | "validator";

/**
 * How completed work spreads across Cycle Time ranges. For a peer-review team, a tab switches
 * between Doer / Validator / Total (section 9 of the brief asks for each to be inspectable on its
 * own — a single blended histogram would hide whether execution or validation is the one with the
 * long tail). Bars stay clickable to scope the ticket table below, same as the Lead Time
 * deep-dive's distribution chart, but ONLY on the Total tab — a click while viewing Doer/Validator
 * would filter by a bucket that doesn't correspond to the ticket table's own Total-based column.
 */
export function CycleTimeDistributionChart({
  distribution,
  percentiles,
  hasDoerValidatorSplit,
  metricLabels,
  selectedBucket,
  onSelectBucket,
}: {
  distribution: CycleTimeDistributions;
  percentiles: CycleTimePercentiles;
  hasDoerValidatorSplit: boolean;
  metricLabels: { total: string; doer: string; validator: string };
  selectedBucket?: string | null;
  onSelectBucket?: (label: string | null) => void;
}) {
  const [metric, setMetric] = useState<MetricKey>("total");
  const activeMetric = hasDoerValidatorSplit ? metric : "total";

  const rows = activeMetric === "total" ? distribution.total : activeMetric === "doer" ? distribution.doer ?? [] : distribution.validator ?? [];
  const pct = activeMetric === "total" ? percentiles.total : activeMetric === "doer" ? percentiles.doer : percentiles.validator;
  const total = rows.reduce((s, b) => s + b.count, 0);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <p className="text-sm font-medium text-neutral-700">Cycle Time Distribution</p>
        {hasDoerValidatorSplit && (
          <div className="flex gap-1">
            {(["total", "doer", "validator"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  activeMetric === k ? "bg-sprout-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {metricLabels[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-neutral-400 mb-3">
        {activeMetric === "validator" ? "Over tickets that were actually reviewed. " : ""}
        {activeMetric === "total" && onSelectBucket ? "Click a bar to scope the ticket table below." : "How work spreads across ranges."}
      </p>

      {total === 0 ? (
        <div className="py-10 text-center text-sm text-neutral-400">
          {activeMetric === "validator" ? "No reviewed tickets in this period yet." : "No completed tickets for this period yet."}
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ left: 4, right: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
              <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={30} />
              <Tooltip
                formatter={(value: number) => [`${value} ticket${value === 1 ? "" : "s"}`, "Count"]}
                contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12, color: "rgb(var(--n-900))" }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {rows.map((b) => (
                  <Cell
                    key={b.label}
                    fill={activeMetric === "total" && selectedBucket && selectedBucket !== b.label ? "rgb(var(--n-200))" : "rgb(var(--a-500))"}
                    cursor={activeMetric === "total" && onSelectBucket ? "pointer" : undefined}
                    onClick={activeMetric === "total" ? () => onSelectBucket?.(selectedBucket === b.label ? null : b.label) : undefined}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-neutral-100">
            {(["p50", "p75", "p90", "p95"] as const).map((k) => (
              <div key={k}>
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">{k.toUpperCase()}</p>
                <p className="text-sm font-semibold text-neutral-900">{fmtDays(pct?.[k] ?? null)}</p>
              </div>
            ))}
          </div>
          {pct && (pct.p90 === null || pct.p95 === null) && (
            <p className="text-xs text-neutral-400 mt-2">P90/P95 need a larger sample this period — shown as N/A below that threshold.</p>
          )}
        </>
      )}
    </div>
  );
}
