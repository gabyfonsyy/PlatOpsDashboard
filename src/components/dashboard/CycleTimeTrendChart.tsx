"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CycleTimeTrendPoint } from "@/lib/lead-cycle-time";

function toDays(minutes: number | null): number | null {
  return minutes === null ? null : Math.round((minutes / 1440) * 100) / 100;
}

/** 'YYYY-MM-DD' -> "Jul 15", 'YYYY-MM' -> "Jul 2026". Mirrors LeadTimeTrendChart's formatter. */
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

/**
 * Volume + Cycle Time over time. For a peer-review team (hasDoerValidatorSplit), Doer and
 * Validator medians are STACKED bars so their sum reads as the total at a glance — the brief
 * asks not just "is it improving" but "which side is responsible for the change" (section 6).
 * For DBA/DevOps, falls back to the Lead Time deep-dive's own shape: one volume bar plus
 * median/avg lines, since there's no split to visualize.
 */
export function CycleTimeTrendChart({ trend, hasDoerValidatorSplit, title }: { trend: CycleTimeTrendPoint[]; hasDoerValidatorSplit: boolean; title: string }) {
  if (!trend.length || !trend.some((t) => t.count > 0)) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No completed tickets for this period yet.</div>;
  }

  if (hasDoerValidatorSplit) {
    const data = trend.map((t) => ({
      ...t,
      doerDays: toDays(t.medianDoerMinutes),
      validatorDays: toDays(t.medianValidatorMinutes),
    }));
    return (
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-4">
          <p className="text-sm font-medium text-neutral-700">{title}</p>
          <p className="text-xs text-neutral-400">Stacked bars: median Doer + Validator (days) · Line: tickets completed</p>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
            <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
            <YAxis yAxisId="days" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={36} />
            <YAxis yAxisId="volume" orientation="right" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
            <Tooltip
              labelFormatter={formatBucketLabel}
              formatter={(value: number, name: string) => (name === "Tickets Completed" ? [value, name] : [value === null ? "—" : `${value}d`, name])}
              contentStyle={tooltipStyle}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="days" dataKey="doerDays" name="Median Doer" stackId="cycle" fill="rgb(var(--a-500))" radius={[0, 0, 0, 0]} />
            <Bar yAxisId="days" dataKey="validatorDays" name="Median Validator" stackId="cycle" fill="rgb(var(--n-300))" radius={[3, 3, 0, 0]} />
            <Line yAxisId="volume" type="monotone" dataKey="count" name="Tickets Completed" stroke="rgb(var(--n-500))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const data = trend.map((t) => ({ ...t, medianDays: toDays(t.medianTotalMinutes), avgDays: toDays(t.avgTotalMinutes) }));
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        <p className="text-xs text-neutral-400">Bars: tickets completed · Lines: median &amp; average Cycle Time (days)</p>
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
            contentStyle={tooltipStyle}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="volume" dataKey="count" name="Tickets Completed" fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
          <Line yAxisId="days" type="monotone" dataKey="medianDays" name="Median Cycle Time" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
          <Line yAxisId="days" type="monotone" dataKey="avgDays" name="Avg Cycle Time" stroke="rgb(var(--n-400))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
