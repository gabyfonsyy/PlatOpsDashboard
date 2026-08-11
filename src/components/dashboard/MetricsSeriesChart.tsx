"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { TicketMetrics } from "@/lib/metrics";

/**
 * `date` is either a daily 'yyyy-MM-dd' or (quarter/year ranges roll up to monthly) a 'yyyy-MM'
 * label — never a time component, but format defensively anyway so the axis/tooltip never shows
 * one even if a value ever round-trips through something that appends one (e.g. a serialized
 * Date). Renders "Jul 15" for daily points, "Jul 2026" for monthly ones.
 */
function formatSeriesDate(value: string): string {
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

export function MetricsSeriesChart({ series }: { series: TicketMetrics["series"] }) {
  if (!series.length) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No data for this period yet.</div>;
  }

  return (
    <div className="card p-5">
      <p className="text-sm font-medium text-neutral-700 mb-4">Ticket Volume Trend</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6e1f0" />
          <XAxis dataKey="date" tickFormatter={formatSeriesDate} tick={{ fontSize: 11 }} stroke="#a89bc0" />
          <YAxis tick={{ fontSize: 11 }} stroke="#a89bc0" allowDecimals={false} />
          <Tooltip labelFormatter={formatSeriesDate} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="created" stroke="#9863a8" strokeWidth={2} dot={false} name="Created" />
          <Line type="monotone" dataKey="resolved" stroke="#d391b0" strokeWidth={2} dot={false} name="Resolved" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
