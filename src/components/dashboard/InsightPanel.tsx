import { Sparkles } from "lucide-react";
import type { CachedInsight } from "@/lib/metrics";
import { GenerateInsightButton } from "@/components/dashboard/GenerateInsightButton";

/**
 * Displays a STORED insight. Rendering this never triggers AI — it reads whatever is already in
 * INSIGHTS_CACHE, so opening or refreshing a page costs zero requests. Generation happens only
 * when someone presses the button.
 *
 * The "Generated N ago" line is load-bearing rather than decoration: it's what makes clear the
 * paragraph is cached and possibly stale, which is the honest trade for not regenerating it
 * constantly.
 */
export function InsightPanel({ insight, scope }: { insight: CachedInsight; scope: string }) {
  const hasInsight = Boolean(insight && insight.status === "SUCCESS");

  if (!hasInsight) {
    return (
      <div className="card p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-neutral-300 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-neutral-500">
              {insight?.status === "FAILED"
                ? "The last insight attempt didn't complete."
                : "No AI insight for this period yet."}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              Insights are generated on request, not on a schedule.
            </p>
          </div>
        </div>
        <GenerateInsightButton scope={scope} hasInsight={false} />
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sprout-600" />
          <p className="text-sm font-medium text-neutral-900">AI Insight — {insight!.period}</p>
          <span className="text-xs text-neutral-400">{relativeTime(insight!.generatedAt)}</span>
        </div>
        <GenerateInsightButton scope={scope} hasInsight />
      </div>

      <p className="text-sm text-neutral-700 leading-relaxed">{insight!.narrative}</p>

      {insight!.flags.length > 0 && (
        <div className="mt-4 pt-4 border-t border-neutral-100">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">Flagged for review</p>
          <ul className="space-y-1">
            {insight!.flags.map((f, i) => (
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

/** "3 hours ago" — deliberately coarse; the point is staleness, not precision. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
