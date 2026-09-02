"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { P1TrendPoint } from "@/lib/p1-sla";
import { SLA_STATUS_THRESHOLDS } from "@/lib/sla-status";

/**
 * P1 volume (bars) + on-time rate (line) over time, on one chart — covers both "Overall SLA
 * Trend" and "Volume vs Resolution Performance" from the brief rather than two competing charts
 * fighting for the same vertical space.
 *
 * Colors are the theme's own CSS variables (`rgb(var(--a-500))` etc.), not hardcoded hex like
 * MetricsSeriesChart/DistributionChart — SVG presentation attributes resolve `var()` against the
 * live cascade, so this chart re-colors itself when `data-theme` changes with no JS re-render.
 */
export function SlaTrendChart({ trend }: { trend: P1TrendPoint[] }) {
  if (!trend.length || !trend.some((t) => t.created > 0)) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No P1 tickets for this period yet.</div>;
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm font-medium text-neutral-700">P1 Volume &amp; SLA Compliance Over Time</p>
        <p className="text-xs text-neutral-400">Bars: P1s created · Line: on-time rate (decided tickets only)</p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={trend}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis
            yAxisId="volume"
            tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }}
            stroke="rgb(var(--n-300))"
            allowDecimals={false}
            width={30}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }}
            stroke="rgb(var(--n-300))"
            width={40}
          />
          <Tooltip
            labelFormatter={formatBucketLabel}
            formatter={(value: number, name: string) =>
              name === "On-Time Rate" ? [value === null ? "—" : `${Math.round(value * 100)}%`, name] : [value, name]
            }
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--line))",
              borderRadius: 8,
              fontSize: 12,
              color: "rgb(var(--n-900))",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {/* SLA healthy threshold, so a period visibly dropping below the line reads at a glance. */}
          <ReferenceLine
            yAxisId="rate"
            y={SLA_STATUS_THRESHOLDS.healthy}
            stroke="rgb(var(--ok-500))"
            strokeDasharray="4 4"
            label={{ value: `${SLA_STATUS_THRESHOLDS.healthy * 100}% target`, fontSize: 10, fill: "rgb(var(--ok-700))", position: "insideTopRight" }}
          />
          <Bar yAxisId="volume" dataKey="created" name="P1s Created" fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="onTimeRate"
            name="On-Time Rate"
            stroke="rgb(var(--a-600))"
            strokeWidth={2}
            dot={{ r: 2.5 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 'YYYY-MM-DD' -> "Jul 15", 'YYYY-MM' -> "Jul 2026". Mirrors MetricsSeriesChart's formatter. */
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
