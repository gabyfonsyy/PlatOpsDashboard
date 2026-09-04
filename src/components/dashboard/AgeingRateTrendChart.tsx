"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { AgeingRateTrendPoint } from "@/lib/backlog-aging";

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

/**
 * Historical Ageing Rate — resolved volume (bars) + the rate itself (line), always shown
 * together so a spike in the line next to a tiny bar reads as "small sample," not "crisis"
 * (brief section 25/47: never average daily/weekly percentages, and always show volume next to
 * the rate). The rate per bucket is aggregated resolved/beyondDue for that bucket, not an
 * average of per-ticket percentages.
 */
export function AgeingRateTrendChart({ trend, title }: { trend: AgeingRateTrendPoint[]; title?: string }) {
  if (!trend.length || !trend.some((t) => t.resolved > 0)) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No resolved tickets for this period yet.</div>;
  }

  const data = trend.map((t) => ({ ...t, ratePct: t.rate === null ? null : Math.round(t.rate * 1000) / 10 }));

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm font-medium text-neutral-700">{title ?? "Ageing Rate Trend"}</p>
        <p className="text-xs text-neutral-400">Bars: tickets resolved · Line: Ageing Rate</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis yAxisId="volume" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
          <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={36} unit="%" />
          <Tooltip
            labelFormatter={formatBucketLabel}
            formatter={(value: number, name: string) => (name === "Tickets Resolved" ? [value, name] : [value === null ? "—" : `${value}%`, name])}
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--line))",
              borderRadius: 8,
              fontSize: 12,
              color: "rgb(var(--n-900))",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="volume" dataKey="resolved" name="Tickets Resolved" fill="rgb(var(--n-200))" radius={[3, 3, 0, 0]} />
          <Line yAxisId="rate" type="monotone" dataKey="ratePct" name="Ageing Rate" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
