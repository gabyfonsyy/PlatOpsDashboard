"use client";

import Link from "next/link";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate } from "@/lib/format";
import type { AccountCreationTicketSla } from "@/lib/account-creation-sla";
import { OVERALL_STATUS_META, accountCreationCopy } from "@/lib/account-creation-view";
import { AccountCreationMilestoneDots } from "@/components/dashboard/AccountCreationMilestoneDots";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

/**
 * The live attention board — one row per open ticket. Milestones render as 4 compact dots
 * (AccountCreationMilestoneDots) rather than 4 separate badge columns, and track type moves under
 * the ticket key as a subtitle — with 4 full badge columns plus a track column this was 9 columns
 * wide and forced horizontal scrolling on a normal screen; this fits in 5. Rows arrive pre-sorted
 * breached-first (see attentionRank in lib/account-creation-report.ts).
 */
export function AccountCreationWatchtowerBoard({
  tickets,
  jiraBaseUrl,
}: {
  tickets: AccountCreationTicketSla[];
  jiraBaseUrl?: string;
}) {
  const { theme } = useTheme();
  const copy = accountCreationCopy(theme);
  const { page, setPage, pageCount, pageRows, pageSize } = useTablePagination(tickets);

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{copy.watchtowerTitle}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">{copy.watchtowerIntro}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">SE</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Milestones</th>
            <th className="px-4 py-3">Overall</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                {copy.emptyState}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => {
              const overall = OVERALL_STATUS_META[t.overallStatus];
              return (
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
                    <span className="block text-xs text-neutral-400 font-normal">
                      {t.trackType ?? "unclassified"}
                      {t.hasDataLoading && " + data loading"}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.seName}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.created)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <AccountCreationMilestoneDots ticket={t} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`?overallStatus=${t.overallStatus}#receipts`} className="hover:underline">
                      <Badge tone={overall.tone}>
                        {overall.emoji} {overall.label}
                      </Badge>
                    </Link>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <TablePagination page={page} pageCount={pageCount} totalCount={tickets.length} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
