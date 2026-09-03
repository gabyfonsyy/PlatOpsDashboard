"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { P1TicketRow } from "@/lib/p1-sla";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate } from "@/lib/format";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

const STATUS_META: Record<P1TicketRow["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  onTime: { label: "On Time", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  pending: { label: "Pending", tone: "warning" },
};

const CONTROLLABILITY_LABEL: Record<NonNullable<P1TicketRow["controllability"]>, string> = {
  internal: "Internal",
  dependency: "Dependency",
  external: "External",
};

/**
 * The DETAILS level of the P1 SLA page — every P1 ticket in scope (on time, overdue, AND pending),
 * not just the overdue ones. A dedicated component rather than reusing BreakdownTicketsTable: this
 * needs a Due Date / SLA Status / Days Overdue / Controllability shape that generic ticket shape
 * doesn't carry, and cramming it into one "detail" string (as the team-page's Overdue P1 Tickets
 * table did before this rebuild) loses the ability to sort/filter each fact independently.
 *
 * Mirrors BreakdownTicketsTable's per-column client-side filter UX exactly (same search-icon
 * input pattern, same "N of M shown" caption, same truncation note) so this reads as the same
 * family of component rather than a new interaction pattern.
 */
export function P1TicketsTable({
  tickets,
  assigneeLabel,
  jiraBaseUrl,
  totalCount,
}: {
  tickets: P1TicketRow[];
  assigneeLabel: string;
  jiraBaseUrl?: string;
  totalCount?: number;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const searchable = useMemo(
    () =>
      tickets.map((t) => ({
        ticket: t,
        cells: {
          issueKey: `${t.issueKey} ${t.issueType}`,
          assignee: t.assignee,
          product: t.product,
          labels: t.labels,
          status: STATUS_META[t.status].label,
          due: formatManilaDate(t.dueDate),
          resolved: formatManilaDate(t.resolvedAt),
          escalated: t.escalationTargets.join(", "),
          held: t.holdingReasons.join(", "),
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

  const columns = [
    { key: "issueKey", label: "Ticket" },
    { key: "status", label: "SLA Status" },
    { key: "assignee", label: assigneeLabel },
    { key: "product", label: "Product" },
    { key: "due", label: "Due" },
    { key: "resolved", label: "Resolved" },
    { key: "escalated", label: "Escalated To" },
    { key: "held", label: "Holding Reasons" },
    { key: "labels", label: "Labels" },
  ];

  const truncated = totalCount !== undefined && totalCount > tickets.length;

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">P1 Tickets</h3>
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
                {tickets.length === 0 ? "No P1 tickets for this period." : "No tickets match these filters."}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => {
              const meta = STATUS_META[t.status];
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
                    <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {t.status === "overdue" && t.daysOverdue !== null && (
                      <span className="block text-xs text-neutral-400 mt-0.5">{t.daysOverdue}d late</span>
                    )}
                    {t.status === "pending" && t.daysRemaining !== null && (
                      <span className="block text-xs text-neutral-400 mt-0.5">{t.daysRemaining}d left</span>
                    )}
                    {t.controllability && (
                      <span className="block text-xs text-neutral-400 mt-0.5">{CONTROLLABILITY_LABEL[t.controllability]}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.product}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.dueDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.resolvedAt ? formatManilaDate(t.resolvedAt) : "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.escalationTargets.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{t.holdingReasons.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{t.labels || "—"}</td>
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
