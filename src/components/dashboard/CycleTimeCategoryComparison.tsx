import type { CycleTimeCategorySummary } from "@/lib/lead-cycle-time";
import { formatNumber, formatDaysValue, formatDurationBreakdown } from "@/lib/format";

function fmtMain(minutes: number | null): string {
  return minutes === null ? "—" : formatDaysValue(minutes);
}

/**
 * "All SE Work" composition — Backend Changes vs. Investigations at a glance, before the user
 * drills into either with the category toggle above. Answers the brief's "why does overall Cycle
 * Time behave the way it does" question (sections 1/5/9/13): Backend Changes carries a real
 * Doer+Validator breakdown, Investigations is Doer-only by design (no fabricated Validator row —
 * see getCycleTimeDeepDive's buildCategoryComparison).
 *
 * Deliberately does NOT rank or declare a "winner" — the two categories measure genuinely
 * different workflows (one has a review stage, one doesn't), so a bare "Investigations are
 * faster" reading would be misleading rather than informative (her explicit caution, section 9).
 */
export function CycleTimeCategoryComparison({ title, rows }: { title: string; rows: CycleTimeCategorySummary[] }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Different workflows, not a race — Investigations has no validation stage, so a lower number there isn&apos;t automatically &quot;faster.&quot;
        </p>
      </div>
      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-3 py-3 w-[26%]">Category</th>
            <th className="px-3 py-3 text-right w-[14%]">Volume</th>
            <th className="px-3 py-3 text-right w-[22%]">Doer / Validator</th>
            <th className="px-3 py-3 text-right w-[19%]">Avg Total</th>
            <th className="px-3 py-3 text-right w-[19%]">Median Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.category}>
              <td className="px-3 py-2.5 text-neutral-900 font-medium">{r.label}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.count)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs">
                {r.avgDoerMinutes === null ? (
                  <span>{fmtMain(r.avgTotalMinutes)} <span className="text-neutral-400">(doer only)</span></span>
                ) : (
                  <>{fmtMain(r.avgDoerMinutes)}<span className="text-neutral-400"> / </span>{fmtMain(r.avgValidatorMinutes)}</>
                )}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {fmtMain(r.avgTotalMinutes)}
                <span className="block text-[11px] font-normal text-neutral-400">{formatDurationBreakdown(r.avgTotalMinutes) ?? "—"}</span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{fmtMain(r.medianTotalMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
