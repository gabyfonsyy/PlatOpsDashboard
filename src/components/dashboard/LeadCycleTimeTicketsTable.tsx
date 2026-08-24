import type { LeadCycleTimeMetric, LeadCycleTimeTicket } from "@/lib/lead-cycle-time";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatManilaDate } from "@/lib/format";

export function LeadCycleTimeTicketsTable({
  tickets,
  metric,
  assigneeLabel,
  startColumnLabel,
  endColumnLabel,
  jiraBaseUrl,
}: {
  tickets: LeadCycleTimeTicket[];
  metric: LeadCycleTimeMetric;
  assigneeLabel: string;
  /** Both come from the report's basis — ST Cycle Time does not end at resolution. */
  startColumnLabel: string;
  endColumnLabel: string;
  jiraBaseUrl?: string;
}) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Top 10 Longest {metric === "cycle" ? "Cycle" : "Lead"} Times</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">{assigneeLabel}</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">{startColumnLabel}</th>
            <th className="px-4 py-3">{endColumnLabel}</th>
            <th className="px-4 py-3">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {tickets.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">No tickets for this period.</td>
            </tr>
          ) : (
            tickets.map((t) => (
              <tr key={t.issueKey}>
                <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                  {jiraBaseUrl ? (
                    <a
                      href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sprout-700 hover:underline"
                    >
                      {t.issueKey}
                    </a>
                  ) : (
                    t.issueKey
                  )}
                  {t.issueType && <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.product}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatManilaDate(metric === "cycle" ? t.startedAt : t.createdAt)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.resolvedAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatMinutesDecimalValue(t.minutes)}{" "}
                  <span className="text-neutral-400">({formatDurationBreakdown(t.minutes)})</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
