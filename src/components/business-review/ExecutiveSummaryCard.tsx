import { Copy } from "@/components/ui/Copy";
import { formatPct } from "@/lib/business-review-view";
import type { ExecutiveSummary } from "@/lib/business-review";

/**
 * Answers the brief's 5 executive-summary questions at a glance: what changed, which metrics moved
 * most, and what's worth investigating — everything else on the page is detail behind this.
 */
export function ExecutiveSummaryCard({ summary }: { summary: ExecutiveSummary }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-neutral-900">
        <Copy serious="Executive Summary" playful="✨ The Period in Orbit" />
      </h2>

      {summary.keyChanges.length === 0 ? (
        <p className="text-sm text-neutral-400 mt-2">Nothing moved enough this period to call out.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {summary.keyChanges.map((change) => {
            const isUp = change.pctDiff !== null && change.pctDiff > 0;
            const isDown = change.pctDiff !== null && change.pctDiff < 0;
            return (
              <div key={change.metricKey} className="flex items-start gap-2 text-sm">
                <span className="shrink-0" aria-hidden>
                  {isUp ? "📈" : isDown ? "📉" : "⬜"}
                </span>
                <p className="text-neutral-700">
                  <span className="font-medium text-neutral-900">{change.label}</span>{" "}
                  <span className={isUp ? "text-emerald-700" : isDown ? "text-red-600" : "text-neutral-500"}>
                    {formatPct(change.pctDiff)}
                  </span>
                  {" — "}
                  {change.insight}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {summary.investigate.length > 0 && (
        <div className="mt-4 pt-3 border-t border-neutral-100">
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
            <Copy serious="Things to Investigate" playful="🔭 Worth a Closer Look" />
          </h3>
          <ul className="mt-2 space-y-1 list-disc list-inside text-sm text-neutral-600">
            {summary.investigate.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
