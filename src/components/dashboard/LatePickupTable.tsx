import { LatePickupAtRiskTicket, LatePickupBySe, LatePickupTicket } from "@/lib/late-pickup";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

export function LatePickupTable({
  bySe,
  tickets,
  atRisk,
}: {
  bySe: LatePickupBySe[];
  tickets: LatePickupTicket[];
  atRisk: LatePickupAtRiskTicket[];
}) {
  const lateTickets = tickets.filter((t) => t.isLate);

  return (
    <div className="flex flex-col gap-6">
      {atRisk.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">
            At Risk — not yet picked up, past Day 1 ({atRisk.length})
          </h3>
          <ul className="text-sm text-amber-900 flex flex-col gap-1">
            {atRisk.map((t) => (
              <li key={t.issueKey}>
                <span className="font-medium">{t.issueKey}</span> — {t.seName} — created {formatManilaDate(t.created)},
                Day 1 ended {formatManilaDate(t.day1End)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">SE</th>
              <th className="px-4 py-3">Late Pickups</th>
              <th className="px-4 py-3">Late + Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {bySe.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-neutral-400">No late pickups for this period.</td>
              </tr>
            ) : (
              bySe.map((s) => (
                <tr key={s.seName}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">{s.seName}</td>
                  <td className="px-4 py-3">{s.lateCount}</td>
                  <td className="px-4 py-3">
                    {s.lateAndOverdueCount > 0 ? (
                      <Badge tone="danger">{s.lateAndOverdueCount}</Badge>
                    ) : (
                      s.lateAndOverdueCount
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Ticket</th>
              <th className="px-4 py-3">SE</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Day 1 Deadline</th>
              <th className="px-4 py-3">Picked Up</th>
              <th className="px-4 py-3">SLA Deadline (Day 2)</th>
              <th className="px-4 py-3">Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {lateTickets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">No late-pickup tickets for this period.</td>
              </tr>
            ) : (
              lateTickets.map((t) => (
                <tr key={t.issueKey}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">{t.issueKey}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.seName}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.created)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.day1End)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.pickedUpAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.day2End)}</td>
                  <td className="px-4 py-3">{t.isOverdue ? <Badge tone="danger">Overdue</Badge> : <span className="text-neutral-300">—</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
