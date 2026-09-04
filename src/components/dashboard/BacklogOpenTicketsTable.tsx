"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { BacklogOpenTicket } from "@/lib/backlog-aging";
import { AGING_RISK_LABEL } from "@/lib/backlog-aging";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate, formatAgeDays } from "@/lib/format";
import { meaningfulLabels } from "@/lib/ticket-breakdowns";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";

const RISK_BADGE_TONE = { healthy: "neutral", watch: "warning", atRisk: "danger", critical: "danger" } as const;

const WORK_CATEGORY_LABEL: Record<string, string> = { backend: "Backend Changes", investigations: "Investigations" };

/**
 * The shared current-open-ticket detail table — behind Oldest Tickets, the three "What Needs My
 * Attention?" subgroups, Stale/No-Movement, and the bottom-of-page general drill-down (search +
 * cross-filter chips only render there, via `searchable`/the filter props). One row shape, one
 * component, per the established "one generic table, many callers" convention.
 *
 * Assigned Owner always comes from the row's own `assignee` field, which lib/backlog-aging.ts
 * already resolved via the global SE→Assigned SE / DBA,DevOps→Assigned COD mapping — this
 * component never re-derives ownership.
 */
export function BacklogOpenTicketsTable({
  rows,
  assigneeLabel,
  jiraBaseUrl,
  title,
  searchable = false,
  totalCount,
  ownerFilter,
  categoryFilter,
  issueTypeFilter,
  statusFilter,
  bucketFilter,
  distribution,
  onClearFilters,
  emptyLabel,
  extraExcludedLabels,
}: {
  rows: BacklogOpenTicket[];
  assigneeLabel: string;
  jiraBaseUrl?: string;
  title?: string;
  searchable?: boolean;
  totalCount?: number;
  ownerFilter?: string | null;
  categoryFilter?: string | null;
  issueTypeFilter?: string | null;
  statusFilter?: string | null;
  bucketFilter?: string | null;
  distribution?: { label: string; minDays: number; maxDays: number | null }[];
  onClearFilters?: () => void;
  emptyLabel?: string;
  extraExcludedLabels?: string[];
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const bucket = distribution?.find((b) => b.label === bucketFilter);

  const scoped = useMemo(() => {
    return rows.filter((t) => {
      if (ownerFilter && t.assignee !== ownerFilter) return false;
      if (categoryFilter && t.workCategory !== categoryFilter) return false;
      if (issueTypeFilter && t.issueType !== issueTypeFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (bucket && (t.ageDays < bucket.minDays || (bucket.maxDays !== null && t.ageDays >= bucket.maxDays))) return false;
      return true;
    });
  }, [rows, ownerFilter, categoryFilter, issueTypeFilter, statusFilter, bucket]);

  const searchableRows = useMemo(
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

  const active = searchable ? Object.entries(filters).filter(([, v]) => v.trim() !== "") : [];
  const visible = useMemo(
    () =>
      searchable
        ? searchableRows.filter(({ cells }) => active.every(([key, value]) => (cells[key] ?? "").toLowerCase().includes(value.trim().toLowerCase()))).map(({ ticket }) => ticket)
        : scoped,
    [searchable, searchableRows, active, scoped]
  );

  const { page, setPage, pageCount, pageRows, pageSize } = useTablePagination(visible);

  const hasExternalFilter = Boolean(ownerFilter || categoryFilter || issueTypeFilter || statusFilter || bucketFilter);
  const truncated = totalCount !== undefined && totalCount > rows.length;

  const columns = [
    { key: "issueKey", label: "Ticket" },
    { key: "assignee", label: assigneeLabel },
    { key: "product", label: "Priority / Product" },
  ];

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          {title && <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>}
          <p className="text-xs text-neutral-400 mt-0.5">
            {visible.length} of {rows.length} shown
            {truncated && ` · oldest ${rows.length} of ${totalCount} open`}
          </p>
          {hasExternalFilter && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ownerFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">{assigneeLabel}: {ownerFilter}</span>}
              {categoryFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">{WORK_CATEGORY_LABEL[categoryFilter] ?? categoryFilter}</span>}
              {issueTypeFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Issue Type: {issueTypeFilter}</span>}
              {statusFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Status: {statusFilter}</span>}
              {bucketFilter && <span className="inline-flex items-center text-xs bg-sprout-100 text-sprout-700 rounded px-2 py-0.5">Age: {bucketFilter}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasExternalFilter && onClearFilters && (
            <button onClick={onClearFilters} className="btn-secondary py-1 px-2.5 text-xs" title="Clear owner / category / issue type / status filters">
              <X className="w-3 h-3" />
              Clear Filters
            </button>
          )}
          {searchable && active.length > 0 && (
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
              <th key={c.key} className={searchable ? "px-4 pt-3 pb-1" : "px-4 py-3"}>
                {c.label}
              </th>
            ))}
            <th className={searchable ? "px-4 pt-3 pb-1" : "px-4 py-3"}>Status</th>
            <th className={`text-right ${searchable ? "px-4 pt-3 pb-1" : "px-4 py-3"}`}>Age</th>
            <th className={`text-right ${searchable ? "px-4 pt-3 pb-1" : "px-4 py-3"}`}>Risk</th>
          </tr>
          {searchable && (
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
              <th className="px-4 pb-2.5" colSpan={3} />
            </tr>
          )}
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                {rows.length === 0 ? emptyLabel ?? "No open tickets match this view." : "No tickets match these filters."}
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
                  <span className="block text-xs text-neutral-400 font-normal">
                    {t.issueType}
                    {t.workCategory && <span> · {WORK_CATEGORY_LABEL[t.workCategory]}</span>}
                  </span>
                </td>
                <td className="px-4 py-3">{t.assignee}</td>
                <td className="px-4 py-3">
                  {t.priority}
                  <span className="block text-xs text-neutral-500">
                    {t.product}
                    {meaningfulLabels(t.labels, extraExcludedLabels).length > 0 && ` · ${meaningfulLabels(t.labels, extraExcludedLabels).join(", ")}`}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {t.status}
                  <span className="block text-xs text-neutral-400">{formatManilaDate(t.createdAt)} created</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-medium">
                  {formatAgeDays(t.ageDays)}
                  <span className="block text-xs text-neutral-400 font-normal">{t.dueDate ? `due ${formatManilaDate(t.dueDate)}` : "no due date"}</span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Badge tone={RISK_BADGE_TONE[t.riskTier]}>{AGING_RISK_LABEL[t.riskTier]}</Badge>
                  {t.stale && <span className="block text-xs text-neutral-400 mt-0.5">{t.daysSinceUpdate}d since update</span>}
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
