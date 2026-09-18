"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, Loader2 } from "lucide-react";
import { Copy } from "@/components/ui/Copy";
import { useTheme } from "@/components/theme/ThemeProvider";
import { DriverBreakdownTable } from "@/components/business-review/DriverBreakdownTable";
import { formatPct } from "@/lib/business-review-view";
import type { MetricComparison } from "@/lib/business-review";

function formatValue(value: number | null, unit: MetricComparison["unit"]): string {
  if (value === null) return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "days") return `${value.toFixed(2)} days`;
  return value.toLocaleString();
}

/**
 * One metric's full card: current/previous/change/%diff up top (always visible, per the brief's
 * "most important information visible without opening every card"), then progressive disclosure
 * for the driver breakdown and the data-transparency panel underneath.
 *
 * The AI-authored narrative is opt-in, per her explicit instruction: the model is called AT MOST
 * once per (metric, period, driver verdict), and only when she clicks "Get AI take" — never
 * automatically on page load. `aiAvailable` (whether AI_API_KEY is configured at all) and
 * `metric.insightSource` (whether a cached AI take already exists for this exact metric+period)
 * come from the server; this component only ever calls the model when SHE clicks, via the
 * existing api/ai/business-review-narrative route, which caches its own result so a second click
 * — or the next page load — never spends a second call.
 */
export function MetricComparisonCard({ metric, aiAvailable }: { metric: MetricComparison; aiAvailable: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { theme } = useTheme();
  const [insight, setInsight] = useState(metric.insight);
  const [insightSource, setInsightSource] = useState(metric.insightSource);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const isUp = metric.pctDiff !== null && metric.pctDiff > 0;
  const isDown = metric.pctDiff !== null && metric.pctDiff < 0;

  async function getAiTake() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/business-review-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facts: {
            metricLabel: metric.label,
            current: metric.current ?? 0,
            previous: metric.previous ?? 0,
            pctDiff: metric.pctDiff,
            isNew: metric.isNew,
            driverRows: metric.driverBreakdown,
            verdict: metric.driverVerdict,
            theme,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setInsight(body.data.narrative);
      setInsightSource("ai");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

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

      <p className="text-sm text-neutral-700 mt-3">{insight}</p>
      {insightSource === "ai" && (
        <p className="text-[11px] text-neutral-400 mt-0.5 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> <Copy serious="AI take" playful="AI's take" />
        </p>
      )}
      {aiError && <p className="text-xs text-red-600 mt-1">Could not get an AI take: {aiError}</p>}

      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-sprout-700 hover:text-sprout-800 inline-flex items-center gap-1"
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

        {aiAvailable && insightSource === "deterministic" && (
          <button
            onClick={getAiTake}
            disabled={aiLoading}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-700 inline-flex items-center gap-1 disabled:cursor-wait"
          >
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <Copy serious="Get AI take" playful="Ask AI to riff on this" />
          </button>
        )}
      </div>

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
