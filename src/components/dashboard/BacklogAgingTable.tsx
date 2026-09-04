"use client";

import type { BacklogAgingTicket } from "@/lib/backlog-aging";
import { formatNumber } from "@/lib/format";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

export function BacklogAgingTable({
  tickets,
  assigneeLabel,
  showTeam = false,
  jiraBaseUrl,
  title,
}: {
  tickets: BacklogAgingTicket[];
  assigneeLabel: string;
  showTeam?: boolean;
  jiraBaseUrl?: string;
  title?: string;
}) {
  const columnCount = showTeam ? 6 : 5;
  const { page, setPage, pageCount, pageRows, pageSize } = useTablePagination(tickets);

  return (
    <div className="card overflow-x-auto">
      {title && (
        <div className="px-4 py-3 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Jira Key</th>
            {showTeam && <th className="px-4 py-3">Team</th>}
            <th className="px-4 py-3">{assigneeLabel}</th>
            <th className="px-4 py-3">Due Date</th>
            <th className="px-4 py-3">Date Resolved</th>
            <th className="px-4 py-3">Days Overdue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {tickets.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-6 text-center text-neutral-400">
                No tickets resolved past their due date in this period.
              </td>
            </tr>
          ) : (
            pageRows.map((t) => (
              <tr key={`${t.teamKey}-${t.issueKey}`}>
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
                {showTeam && <td className="px-4 py-3 whitespace-nowrap">{t.teamKey}</td>}
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                {/* dueDate/resolvedDate arrive already normalised to a Manila 'yyyy-MM-dd' by the
                    GAS side (toDisplayDate_), so no client-side timezone shifting is needed. */}
                <td className="px-4 py-3 whitespace-nowrap">{t.dueDate}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.resolvedDate}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="badge bg-red-50 text-red-700">
                    {formatNumber(t.daysOverdue)} day{t.daysOverdue === 1 ? "" : "s"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <TablePagination page={page} pageCount={pageCount} totalCount={tickets.length} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
