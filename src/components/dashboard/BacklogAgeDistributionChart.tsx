"use client";

import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { BacklogAgingDeepDiveReport } from "@/lib/backlog-aging";
import { formatAgeDays } from "@/lib/format";

/**
 * How CURRENT open backlog spreads across age buckets — answers "is the typical ticket young,
 * even if a few very old ones exist?" Bars are clickable to scope the ticket table below,
 * mirroring LeadTimeDistributionChart's interaction pattern. A low median next to a high P90/
 * oldest is exactly the "aging-tail" signal brief section 18 asks to surface.
 */
export function BacklogAgeDistributionChart({
  distribution,
  currentAge,
  selectedBucket,
  onSelectBucket,
  title,
}: {
  distribution: BacklogAgingDeepDiveReport["ageDistribution"];
  currentAge: BacklogAgingDeepDiveReport["currentAge"];
  selectedBucket?: string | null;
  onSelectBucket?: (label: string | null) => void;
  title?: string;
}) {
  const total = distribution.reduce((s, b) => s + b.count, 0);
  if (!total) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No open backlog for this selection.</div>;
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-medium text-neutral-700">{title ?? "Current Backlog Age Distribution"}</p>
        <p className="text-xs text-neutral-400">{onSelectBucket ? "Click a bar to scope the ticket table below" : "How current open backlog spreads across age ranges"}</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={distribution} margin={{ left: 4, right: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={30} />
          <Tooltip
            formatter={(value: number) => [`${value} ticket${value === 1 ? "" : "s"}`, "Open"]}
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
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Median</p>
          <p className="text-sm font-semibold text-neutral-900">{formatAgeDays(currentAge.medianAgeDays)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">P75</p>
          <p className="text-sm font-semibold text-neutral-900">{formatAgeDays(currentAge.p75AgeDays)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">P90</p>
          <p className="text-sm font-semibold text-neutral-900">{formatAgeDays(currentAge.p90AgeDays)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Oldest</p>
          <p className="text-sm font-semibold text-neutral-900">{formatAgeDays(currentAge.oldestAgeDays)}</p>
        </div>
      </div>
    </div>
  );
}
