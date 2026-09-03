"use client";

import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { LeadTimeDistributionBucket, LeadTimePercentiles } from "@/lib/lead-cycle-time";

function fmtDays(minutes: number | null): string {
  return minutes === null ? "N/A" : `${(minutes / 1440).toFixed(2)}d`;
}

/**
 * How completed work spreads across Lead Time ranges — answers "is the average actually
 * representative, or is a long tail dragging it around?" Bars are clickable to scope the ticket
 * detail table below (see LeadTimeDeepDive); percentiles render underneath as plain numbers
 * rather than reference lines, since a histogram's x-axis is categorical, not continuous.
 */
export function LeadTimeDistributionChart({
  distribution,
  percentiles,
  selectedBucket,
  onSelectBucket,
  title,
}: {
  distribution: LeadTimeDistributionBucket[];
  percentiles: LeadTimePercentiles;
  selectedBucket?: string | null;
  onSelectBucket?: (label: string | null) => void;
  title?: string;
}) {
  const total = distribution.reduce((s, b) => s + b.count, 0);
  if (!total) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No completed tickets for this period yet.</div>;
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-medium text-neutral-700">{title ?? "Lead Time Distribution"}</p>
        <p className="text-xs text-neutral-400">{onSelectBucket ? "Click a bar to scope the ticket table below" : "How completed work spreads across Lead Time ranges"}</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={distribution} margin={{ left: 4, right: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={30} />
          <Tooltip
            formatter={(value: number) => [`${value} ticket${value === 1 ? "" : "s"}`, "Count"]}
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--line))",
              borderRadius: 8,
              fontSize: 12,
              color: "rgb(var(--n-900))",
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {distribution.map((b) => (
              <Cell
                key={b.label}
                fill={selectedBucket && selectedBucket !== b.label ? "rgb(var(--n-200))" : "rgb(var(--a-500))"}
                cursor={onSelectBucket ? "pointer" : undefined}
                onClick={() => onSelectBucket?.(selectedBucket === b.label ? null : b.label)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-neutral-100">
        {(["p50", "p75", "p90", "p95"] as const).map((k) => (
          <div key={k}>
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">{k.toUpperCase()}</p>
            <p className="text-sm font-semibold text-neutral-900">{fmtDays(percentiles[k])}</p>
          </div>
        ))}
      </div>
      {(percentiles.p90 === null || percentiles.p95 === null) && (
        <p className="text-xs text-neutral-400 mt-2">P90/P95 need a larger sample this period — shown as N/A below that threshold.</p>
      )}
    </div>
  );
}
