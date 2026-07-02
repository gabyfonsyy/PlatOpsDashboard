import { Sparkles } from "lucide-react";
import type { CachedInsight } from "@/lib/metrics";

export function InsightPanel({ insight }: { insight: CachedInsight }) {
  if (!insight || insight.status !== "SUCCESS") {
    return (
      <div className="card p-5 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-neutral-300 shrink-0 mt-0.5" />
        <p className="text-sm text-neutral-400">
          {insight?.status === "FAILED"
            ? "Insight temporarily unavailable — check back after the next daily refresh."
            : "No AI insight generated yet for this period."}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-sprout-600" />
        <p className="text-sm font-medium text-neutral-900">AI Insight — {insight.period}</p>
      </div>
      <p className="text-sm text-neutral-700 leading-relaxed">{insight.narrative}</p>

      {insight.flags.length > 0 && (
        <div className="mt-4 pt-4 border-t border-neutral-100">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">Flagged for review</p>
          <ul className="space-y-1">
            {insight.flags.map((f, i) => (
              <li key={i} className="text-sm text-neutral-600">
                <span className="font-medium text-neutral-900">{f.employee}</span> — {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
