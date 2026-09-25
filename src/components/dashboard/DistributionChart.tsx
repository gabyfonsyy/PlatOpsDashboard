"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export function DistributionChart({
  title,
  data,
  labelKey,
}: {
  title: string;
  data: Record<string, unknown>[];
  labelKey: string;
}) {
  if (!data.length) {
    return (
      <div className="card p-5">
        <p className="text-sm font-medium text-neutral-700 mb-2">{title}</p>
        <p className="text-sm text-neutral-400">No data for this period.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <p className="text-sm font-medium text-neutral-700 mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="rgb(var(--n-400))" allowDecimals={false} />
          <YAxis type="category" dataKey={labelKey} tick={{ fontSize: 11 }} stroke="rgb(var(--n-400))" width={140} />
          <Tooltip />
          <Bar dataKey="count" fill="rgb(var(--a-500))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
