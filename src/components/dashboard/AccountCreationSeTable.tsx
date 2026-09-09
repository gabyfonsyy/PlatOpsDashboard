import { formatPercent, formatNumber } from "@/lib/format";
import type { SeStartPattern } from "@/lib/account-creation-report";

/**
 * Day 1 start compliance by SE, with workload context (their total ST volume for the same period,
 * from getAssigneeMetrics) beside it — so a low compliance rate reads next to "are they drowning
 * in tickets" rather than in isolation. Not a leaderboard: sorted by ticket count, same convention
 * as every other by-person breakdown in this app.
 */
export function AccountCreationSeTable({ bySe }: { bySe: SeStartPattern[] }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Day 1 Start Compliance by SE</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Started On Time / Started Late / Not Started, per Section 9&apos;s definition — a separate question from setup completion.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Assigned SE</th>
            <th className="px-4 py-3 text-right">AC Tickets</th>
            <th className="px-4 py-3 text-right">On Time</th>
            <th className="px-4 py-3 text-right">Late</th>
            <th className="px-4 py-3 text-right">Not Started</th>
            <th className="px-4 py-3 text-right">Compliance</th>
            <th className="px-4 py-3 text-right">Avg Days Late</th>
            <th className="px-4 py-3 text-right">Total ST Volume</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {bySe.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">No Account Creation tickets for this period.</td>
            </tr>
          ) : (
            bySe.map((s) => (
              <tr key={s.seName}>
                <td className="px-4 py-2.5 font-medium text-neutral-900 whitespace-nowrap">{s.seName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(s.ticketCount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(s.startedOnTime)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(s.startedLate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(s.notStarted)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(s.startComplianceRate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.avgBusinessDaysLate === null ? "—" : `${s.avgBusinessDaysLate}d`}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-400">
                  {s.ticketsAssignedAllSt === null ? "—" : formatNumber(s.ticketsAssignedAllSt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
