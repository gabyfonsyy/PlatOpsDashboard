import type { ToolAssistedTicket } from "@/lib/tool-assisted";
import { formatMinutesDecimalValue, formatDurationBreakdown, formatManilaDate } from "@/lib/format";

export function ToolAssistedTable({ tickets, jiraBaseUrl }: { tickets: ToolAssistedTicket[]; jiraBaseUrl?: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">SE</th>
            <th className="px-4 py-3">Moved Out of To Do</th>
            <th className="px-4 py-3">Entered For Peer Review</th>
            <th className="px-4 py-3">Cycle Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {tickets.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">No tool-assisted tickets with a completed cycle for this period.</td>
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
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{t.issueType}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.todoExitAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.peerReviewAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatMinutesDecimalValue(t.cycleTimeMinutes)}{" "}
                  <span className="text-neutral-400">({formatDurationBreakdown(t.cycleTimeMinutes)})</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
