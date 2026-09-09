import { formatDaysValue, formatDurationBreakdown, formatNumber } from "@/lib/format";
import type { CycleTimeStats } from "@/lib/account-creation-report";

/**
 * Doer vs Validator cycle time — one row per role, one column per metric (same "one row per
 * subject" convention as every other table in this app, e.g. AssigneeTable/ToolAssistedSeTable),
 * scoped here to just SE Account Creation tickets. Doer = To Do -> For Peer Review (the SE's own
 * execution). Validator = time spent in For Peer Review across qualifying review cycles (exit to
 * On Hold or For Checking) — a DIFFERENT person's time, so it's its own row, never folded into
 * the doer's number.
 */
export function AccountCreationDoerValidatorTable({
  doer,
  validator,
  combinedAvgMinutes,
}: {
  doer: CycleTimeStats;
  validator: CycleTimeStats;
  combinedAvgMinutes: number | null;
}) {
  const rows = [
    { label: "Doer", note: "To Do → For Peer Review", stats: doer },
    { label: "Validator", note: "In For Peer Review, qualifying cycles only", stats: validator },
  ];

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Doer vs Validator Cycle Time</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Doer: the SE&apos;s own execution. Validator: the reviewer&apos;s time on qualifying cycles — a
          different person&apos;s time, kept as its own row on purpose.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3 text-right">Tickets</th>
            <th className="px-4 py-3 text-right">Median</th>
            <th className="px-4 py-3 text-right">Average</th>
            <th className="px-4 py-3 text-right">P75</th>
            <th className="px-4 py-3 text-right">P90</th>
            <th className="px-4 py-3 text-right">Fastest</th>
            <th className="px-4 py-3 text-right">Longest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="block font-medium text-neutral-900">{r.label}</span>
                <span className="block text-xs text-neutral-400">{r.note}</span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{formatNumber(r.stats.count)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                {formatDaysValue(r.stats.medianMinutes)}
                <span className="block text-[11px] text-neutral-400">{formatDurationBreakdown(r.stats.medianMinutes)}</span>
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                {formatDaysValue(r.stats.avgMinutes)}
                <span className="block text-[11px] text-neutral-400">{formatDurationBreakdown(r.stats.avgMinutes)}</span>
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.stats.p75Minutes)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.stats.p90Minutes)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.stats.minMinutes)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.stats.maxMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2.5 border-t border-neutral-200 text-xs text-neutral-400">
        Combined (doer avg + validator avg): {formatDaysValue(combinedAvgMinutes)} ({formatDurationBreakdown(combinedAvgMinutes)})
      </div>
    </div>
  );
}
