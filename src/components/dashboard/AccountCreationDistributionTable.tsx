import { formatNumber } from "@/lib/format";
import type { CycleTimeBucket } from "@/lib/account-creation-report";

/**
 * SE Cycle Time bucketed distribution — same proportional-bar convention as CountRankTable
 * (components/dashboard/BreakdownTables.tsx), but bucket rows aren't a CountRow (they carry a
 * minute range too), so this is its own small component rather than a reuse.
 */
export function AccountCreationDistributionTable({ buckets }: { buckets: CycleTimeBucket[] }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">SE Cycle Time Distribution</h3>
        <p className="text-xs text-neutral-400 mt-0.5">To Do → For Peer Review, bucketed.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3 text-right">Tickets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {total === 0 ? (
            <tr>
              <td colSpan={2} className="px-4 py-6 text-center text-neutral-400">No measurable cycle times in this period.</td>
            </tr>
          ) : (
            buckets.map((b) => (
              <tr key={b.label}>
                <td className="px-4 py-2.5 text-neutral-900">
                  {b.label}
                  <span className="block mt-1 h-1 rounded-full bg-sprout-100 overflow-hidden">
                    <span
                      className="block h-full bg-sprout-500"
                      style={{ width: max ? `${Math.max(2, (b.count / max) * 100)}%` : "0%" }}
                    />
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap align-top">{formatNumber(b.count)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
