"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate } from "@/lib/format";
import type { AccountCreationTicketSla } from "@/lib/account-creation-sla";
import { OVERALL_STATUS_META } from "@/lib/account-creation-view";
import { AccountCreationMilestoneDots } from "@/components/dashboard/AccountCreationMilestoneDots";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

/**
 * Ticket Receipts — the full drill-down list. Not a reuse of BreakdownTicketsTable: that
 * component's column set (issueKey/assignee/product/labels/detail/minutes/resolved) doesn't fit
 * four independent milestone-status badges, so this is its own table following the same
 * per-column-filter + useTablePagination/TablePagination convention instead.
 *
 * Milestones render as 4 compact dots (AccountCreationMilestoneDots) rather than 4 badge columns,
 * and track type moves under the ticket key as a subtitle — the original 9-column layout forced
 * horizontal scrolling on a normal screen; this fits in 5. Track is still searchable (folded into
 * the ticket-key filter cell) even though it no longer has its own filter box.
 */
export function AccountCreationReceiptsTable({
  tickets,
  totalCount,
  jiraBaseUrl,
  id,
}: {
  tickets: AccountCreationTicketSla[];
  totalCount: number;
  jiraBaseUrl?: string;
  id?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const searchable = useMemo(
    () =>
      tickets.map((t) => ({
        ticket: t,
        cells: {
          issueKey: `${t.issueKey} ${t.trackType ?? "unclassified"}${t.hasDataLoading ? " data loading" : ""}`,
          seName: t.seName,
          created: formatManilaDate(t.created),
          overall: OVERALL_STATUS_META[t.overallStatus].label,
        } as Record<string, string>,
      })),
    [tickets]
  );

  const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");
  const visible = useMemo(
    () =>
      searchable
        .filter(({ cells }) => active.every(([key, value]) => (cells[key] ?? "").toLowerCase().includes(value.trim().toLowerCase())))
        .map(({ ticket }) => ticket),
    [searchable, active]
  );

  const { page, setPage, pageCount, pageRows, pageSize } = useTablePagination(visible);

  const columns: { key: string; label: string }[] = [
    { key: "issueKey", label: "Ticket" },
    { key: "seName", label: "Assigned SE" },
    { key: "created", label: "Created" },
    { key: "overall", label: "Overall" },
  ];

  const truncated = totalCount > tickets.length;

  return (
    <div className="card overflow-x-auto" id={id}>
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Ticket Receipts</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            {active.length > 0 ? `${visible.length} of ${tickets.length} shown` : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
            {truncated && ` · most recent ${tickets.length} of ${totalCount} in this period`}
          </p>
        </div>
        {active.length > 0 && (
          <button onClick={() => setFilters({})} className="btn-secondary py-1 px-2.5 text-xs" title="Clear every column filter">
            <X className="w-3 h-3" />
            Clear filters
          </button>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            {columns.map((c) => (
              <th key={c.key} className="px-4 pt-3 pb-1">{c.label}</th>
            ))}
            <th className="px-4 pt-3 pb-1">Milestones</th>
          </tr>
          <tr className="border-b border-neutral-200">
            {columns.map((c) => (
              <th key={c.key} className="px-4 pb-2.5 pt-0 font-normal">
                <span className="relative block">
                  <Search className="w-3 h-3 text-neutral-300 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={filters[c.key] ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                    placeholder="Filter…"
                    aria-label={`Filter by ${c.label}`}
                    className="form-input w-full !py-1 !pl-7 !pr-2 text-xs font-normal normal-case tracking-normal"
                  />
                </span>
              </th>
            ))}
            <th className="px-4 pb-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                {tickets.length === 0 ? "No tickets for this period." : "No tickets match these filters."}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => {
              const overall = OVERALL_STATUS_META[t.overallStatus];
              return (
                <tr key={t.issueKey}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                    {jiraBaseUrl ? (
                      <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
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
                    <Badge tone={overall.tone}>{overall.emoji} {overall.label}</Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <AccountCreationMilestoneDots ticket={t} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <TablePagination page={page} pageCount={pageCount} totalCount={visible.length} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
