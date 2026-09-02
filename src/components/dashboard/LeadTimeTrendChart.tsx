"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { LeadTimeTrendPoint } from "@/lib/lead-cycle-time";

function toDays(minutes: number | null): number | null {
  return minutes === null ? null : Math.round((minutes / 1440) * 100) / 100;
}

/**
 * Volume (bars) + median & average Lead Time (lines) over time, on one chart — covers both "Are
 * we getting faster or slower?" and the volume/Lead-Time relationship from the brief, the same
 * way SlaTrendChart fuses P1 volume + on-time rate rather than two competing charts. Colors are
 * the theme's own CSS variables so this re-colors itself on theme change with no re-render.
 */
export function LeadTimeTrendChart({ trend }: { trend: LeadTimeTrendPoint[] }) {
  if (!trend.length || !trend.some((t) => t.count > 0)) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No completed tickets for this period yet.</div>;
  }

  const data = trend.map((t) => ({ ...t, medianDays: toDays(t.medianMinutes), avgDays: toDays(t.avgMinutes) }));

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm font-medium text-neutral-700">Lead Time Over Time</p>
        <p className="text-xs text-neutral-400">Bars: tickets completed · Lines: median &amp; average Lead Time (days)</p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis yAxisId="volume" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
          <YAxis yAxisId="days" orientation="right" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={36} />
          <Tooltip
            labelFormatter={formatBucketLabel}
            formatter={(value: number, name: string) => (name === "Tickets Completed" ? [value, name] : [value === null ? "—" : `${value}d`, name])}
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--line))",
              borderRadius: 8,
              fontSize: 12,
              color: "rgb(var(--n-900))",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="volume" dataKey="count" name="Tickets Completed" fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
          <Line yAxisId="days" type="monotone" dataKey="medianDays" name="Median Lead Time" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
          <Line yAxisId="days" type="monotone" dataKey="avgDays" name="Avg Lead Time" stroke="rgb(var(--n-400))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 'YYYY-MM-DD' -> "Jul 15", 'YYYY-MM' -> "Jul 2026". Mirrors SlaTrendChart's formatter. */
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
