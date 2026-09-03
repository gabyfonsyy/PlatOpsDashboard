import type { LeadTimeCategorySummary } from "@/lib/lead-cycle-time";
import { formatNumber, formatDaysValue, formatDurationBreakdown } from "@/lib/format";

function fmtMain(minutes: number | null): string {
  return minutes === null ? "—" : formatDaysValue(minutes);
}

/**
 * "All SE Work" composition — Backend Changes vs. Investigations at a glance (brief sections 4/7),
 * before the user drills into either with the Work Category toggle. Answers "which type of SE
 * work tends to take longer to complete?" Mirrors CycleTimeCategoryComparison's shape, but with
 * Lead Time's own metric set (median/avg/P75/P90/longest) — there is no Doer/Validator split here,
 * that stays on the Cycle Time page (section 6).
 */
export function LeadTimeCategoryComparison({ title, rows }: { title: string; rows: LeadTimeCategorySummary[] }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Per-ticket delay vs. overall workload impact are different questions — a category can run slower per ticket while carrying far less of the
          total volume.
        </p>
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[22%]">Category</th>
            <th className="px-3 py-3 text-right w-[13%]">Volume</th>
            <th className="px-3 py-3 text-right w-[19%]">Median</th>
            <th className="px-3 py-3 text-right w-[15%]">Avg</th>
            <th className="px-3 py-3 text-right w-[13%]">P75</th>
            <th className="px-3 py-3 text-right w-[18%]">P90</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.category}>
              <td className="px-3 py-2.5 text-neutral-900 font-medium">{r.label}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {fmtMain(r.medianMinutes)}
                <span className="block text-[11px] font-normal text-neutral-400">{formatDurationBreakdown(r.medianMinutes) ?? "—"}</span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{fmtMain(r.avgMinutes)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{fmtMain(r.p75Minutes)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{r.p90Minutes === null ? "N/A" : fmtMain(r.p90Minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
