"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { CycleTimeTicketRow, CycleTimeDistributionBucket } from "@/lib/lead-cycle-time";
import { formatManilaDate, formatDaysValue, formatDurationBreakdown } from "@/lib/format";
import { meaningfulLabels } from "@/lib/ticket-breakdowns";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

function fmtMain(minutes: number | null): string {
  return minutes === null ? "—" : formatDaysValue(minutes);
}

/**
 * The DETAILS level of the Cycle Time deep-dive — every ticket counted in the period, with its
 * own search/filter plus the cross-filters set from higher up the page (ticket type, product,
 * assignee, distribution bucket — see CycleTimeDeepDive). Mirrors LeadTimeTicketsTable's scoping
 * design exactly (only this table, not the charts/summary above it, is cross-filtered).
 *
 * Capped at 6 columns (5 without the Doer/Validator split) with no overflow-x-auto — Doer and
 * Validator share one stacked cell, and Total folds "vs median" in as a sub-line, rather than
 * adding two more columns that would force horizontal scrolling.
 */
export function CycleTimeTicketsTable({
  tickets,
  assigneeLabel,
  hasDoerValidatorSplit,
  jiraBaseUrl,
  totalCount,
  ticketTypeFilter,
  productFilter,
  assigneeFilter,
  bucketFilter,
  distribution,
  onClearFilters,
  title,
  extraExcludedLabels,
}: {
  tickets: CycleTimeTicketRow[];
  assigneeLabel: string;
  hasDoerValidatorSplit: boolean;
  jiraBaseUrl?: string;
  totalCount?: number;
  ticketTypeFilter?: string | null;
  productFilter?: string | null;
  assigneeFilter?: string | null;
  bucketFilter?: string | null;
  distribution: CycleTimeDistributionBucket[];
  onClearFilters?: () => void;
  title: string;
  extraExcludedLabels?: string[];
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const bucket = distribution.find((b) => b.label === bucketFilter);

  const scoped = useMemo(() => {
    return tickets.filter((t) => {
      if (ticketTypeFilter && t.issueType !== ticketTypeFilter) return false;
      if (productFilter && t.product !== productFilter) return false;
      if (assigneeFilter && t.assignee !== assigneeFilter) return false;
      if (bucket) {
        const days = t.totalMinutes / 1440;
        if (days < bucket.minDays || (bucket.maxDays !== null && days >= bucket.maxDays)) return false;
      }
      return true;
    });
  }, [tickets, ticketTypeFilter, productFilter, assigneeFilter, bucket]);

  const searchable = useMemo(
    () =>
      scoped.map((t) => ({
        ticket: t,
        cells: {
          issueKey: `${t.issueKey} ${t.issueType}`,
          assignee: t.assignee,
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
    { key: "issueKey", label: "Ticket", width: "w-[18%]" },
    { key: "assignee", label: assigneeLabel, width: "w-[14%]" },
    { key: "product", label: "Product / Labels", width: "w-[24%]" },
  ];

  const hasExternalFilter = Boolean(ticketTypeFilter || productFilter || assigneeFilter || bucketFilter);
  const truncated = totalCount !== undefined && totalCount > tickets.length;
  const colSpan = columns.length + (hasDoerValidatorSplit ? 3 : 2);

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            {visible.length} of {tickets.length} shown
            {truncated && ` · longest ${tickets.length} of ${totalCount} in this period`}
          </p>
          {hasExternalFilter && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ticketTypeFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Type: {ticketTypeFilter}</span>}
              {productFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Product: {productFilter}</span>}
              {assigneeFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">{assigneeLabel}: {assigneeFilter}</span>}
              {bucketFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">{bucketFilter}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          {hasExternalFilter && onClearFilters && (
            <button onClick={onClearFilters} className="btn-secondary py-1 px-2.5 text-xs" title="Clear ticket type / product / assignee / distribution filters">
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

      <table className="w-full text-sm table-fixed">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            {columns.map((c) => (
              <th key={c.key} className={`px-3 pt-3 pb-1 ${c.width}`}>
                {c.label}
              </th>
            ))}
            <th className="px-3 pt-3 pb-1 w-[16%]">Started → Ended</th>
            {hasDoerValidatorSplit && <th className="px-3 pt-3 pb-1 text-right w-[12%]">Doer / Validator</th>}
            <th className={`px-3 pt-3 pb-1 text-right ${hasDoerValidatorSplit ? "w-[16%]" : "w-[28%]"}`}>Total</th>
          </tr>
          <tr className="border-b border-neutral-200">
            {columns.map((c) => (
              <th key={c.key} className="px-3 pb-2.5 pt-0 font-normal">
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
            <th className="px-3 pb-2.5" colSpan={hasDoerValidatorSplit ? 2 : 1} />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-3 py-6 text-center text-neutral-400">
                {tickets.length === 0 ? "No completed tickets for this period." : "No tickets match these filters."}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => (
              <tr key={t.issueKey}>
                <td className="px-3 py-3 font-medium text-neutral-900 break-words">
                  {jiraBaseUrl ? (
                    <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
                      {t.issueKey}
                    </a>
                  ) : (
                    t.issueKey
                  )}
                  <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                </td>
                <td className="px-3 py-3 break-words">{t.assignee}</td>
                <td className="px-3 py-3 break-words">
                  {t.product}
                  {meaningfulLabels(t.labels, extraExcludedLabels).length > 0 && (
                    <span className="block text-xs text-neutral-500">{meaningfulLabels(t.labels, extraExcludedLabels).join(", ")}</span>
                  )}
                </td>
                <td className="px-3 py-3 break-words">
                  {formatManilaDate(t.startedAt || t.createdAt)} <span className="text-neutral-400">→</span> {formatManilaDate(t.resolvedAt)}
                </td>
                {hasDoerValidatorSplit && (
                  <td className="px-3 py-3 text-right tabular-nums text-xs leading-tight text-neutral-500">
                    <div>{fmtMain(t.doerMinutes)}</div>
                    <div>{t.validatorMinutes === null ? "—" : fmtMain(t.validatorMinutes)}</div>
                  </td>
                )}
                <td className="px-3 py-3 text-right tabular-nums">
                  <div className="font-medium">
                    {fmtMain(t.totalMinutes)} <span className="text-neutral-400 font-normal">({formatDurationBreakdown(t.totalMinutes)})</span>
                  </div>
                  <div className="text-xs text-neutral-500 font-normal mt-0.5">
                    {t.vsMedianTotalMinutes === null ? "—" : `${t.vsMedianTotalMinutes >= 0 ? "+" : "-"}${formatDurationBreakdown(Math.abs(t.vsMedianTotalMinutes))} vs median`}
                  </div>
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
