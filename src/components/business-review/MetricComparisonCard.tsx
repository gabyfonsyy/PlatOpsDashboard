"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Copy } from "@/components/ui/Copy";
import { DriverBreakdownTable } from "@/components/business-review/DriverBreakdownTable";
import { formatPct } from "@/lib/business-review-view";
import type { MetricComparison } from "@/lib/business-review";

function formatValue(value: number | null, unit: MetricComparison["unit"]): string {
  if (value === null) return "—";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "minutes") return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} min`;
  return value.toLocaleString();
}

/**
 * One metric's full card: current/previous/change/%diff up top (always visible, per the brief's
 * "most important information visible without opening every card"), then progressive disclosure
 * for the driver breakdown and the data-transparency panel underneath.
 */
export function MetricComparisonCard({ metric }: { metric: MetricComparison }) {
  const [expanded, setExpanded] = useState(false);
  const isUp = metric.pctDiff !== null && metric.pctDiff > 0;
  const isDown = metric.pctDiff !== null && metric.pctDiff < 0;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{metric.label}</p>
          <p className="text-2xl font-semibold text-neutral-900 mt-1">{formatValue(metric.current, metric.unit)}</p>
          <p className="text-xs text-neutral-400 mt-1">
            Previous: {formatValue(metric.previous, metric.unit)}
            {metric.absoluteDiff !== null && (
              <>
                {" · Change: "}
                {metric.absoluteDiff > 0 ? "+" : ""}
                {metric.absoluteDiff}
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className={`text-sm font-semibold ${
              metric.isNew ? "text-neutral-500" : isUp ? "text-emerald-700" : isDown ? "text-red-600" : "text-neutral-400"
            }`}
          >
            {metric.isNew ? "New" : formatPct(metric.pctDiff)}
          </p>
          {metric.anomaly?.flagged && (
            <p className="text-xs text-amber-600 mt-1">
              <Copy serious="⚠ Unusual change" playful="👽 Off the usual orbit" />
            </p>
          )}
        </div>
      </div>

      <p className="text-sm text-neutral-700 mt-3">{metric.insight}</p>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-medium text-sprout-700 hover:text-sprout-800 inline-flex items-center gap-1"
      >
        {expanded ? (
          <>
            <Copy serious="Hide details" playful="Tuck this back in" /> <ChevronUp className="w-3.5 h-3.5" />
          </>
        ) : (
          <>
            <Copy serious="What caused the change? / View data" playful="🪐 What moved the needle?" />{" "}
            <ChevronDown className="w-3.5 h-3.5" />
          </>
        )}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-neutral-100">
          {metric.driverAvailable ? (
            <DriverBreakdownTable rows={metric.driverBreakdown} dimensionLabel={metric.driverDimensionLabel ?? "Dimension"} />
          ) : (
            <p className="text-sm text-neutral-400 py-2">No driver breakdown is computed for this metric yet.</p>
          )}

          <div className="mt-4 text-xs text-neutral-400 space-y-0.5">
            <p className="font-medium text-neutral-500 uppercase tracking-wide mb-1">
              <Copy serious="Data Source" playful="📜 The Fine Print" />
            </p>
            <p>Source: {metric.source}</p>
            <p>Calculation: {metric.calculation}</p>
            <p>Records included: {metric.recordCount.toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}
