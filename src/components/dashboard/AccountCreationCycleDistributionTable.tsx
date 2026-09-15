import { formatNumber } from "@/lib/format";
import type { CycleTimeBucket } from "@/lib/account-creation-report";

/**
 * SE Work vs. Peer Review cycle-time distribution, side by side — same proportional-bar
 * convention as AccountCreationDistributionTable/CountRankTable, just two bucket sets instead of
 * one so it's obvious at a glance which stage actually eats the time (Section 13B).
 */
function DistributionColumn({ title, subtitle, buckets }: { title: string; subtitle: string; buckets: CycleTimeBucket[] }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div>
      <div className="px-4 py-3">
        <h4 className="text-xs font-semibold text-neutral-900 uppercase tracking-wide">{title}</h4>
        <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-neutral-100">
          {total === 0 ? (
            <tr>
              <td className="px-4 py-6 text-center text-neutral-400">No measurable cycle times.</td>
            </tr>
          ) : (
            buckets.map((b) => (
              <tr key={b.label}>
                <td className="px-4 py-2 text-neutral-900 text-xs">
                  {b.label}
                  <span className="block mt-1 h-1 rounded-full bg-sprout-100 overflow-hidden">
                    <span className="block h-full bg-sprout-500" style={{ width: max ? `${Math.max(2, (b.count / max) * 100)}%` : "0%" }} />
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap align-top text-xs">{formatNumber(b.count)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AccountCreationCycleDistributionTable({
  seWorkDistribution,
  reviewDistribution,
}: {
  seWorkDistribution: CycleTimeBucket[];
  reviewDistribution: CycleTimeBucket[];
}) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Cycle Time Distribution</h3>
        <p className="text-xs text-neutral-400 mt-0.5">Where the minutes actually go — SE Work vs. Peer Review.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-neutral-100">
        <DistributionColumn title="SE Work" subtitle="In Progress → For Peer Review" buckets={seWorkDistribution} />
        <DistributionColumn title="Peer Review" subtitle="For Peer Review → On Hold / For Checking" buckets={reviewDistribution} />
      </div>
    </div>
  );
}
