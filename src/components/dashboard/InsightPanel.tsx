import { Sparkles, Wrench, GitBranch, Boxes, BookOpen } from "lucide-react";
import type { CachedInsight, InsightRecommendation } from "@/lib/metrics";
import { formatManilaDateTime } from "@/lib/format";
import { GenerateInsightButton } from "@/components/dashboard/GenerateInsightButton";

/**
 * Displays a STORED insight. Rendering this never triggers AI — it reads whatever is already in
 * INSIGHTS_CACHE, so opening or refreshing a page costs zero requests. Generation happens only
 * when someone presses the button.
 *
 * The "Generated N ago" line is load-bearing rather than decoration: it's what makes clear the
 * paragraph is cached and possibly stale, which is the honest trade for not regenerating it
 * constantly.
 *
 * `label` names the team when several of these are stacked (the Overview). On a team page the
 * page title already says which team it is, so it's left off there rather than repeated.
 */
export function InsightPanel({
  insight,
  scope,
  label,
}: {
  insight: CachedInsight;
  scope: string;
  label?: string;
}) {
  const hasInsight = Boolean(insight && insight.status === "SUCCESS");

  if (!hasInsight) {
    return (
      <div className="card p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-neutral-300 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-neutral-500">
              {label ? <span className="font-medium text-neutral-700">{label}</span> : null}
              {label ? " — " : null}
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

  const recommendations = insight!.recommendations ?? [];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sprout-600" />
          <p className="text-sm font-medium text-neutral-900">
            AI Insight{label ? ` — ${label}` : ""} · {formatPeriod(insight!.period)}
          </p>
          {/* Exact Manila timestamp, plus the coarse relative age. The relative age is what makes
              "this is cached and possibly stale" obvious at a glance; the exact time is what you
              quote when comparing two cards or checking whether a regeneration actually landed. */}
          <span className="text-xs text-neutral-400 whitespace-nowrap">
            {formatManilaDateTime(insight!.generatedAt)}
            {relativeTime(insight!.generatedAt) && ` · ${relativeTime(insight!.generatedAt)}`}
          </span>
        </div>
        <GenerateInsightButton scope={scope} hasInsight />
      </div>

      <p className="text-sm text-neutral-700 leading-relaxed">{insight!.narrative}</p>

      {recommendations.length > 0 && (
        <div className="mt-5 pt-4 border-t border-line/70">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
            What to improve
          </p>
          <ol className="space-y-3">
            {recommendations.map((r, i) => (
              <RecommendationRow key={`${r.signal}-${i}`} recommendation={r} index={i} />
            ))}
          </ol>
        </div>
      )}

      {insight!.flags.length > 0 && (
        <div className="mt-4 pt-4 border-t border-line/70">
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

/**
 * Three lines in a deliberate order: what to do, why (the measured evidence), then the mechanism.
 *
 * The evidence sits in the middle rather than as a footnote because it's the part that came from
 * the data — the title and the action are the model's wording around it, and a reader deciding
 * whether to act on this needs the number in the same glance as the suggestion.
 */
function RecommendationRow({
  recommendation: r,
  index,
}: {
  recommendation: InsightRecommendation;
  index: number;
}) {
  const category = CATEGORY_STYLES[r.category] ?? CATEGORY_STYLES.process;
  const Icon = category.icon;

  return (
    <li className="flex gap-3">
      <span className="text-xs text-neutral-400 tabular-nums pt-0.5 w-4 shrink-0">{index + 1}.</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-neutral-900">{r.title}</span>
          <span className={`badge gap-1 ${category.className}`}>
            <Icon className="w-3 h-3" />
            {r.category}
          </span>
        </div>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{r.evidence}</p>
        <p className="text-sm text-neutral-700 mt-1 leading-relaxed">
          <span className="text-sprout-600 mr-1">→</span>
          {r.action}
        </p>
      </div>
    </li>
  );
}

/**
 * Understated on purpose — the chip is there to let you scan for "which of these is an automation
 * I could build this week", not to compete with the recommendation itself for attention.
 */
const CATEGORY_STYLES = {
  automation: { icon: Wrench, className: "bg-sprout-50 text-sprout-700" },
  process: { icon: GitBranch, className: "bg-neutral-100 text-neutral-600" },
  systems: { icon: Boxes, className: "bg-neutral-100 text-neutral-600" },
  documentation: { icon: BookOpen, className: "bg-neutral-100 text-neutral-600" },
} as const;

/**
 * "2026-08" -> "Aug 2026". Anything that isn't a plain month label is passed through untouched
 * rather than guessed at, so an unexpected value shows as itself instead of "Invalid Date".
 */
function formatPeriod(period: string | undefined): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? ""));
  if (!match) return String(period ?? "");
  const [, year, month] = match;
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
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
