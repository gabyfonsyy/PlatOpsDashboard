"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { TicketMetrics } from "@/lib/metrics";

export function MetricsSeriesChart({ series }: { series: TicketMetrics["series"] }) {
  if (!series.length) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No data for this period yet.</div>;
  }

  return (
    <div className="card p-5">
      <p className="text-sm font-medium text-neutral-700 mb-4">Ticket Volume Trend</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="created" stroke="#18a558" strokeWidth={2} dot={false} name="Created" />
          <Line type="monotone" dataKey="resolved" stroke="#6b7280" strokeWidth={2} dot={false} name="Resolved" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
