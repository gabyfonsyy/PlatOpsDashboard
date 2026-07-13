import { AssigneeMetric } from "@/lib/metrics";
import { formatMinutes, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

export function AssigneeTable({ assignees }: { assignees: AssigneeMetric[] }) {
  if (!assignees.length) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No assignee data for this period yet.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Assigned</th>
            <th className="px-4 py-3">Resolved</th>
            <th className="px-4 py-3">FCR Rate</th>
            <th className="px-4 py-3">Escalation Rate</th>
            <th className="px-4 py-3">Backlog Aging</th>
            <th className="px-4 py-3">Avg Lead Time</th>
            <th className="px-4 py-3">Avg Cycle Time</th>
            <th className="px-4 py-3">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {assignees.map((a) => (
            <tr key={a.name}>
              <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">{a.name}</td>
              <td className="px-4 py-3">{a.ticketsAssigned}</td>
              <td className="px-4 py-3">{a.ticketsResolvedInPeriod}</td>
              <td className="px-4 py-3">{formatPercent(a.fcrRate)}</td>
              <td className="px-4 py-3">{formatPercent(a.escalationRate)}</td>
              <td className="px-4 py-3">{formatPercent(a.backlogAgingRate)}</td>
              <td className="px-4 py-3">{formatMinutes(a.avgLeadTimeMinutes)}</td>
              <td className="px-4 py-3">{formatMinutes(a.avgCycleTimeMinutes)}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {a.flags.length ? a.flags.map((f) => <Badge key={f} tone="warning">{f}</Badge>) : <span className="text-neutral-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
