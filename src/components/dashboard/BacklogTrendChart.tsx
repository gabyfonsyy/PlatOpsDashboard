"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { BacklogTrendPoint } from "@/lib/backlog-aging";

/** 'YYYY-MM-DD' -> "Jul 15", 'YYYY-MM' -> "Jul 2026". Mirrors every other trend chart's formatter. */
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
 * Incoming vs Completed (bars) + running Net (line) within the selected period — answers "are we
 * keeping up with incoming work?" (brief section 15). Opening/Ending Backlog are point-in-time
 * snapshots shown as summary cards elsewhere on the page, not on this chart — this chart is
 * about FLOW within the period, not the two boundary snapshots.
 */
export function BacklogTrendChart({ trend, incomingLabel, completedLabel, title }: { trend: BacklogTrendPoint[]; incomingLabel: string; completedLabel: string; title?: string }) {
  if (!trend.length || !trend.some((t) => t.incoming > 0 || t.completed > 0)) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No activity for this period yet.</div>;
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm font-medium text-neutral-700">{title ?? "Backlog Trend"}</p>
        <p className="text-xs text-neutral-400">Bars: {incomingLabel.toLowerCase()} vs {completedLabel.toLowerCase()} · Line: net change</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={trend}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
          <Tooltip
            labelFormatter={formatBucketLabel}
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--line))",
              borderRadius: 8,
              fontSize: 12,
              color: "rgb(var(--n-900))",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="incoming" name={incomingLabel} fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
          <Bar dataKey="completed" name={completedLabel} fill="rgb(var(--n-300))" radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="net" name="Net Change" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
