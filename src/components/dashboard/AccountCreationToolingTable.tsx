import { formatDaysValue, formatDurationBreakdown, formatPercent, formatNumber } from "@/lib/format";
import type { ToolingImpactReport } from "@/lib/account-creation-report";

const USAGE_LABEL: Record<string, string> = {
  tool_assisted: "Tool-Assisted",
  non_tool_assisted: "Non-Tool-Assisted",
  unknown: "Unknown",
};

/**
 * Tool-assisted vs non vs unknown, for Account Creation specifically. Modeled on
 * ToolAssistedComparisonTable's layout but not a reuse of that component directly — that one's
 * shape is tied to lib/tool-assisted.ts's own CycleStats/report type, which covers ALL backend
 * execution, not just Account Creation.
 *
 * "Unknown" is never folded into Non-Tool-Assisted (see classifyToolUsage in
 * account-creation-report.ts) — a null labels column is a data gap, not evidence the tool wasn't used.
 */
export function AccountCreationToolingTable({ report }: { report: ToolingImpactReport }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Tooling Impact</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Tool-assisted tickets carry the &quot;tool-assisted&quot; Jira label. Comparison only — not a causal claim.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Usage</th>
            <th className="px-4 py-3 text-right">Tickets</th>
            <th className="px-4 py-3 text-right">Median Cycle Time</th>
            <th className="px-4 py-3 text-right">P75</th>
            <th className="px-4 py-3 text-right">Day 1 SLA Compliance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {report.byUsage.map((row) => (
            <tr key={row.usage}>
              <td className="px-4 py-2.5 font-medium text-neutral-900 whitespace-nowrap">{USAGE_LABEL[row.usage]}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatNumber(row.stats.count)}
                {row.stats.count > 0 && row.stats.count < 5 && (
                  <span className="block text-xs text-neutral-400">small sample</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                {row.stats.count < 5 ? (
                  <span className="text-neutral-400">Insufficient data</span>
                ) : (
                  <>
                    {formatDaysValue(row.stats.medianMinutes)}{" "}
                    <span className="text-neutral-400 text-xs">({formatDurationBreakdown(row.stats.medianMinutes)})</span>
                  </>
                )}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                {row.stats.count < 5 ? "—" : formatDaysValue(row.stats.p75Minutes)}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatPercent(row.slaCompliance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2.5 border-t border-neutral-200 text-xs text-neutral-400">
        Tool adoption: {formatPercent(report.adoptionRate)} (of tickets with known tool usage)
      </div>
    </div>
  );
}
