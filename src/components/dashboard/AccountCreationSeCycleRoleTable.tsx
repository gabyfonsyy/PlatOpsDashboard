import { formatDaysValue, formatDurationBreakdown, formatNumber } from "@/lib/format";
import type { SeCycleRoleRow } from "@/lib/account-creation-report";

/**
 * As Original SE vs. As Reviewer — two separate tables, never one blended row per SE. An SE can
 * appear in both (worked some tickets, reviewed others), and Section 7 is explicit that combining
 * "work performed" and "peer review performed" into one metric would hide which role a number
 * actually describes.
 */
function RoleTable({ title, subtitle, countLabel, rows }: { title: string; subtitle: string; countLabel: string; rows: SeCycleRoleRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">SE</th>
            <th className="px-4 py-3 text-right">{countLabel}</th>
            <th className="px-4 py-3 text-right">Median</th>
            <th className="px-4 py-3 text-right">Average</th>
            <th className="px-4 py-3 text-right">P90</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No Account Creation tickets for this period.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.seName}>
                <td className="px-4 py-2.5 font-medium text-neutral-900 whitespace-nowrap">{r.seName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {formatDaysValue(r.stats.medianMinutes)}
                  <span className="block text-[11px] text-neutral-400">{formatDurationBreakdown(r.stats.medianMinutes)}</span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {formatDaysValue(r.stats.avgMinutes)}
                  <span className="block text-[11px] text-neutral-400">{formatDurationBreakdown(r.stats.avgMinutes)}</span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatDaysValue(r.stats.p90Minutes)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AccountCreationSeCycleRoleTable({ asOriginalSe, asReviewer }: { asOriginalSe: SeCycleRoleRow[]; asReviewer: SeCycleRoleRow[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <RoleTable title="As Original SE" subtitle="Execution-side cycle time only." countLabel="Tickets" rows={asOriginalSe} />
      <RoleTable title="As Reviewer" subtitle="Review-side cycle time only — never blended with the execution side." countLabel="Reviews" rows={asReviewer} />
    </div>
  );
}
