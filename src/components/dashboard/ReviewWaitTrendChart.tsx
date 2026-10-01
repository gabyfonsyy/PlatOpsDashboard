"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ReviewTrendPoint, ReviewWaitGrain } from "@/lib/review-wait";
import { fmtDur } from "@/lib/review-wait-view";
import { cn } from "@/lib/utils";

function toDays(minutes: number | null): number | null {
  return minutes === null ? null : Math.round((minutes / 1440) * 100) / 100;
}

/** 'YYYY-MM-DD' -> "Jul 15", 'YYYY-MM' -> "Jul 2026" — same as CycleTimeTrendChart's. */
function formatBucketLabel(value: string): string {
  const parts = String(value).slice(0, 10).split("-").map(Number);
  if (parts.length >= 3 && !Number.isNaN(parts[2])) {
    const [y, m, d] = parts;
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (parts.length >= 2 && !Number.isNaN(parts[1])) {
    const [y, m] = parts;
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return String(value);
}

const tooltipStyle = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--line))",
  borderRadius: 8,
  fontSize: 12,
  color: "rgb(var(--n-900))",
};

const GRAINS: { key: ReviewWaitGrain; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

/** Daily/Weekly/Monthly — re-buckets server-side via the `grain` URL param (same pattern as FilterBar). */
export function GrainToggle({ active }: { active: ReviewWaitGrain }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const select = (g: ReviewWaitGrain) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("grain", g);
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  return (
    <div className={cn("flex items-center gap-1 bg-neutral-100 rounded-lg p-1 w-fit transition-opacity", isPending && "opacity-60")}>
      {GRAINS.map((g) => (
        <button
          key={g.key}
          onClick={() => select(g.key)}
          disabled={isPending}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:cursor-wait",
            active === g.key ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          )}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The page's bottom row: "Are we getting faster or slower at peer review?" Two charts side by side
 * rather than one dual-axis tangle — Historical Review Wait Time (finished reviews, by the bucket
 * they entered review) and the Review Queue (arrivals + how many were sitting in it at each
 * bucket's end). Kept apart on purpose: the brief says never to mix finished-review wait with
 * current queue age into one number, and one chart would invite exactly that reading.
 */
export function ReviewWaitTrendChart({
  trend, grain, title, waitTitle, queueTitle, targetMinutes,
}: {
  trend: ReviewTrendPoint[];
  grain: ReviewWaitGrain;
  title: string;
  waitTitle: string;
  queueTitle: string;
  targetMinutes: number | null;
}) {
  const data = trend.map((t) => ({
    ...t,
    medianDays: toDays(t.medianMinutes),
    avgDays: toDays(t.avgMinutes),
    p90Days: toDays(t.p90Minutes),
  }));
  const hasData = trend.some((t) => t.completed > 0 || t.entered > 0);
  const targetDays = toDays(targetMinutes);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2>{title}</h2>
        <GrainToggle active={grain} />
      </div>
      {!hasData ? (
        <div className="card p-8 text-center text-sm text-neutral-400">No reviews in this period yet.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
              <p className="text-sm font-medium text-neutral-700">{waitTitle}</p>
              <p className="text-xs text-neutral-400">Days · finished reviews{targetDays !== null && ` · target ${fmtDur(targetMinutes)}`}</p>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
                <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
                <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={36} />
                <Tooltip
                  labelFormatter={formatBucketLabel}
                  formatter={(value: number, name: string) => [value === null || value === undefined ? "—" : `${value}d (${fmtDur(value * 1440)})`, name]}
                  contentStyle={tooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="medianDays" name="Median" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
                <Line type="monotone" dataKey="avgDays" name="Average" stroke="rgb(var(--n-400))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                <Line type="monotone" dataKey="p90Days" name="P90 (10+ reviews)" stroke="rgb(var(--a-300))" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
              <p className="text-sm font-medium text-neutral-700">{queueTitle}</p>
              <p className="text-xs text-neutral-400">Bars: entered review · Line: in queue at {grain === "day" ? "end of day" : grain === "week" ? "end of week" : "end of month"}</p>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
                <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
                <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
                <Tooltip labelFormatter={formatBucketLabel} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="entered" name="Entered review" fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="queueAtEnd" name="Waiting in queue" stroke="rgb(var(--a-600))" strokeWidth={2} dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
