import Link from "next/link";
import { ChevronRight, Info, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/lib/sla-status";

export function MetricCard({
  label,
  value,
  sublabel,
  tooltip,
  href,
  className,
  badge,
  trend,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tooltip?: string;
  /** When set, the whole card becomes a link to a drill-down page (e.g. Backlog Aging -> ticket list). */
  href?: string;
  /** Extra classes on the card shell — e.g. `adhd-happy` to give a good-news card ambient drift. */
  className?: string;
  /** Optional status pill next to the label — e.g. "Healthy"/"At Risk" for an SLA rate. Reuses the
   * existing Badge tones rather than a bespoke color. */
  badge?: { label: string; tone: BadgeTone };
  /** Optional direction + magnitude vs a comparison period, shown under the value. `positive`
   * colors the arrow/text success-green regardless of direction (a metric where "up" is bad, e.g.
   * overdue count, should pass direction="down" with positive=true). */
  trend?: { direction: "up" | "down" | "flat"; label: string; positive: boolean | null };
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</p>
        {tooltip && (
          <span className="group relative inline-flex">
            <Info className="w-3.5 h-3.5 text-neutral-300 hover:text-neutral-500 cursor-help transition-colors" />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56
                         rounded-lg bg-neutral-900 text-white text-[11px] leading-snug font-normal normal-case tracking-normal
                         px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30 shadow-lg"
            >
              {tooltip}
            </span>
          </span>
        )}
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {href && <ChevronRight className="w-3.5 h-3.5 text-neutral-300 ml-auto" />}
      </div>
      <p className="text-2xl font-semibold text-neutral-900 mt-1">{value}</p>
      {sublabel && <p className="text-xs text-neutral-400 mt-1">{sublabel}</p>}
      {trend && (
        <p
          className={`text-xs mt-1 flex items-center gap-1 ${
            trend.positive === null ? "text-neutral-400" : trend.positive ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {trend.direction === "up" && <TrendingUp className="w-3 h-3" />}
          {trend.direction === "down" && <TrendingDown className="w-3 h-3" />}
          {trend.label}
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`card card-interactive p-5 block ${className ?? ""}`}>
        {body}
      </Link>
    );
  }

  return <div className={`card p-5 ${className ?? ""}`}>{body}</div>;
}
