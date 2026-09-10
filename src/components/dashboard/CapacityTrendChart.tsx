"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CapacityTrendPoint } from "@/lib/capacity";

function formatWeekLabel(value: string): string {
  const parts = String(value).slice(0, 10).split("-").map(Number);
  if (parts.length >= 3 && !Number.isNaN(parts[2])) {
    const [y, m, d] = parts;
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return String(value);
}

/**
 * Org-wide Demand vs. Capacity over the last 12 weeks. Ported model, not a fresh per-week
 * recompute — see lib/capacity.ts's getCapacityTrend doc comment for the exact simplifications
 * (avg cycle time and headcount held constant at today's values, leave assigned to a record's
 * start-week, the assumption-based project-days term left out entirely).
 */
export function CapacityTrendChart({ points, consecutiveWeeksOverThreshold, title }: { points: CapacityTrendPoint[]; consecutiveWeeksOverThreshold: number; title: string }) {
  if (!points.length) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No trend data available.</div>;
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        <p className="text-xs text-neutral-400">Weekly, last {points.length} weeks · lines cross where demand exceeds capacity</p>
      </div>
      {consecutiveWeeksOverThreshold >= 3 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 mb-3 inline-block">
          Demand has exceeded estimated sustainable capacity for {consecutiveWeeksOverThreshold} consecutive weeks.
        </p>
      )}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={points}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="weekEnding" tickFormatter={formatWeekLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={40} label={{ value: "days", angle: -90, position: "insideLeft", fontSize: 11, fill: "rgb(var(--n-400))" }} />
          <Tooltip
            labelFormatter={formatWeekLabel}
            formatter={(value: number) => `${value.toFixed(1)} days`}
            contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12, color: "rgb(var(--n-900))" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="availableDays" name="Available Capacity" stroke="rgb(var(--ok-500))" strokeWidth={2.5} dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="demandDays" name="Demand" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
