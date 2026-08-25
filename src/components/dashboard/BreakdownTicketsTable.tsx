"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { BreakdownTicket } from "@/lib/ticket-breakdowns";
import {
  formatMinutesDecimalValue,
  formatDurationBreakdown,
  formatManilaDate,
} from "@/lib/format";

/**
 * Ticket list shared by the escalation / FCR / on-hold drill-downs, with a per-column filter.
 *
 * `detailLabel` names whatever the report put in `detail` (escalation targets, why a ticket
 * counted as SE-resolved); passing null drops the column entirely rather than rendering an
 * empty one.
 *
 * Filtering is client-side over the rows already on the page. That is the right trade here: the
 * report caps the list (BREAKDOWN_TICKET_LIMIT) at a size that comfortably holds a month, so
 * filtering in the browser is instant and needs no round trip. It does mean the filter searches
 * what was sent, not the whole database — which is why `totalCount` renders a truncation note
 * rather than letting a capped list pass for a complete one.
 *
 * Each column filters on the STRING THE CELL RENDERS, not the underlying field, so what you type
 * matches what you see. The Resolved column is the one that would otherwise surprise: it displays
 * a Manila-anchored YYYY-MM-DD, while the raw value is a UTC timestamp a day off.
 */
export function BreakdownTicketsTable({
  title,
  tickets,
  assigneeLabel,
  detailLabel,
  showMinutes = false,
  jiraBaseUrl,
  totalCount,
  emptyMessage = "No tickets for this period.",
  id,
  description,
}: {
  title: string;
  tickets: BreakdownTicket[];
  assigneeLabel: string;
  detailLabel: string | null;
  showMinutes?: boolean;
  jiraBaseUrl?: string;
  /** Total matching tickets in the period. When it exceeds tickets.length the list is truncated. */
  totalCount?: number;
  emptyMessage?: string;
  /** Anchor target, so a scorecard can link straight to this table. */
  id?: string;
  description?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  // One row of derived strings per ticket, in column order — built once so filtering never
  // re-formats dates or re-derives cells on every keystroke.
  const searchable = useMemo(
    () =>
      tickets.map((t) => ({
        ticket: t,
        cells: {
          issueKey: `${t.issueKey} ${t.issueType}`,
          assignee: t.assignee,
          product: t.product,
          labels: t.labels,
          detail: t.detail,
          minutes: t.minutes === null ? "" : formatMinutesDecimalValue(t.minutes),
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
          active.every(([key, value]) =>
            (cells[key] ?? "").toLowerCase().includes(value.trim().toLowerCase())
          )
        )
        .map(({ ticket }) => ticket),
    [searchable, active]
  );

  const columns: { key: string; label: string }[] = [
    { key: "issueKey", label: "Ticket" },
    { key: "assignee", label: assigneeLabel },
    { key: "product", label: "Product" },
    { key: "labels", label: "Labels" },
    ...(detailLabel ? [{ key: "detail", label: detailLabel }] : []),
    ...(showMinutes ? [{ key: "minutes", label: "On Hold" }] : []),
    { key: "resolved", label: "Resolved" },
  ];

  const truncated = totalCount !== undefined && totalCount > tickets.length;

  return (
    <div className="card overflow-x-auto" id={id}>
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
          <button
            onClick={() => setFilters({})}
            className="btn-secondary py-1 px-2.5 text-xs"
            title="Clear every column filter"
          >
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
            visible.map((t) => (
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
                  {t.issueType && (
                    <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.product}</td>
                <td className="px-4 py-3 text-xs text-neutral-500">{t.labels || "—"}</td>
                {detailLabel && <td className="px-4 py-3 whitespace-nowrap">{t.detail || "—"}</td>}
                {showMinutes && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {t.minutes === null ? "—" : formatMinutesDecimalValue(t.minutes)}{" "}
                    {t.minutes !== null && (
                      <span className="text-neutral-400">({formatDurationBreakdown(t.minutes)})</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.resolvedAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
