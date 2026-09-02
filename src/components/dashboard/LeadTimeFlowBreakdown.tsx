import type { LeadTimeFlow } from "@/lib/lead-cycle-time";

function fmtDays(minutes: number | null): string {
  return minutes === null ? "N/A" : `${(minutes / 1440).toFixed(2)}d`;
}
function fmtShare(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 1000) / 10}%`;
}

/**
 * "Where is the time going?" — Created -> backlog exit -> Resolved stage split, plus waiting
 * (on-hold) vs. active time from total_on_hold_minutes. A high Lead Time doesn't automatically
 * mean the team is slow at execution; it may mean the ticket spent a long time waiting on
 * something else. Both halves degrade gracefully to an explicit "not available" rather than
 * estimating when the underlying timestamps aren't populated for this period.
 */
export function LeadTimeFlowBreakdown({ flow }: { flow: LeadTimeFlow }) {
  return (
    <div className="card p-5">
      <p className="text-sm font-medium text-neutral-700 mb-1">Where Is Time Being Spent?</p>
      <p className="text-xs text-neutral-400 mb-4">Average duration per stage, and how much of Lead Time goes to waiting vs. active work.</p>

      {!flow.available ? (
        <p className="text-sm text-neutral-400">Stage timestamps aren&apos;t populated for enough tickets this period to break Lead Time into stages.</p>
      ) : (
        <div className="mb-5">
          <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100">
            {flow.stages.map((s) => (
              <div
                key={s.key}
                style={{ width: `${Math.max(2, (s.shareOfLeadTime ?? 0) * 100)}%` }}
                className={s.key === "backlogWait" ? "bg-[rgb(var(--n-300))]" : "bg-[rgb(var(--a-500))]"}
                title={s.label}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {flow.stages.map((s) => (
              <div key={s.key}>
                <p className="text-xs text-neutral-500">{s.label}</p>
                <p className="text-sm font-semibold text-neutral-900">
                  {fmtDays(s.avgMinutes)} avg <span className="text-neutral-400 font-normal">({fmtShare(s.shareOfLeadTime)} of Lead Time)</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-neutral-100">
        {!flow.waitingDataAvailable ? (
          <p className="text-sm text-neutral-400">Waiting/on-hold time isn&apos;t tracked for this team, so Active vs. Waiting can&apos;t be split out.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-neutral-500">Active Time</p>
              <p className="text-sm font-semibold text-neutral-900">{fmtDays(flow.activeAvgMinutes)} avg</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Waiting Time</p>
              <p className="text-sm font-semibold text-neutral-900">
                {fmtDays(flow.waitingAvgMinutes)} avg <span className="text-neutral-400 font-normal">({fmtShare(flow.waitingShareOfLeadTime)} of Lead Time)</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
