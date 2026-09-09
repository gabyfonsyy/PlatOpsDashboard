"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { OutcomeTicket } from "@/lib/ticket-outcomes";
import { formatManilaDate } from "@/lib/format";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

/**
 * Ticket list for the Ticket Outcomes drill-downs (Cancelled/Archived/Rejected) — same shape and
 * UX as BreakdownTicketsTable (per-column client-side filter, useTablePagination, Jira link), but
 * with this feature's own column set (Summary, Team, Status, and the outcome's reason field
 * instead of Escalation/FCR's generic `detail`). Kept separate from BreakdownTicketsTable rather
 * than widening that component's column set, since escalation/FCR/on-hold/automated never show
 * Summary/Team/Status/Created and shouldn't gain unused columns for this feature's sake.
 */
export function OutcomeTicketsTable({
  title,
  reasonLabel,
  tickets,
  totalCount,
  jiraBaseUrl,
  emptyMessage = "No tickets for this period.",
  description,
}: {
  title: string;
  reasonLabel: string;
  tickets: OutcomeTicket[];
  /** Total matching tickets (after any reason filter) in the period. When it exceeds
   * tickets.length the list is truncated. */
  totalCount?: number;
  jiraBaseUrl?: string;
  emptyMessage?: string;
  description?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const searchable = useMemo(
    () =>
      tickets.map((t) => ({
        ticket: t,
        cells: {
          issueKey: `${t.issueKey} ${t.issueType}`,
          team: t.team,
          assignee: t.assignee,
          status: t.status,
          reason: t.reason,
          created: formatManilaDate(t.createdAt),
          resolved: formatManilaDate(t.resolvedAt),
        } as Record<string, string>,
      })),
    [tickets]
  );

  const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");

  const visible = useMemo(
    () =>
      searchable
        .filter(({ cells }) =>
          active.every(([key, value]) => (cells[key] ?? "").toLowerCase().includes(value.trim().toLowerCase()))
        )
        .map(({ ticket }) => ticket),
    [searchable, active]
  );

  const { page, setPage, pageCount, pageRows, pageSize } = useTablePagination(visible);

  const columns: { key: string; label: string }[] = [
    { key: "issueKey", label: "Ticket" },
    { key: "team", label: "Team" },
    { key: "assignee", label: "Assignee" },
    { key: "status", label: "Status" },
    { key: "created", label: "Created" },
    { key: "resolved", label: "Resolved" },
    { key: "reason", label: reasonLabel },
  ];

  const truncated = totalCount !== undefined && totalCount > tickets.length;

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          {description && <p className="text-xs text-neutral-400 mt-0.5">{description}</p>}
          <p className="text-xs text-neutral-400 mt-0.5">
            {active.length > 0
              ? `${visible.length} of ${tickets.length} shown`
              : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
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
              <th key={c.key} className="px-4 pt-3 pb-1">
                {c.label}
              </th>
            ))}
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
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-neutral-400">
                {tickets.length === 0 ? emptyMessage : "No tickets match these filters."}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => (
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
                <td className="px-4 py-3 whitespace-nowrap">{t.team}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.status || "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.createdAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.resolvedAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.reason}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <TablePagination page={page} pageCount={pageCount} totalCount={visible.length} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
