"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { LeadTimeTicketRow, LeadTimeDistributionBucket } from "@/lib/lead-cycle-time";
import { formatManilaDate, formatMinutesDecimalValue, formatDurationBreakdown } from "@/lib/format";
import { meaningfulLabels } from "@/lib/ticket-breakdowns";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

/**
 * The DETAILS level of the Lead Time deep-dive — every completed ticket counted in the period,
 * with its own search/filter (mirrors P1TicketsTable's per-column filter UX) plus the three
 * cross-filters set from higher up the page (work type row, product row, distribution bucket —
 * see LeadTimeDeepDive). Those three are the only sections that cross-filter: the charts/summary
 * tables above stay period-wide rather than recomputing medians/percentiles per click, which
 * would require shipping every raw duration to the client.
 */
export function LeadTimeTicketsTable({
  tickets,
  assigneeLabel,
  jiraBaseUrl,
  totalCount,
  workTypeFilter,
  productFilter,
  assigneeFilter,
  bucketFilter,
  distribution,
  onClearFilters,
  extraExcludedLabels,
  title,
}: {
  tickets: LeadTimeTicketRow[];
  assigneeLabel: string;
  jiraBaseUrl?: string;
  totalCount?: number;
  workTypeFilter?: string | null;
  productFilter?: string | null;
  assigneeFilter?: string | null;
  bucketFilter?: string | null;
  distribution: LeadTimeDistributionBucket[];
  onClearFilters?: () => void;
  extraExcludedLabels?: string[];
  title?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const bucket = distribution.find((b) => b.label === bucketFilter);

  const scoped = useMemo(() => {
    return tickets.filter((t) => {
      if (workTypeFilter && t.issueType !== workTypeFilter) return false;
      if (productFilter && t.product !== productFilter) return false;
      if (assigneeFilter && t.assignee !== assigneeFilter) return false;
      if (bucket) {
        const days = t.minutes / 1440;
        if (days < bucket.minDays || (bucket.maxDays !== null && days >= bucket.maxDays)) return false;
      }
      return true;
    });
  }, [tickets, workTypeFilter, productFilter, assigneeFilter, bucket]);

  const searchable = useMemo(
    () =>
      scoped.map((t) => ({
        ticket: t,
        cells: {
          issueKey: `${t.issueKey} ${t.issueType}`,
          assignee: t.assignee,
          // Product and Labels share one column now (see the horizontal-scroll fix below), so one
          // filter box searches both rather than needing a second input for a merged column.
          product: `${t.product} ${meaningfulLabels(t.labels, extraExcludedLabels).join(" ")}`,
        } as Record<string, string>,
      })),
    [scoped, extraExcludedLabels]
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
    { key: "assignee", label: assigneeLabel },
    { key: "product", label: "Product / Labels" },
  ];

  const hasExternalFilter = Boolean(workTypeFilter || productFilter || assigneeFilter || bucketFilter);
  const truncated = totalCount !== undefined && totalCount > tickets.length;

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title ?? "Lead Time — Ticket Detail"}</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            {visible.length} of {tickets.length} shown
            {truncated && ` · longest ${tickets.length} of ${totalCount} in this period`}
          </p>
          {hasExternalFilter && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {workTypeFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Work Type: {workTypeFilter}</span>}
              {productFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Product: {productFilter}</span>}
              {assigneeFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">{assigneeLabel}: {assigneeFilter}</span>}
              {bucketFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">{bucketFilter}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasExternalFilter && onClearFilters && (
            <button onClick={onClearFilters} className="btn-secondary py-1 px-2.5 text-xs" title="Clear work type / product / distribution filters">
              <X className="w-3 h-3" />
              Clear Filters
            </button>
          )}
          {active.length > 0 && (
            <button onClick={() => setFilters({})} className="btn-secondary py-1 px-2.5 text-xs" title="Clear every column search">
              <X className="w-3 h-3" />
              Clear search
            </button>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            {columns.map((c) => (
              <th key={c.key} className="px-4 pt-3 pb-1">
                {c.label}
              </th>
            ))}
            <th className="px-4 pt-3 pb-1">Created → Resolved</th>
            <th className="px-4 pt-3 pb-1 text-right">Lead Time</th>
            <th className="px-4 pt-3 pb-1 text-right">Waiting / Active</th>
            <th className="px-4 pt-3 pb-1 text-right">vs Median</th>
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
            <th className="px-4 pb-2.5" colSpan={4} />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                {tickets.length === 0 ? "No completed tickets for this period." : "No tickets match these filters."}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => (
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
                <td className="px-4 py-3">{t.assignee}</td>
                <td className="px-4 py-3">
                  {t.product}
                  {meaningfulLabels(t.labels, extraExcludedLabels).length > 0 && (
                    <span className="block text-xs text-neutral-500">{meaningfulLabels(t.labels, extraExcludedLabels).join(", ")}</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatManilaDate(t.createdAt)} <span className="text-neutral-400">→</span> {formatManilaDate(t.resolvedAt)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-medium">
                  {formatMinutesDecimalValue(t.minutes)} <span className="text-neutral-400 font-normal">({formatDurationBreakdown(t.minutes)})</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-neutral-500">
                  {t.waitingMinutes === null ? "N/A" : formatDurationBreakdown(t.waitingMinutes)}
                  {" / "}
                  {t.activeMinutes === null ? "N/A" : formatDurationBreakdown(t.activeMinutes)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                  {t.vsMedianMinutes === null ? "—" : `${t.vsMedianMinutes >= 0 ? "+" : "-"}${formatDurationBreakdown(Math.abs(t.vsMedianMinutes))}`}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <TablePagination page={page} pageCount={pageCount} totalCount={visible.length} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
