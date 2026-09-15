"use client";

import { Fragment, useMemo, useState } from "react";
import { Search, X, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate } from "@/lib/format";
import type { AccountCreationTicketSla } from "@/lib/account-creation-sla";
import { OVERALL_STATUS_META, DELAY_AREA_META } from "@/lib/account-creation-view";
import type { TicketCycleInfo } from "@/lib/account-creation-report";
import { AccountCreationMilestoneDots } from "@/components/dashboard/AccountCreationMilestoneDots";
import { AccountCreationTicketTimeline } from "@/components/dashboard/AccountCreationTicketTimeline";
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
 * horizontal scrolling on a normal screen; this fits in 5 (now 7, with Reviewer/Delay Area).
 * Reviewer/Delay Area reuse this same per-column substring-filter mechanism rather than adding
 * dropdowns to the shared FilterBar — FilterBar's `extraFilter` is single-slot and this table
 * already has its own working filter convention for exactly this kind of column.
 *
 * Clicking a row expands it in place to show the SE-execution-vs-peer-review timeline
 * (AccountCreationTicketTimeline) directly beneath it — no modal, no navigation. Per the mockup
 * review: nothing in this app uses a modal for pure read-only display, only edit forms, so this
 * keeps the page's existing "everything lives on one scrollable page" convention instead of
 * introducing a first modal for this one case.
 */
export function AccountCreationReceiptsTable({
  tickets,
  cycles,
  totalCount,
  jiraBaseUrl,
  id,
}: {
  tickets: AccountCreationTicketSla[];
  cycles: Record<string, TicketCycleInfo>;
  totalCount: number;
  jiraBaseUrl?: string;
  id?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const searchable = useMemo(
    () =>
      tickets.map((t) => {
        const cycle = cycles[t.issueKey];
        const reviewerNames = cycle ? cycle.stages.filter((s) => s.stage === "peer_review").map((s) => s.ownerAtStart || "").join(" ") : "";
        return {
          ticket: t,
          cells: {
            issueKey: `${t.issueKey} ${t.trackType ?? "unclassified"}${t.hasDataLoading ? " data loading" : ""}`,
            seName: t.seName,
            reviewer: reviewerNames,
            created: formatManilaDate(t.created),
            delayArea: cycle ? DELAY_AREA_META[cycle.delay.area].label : "",
            overall: OVERALL_STATUS_META[t.overallStatus].label,
          } as Record<string, string>,
        };
      }),
    [tickets, cycles]
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
    { key: "reviewer", label: "Reviewer" },
    { key: "created", label: "Created" },
    { key: "delayArea", label: "Delay Area" },
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
            {" · click a row for the SE-execution vs. peer-review breakdown"}
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
            <th className="px-4 pt-3 pb-1 w-6" />
            {columns.map((c) => (
              <th key={c.key} className="px-4 pt-3 pb-1">{c.label}</th>
            ))}
            <th className="px-4 pt-3 pb-1">Milestones</th>
          </tr>
          <tr className="border-b border-neutral-200">
            <th className="px-4 pb-2.5" />
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
              <td colSpan={columns.length + 2} className="px-4 py-6 text-center text-neutral-400">
                {tickets.length === 0 ? "No tickets for this period." : "No tickets match these filters."}
              </td>
            </tr>
          ) : (
            pageRows.map((t) => {
              const overall = OVERALL_STATUS_META[t.overallStatus];
              const cycle = cycles[t.issueKey];
              const isExpanded = expanded === t.issueKey;
              const reviewerNames = cycle
                ? Array.from(new Set(cycle.stages.filter((s) => s.stage === "peer_review").map((s) => s.ownerAtStart || "(unassigned)")))
                : [];
              return (
                <Fragment key={t.issueKey}>
                  <tr
                    className="cursor-pointer hover:bg-neutral-50"
                    onClick={() => setExpanded(isExpanded ? null : t.issueKey)}
                  >
                    <td className="px-4 py-3">
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                      {jiraBaseUrl ? (
                        <a
                          href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
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
                    <td className="px-4 py-3 whitespace-nowrap">{reviewerNames.length ? reviewerNames.join(", ") : "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.created)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {cycle ? <Badge tone={DELAY_AREA_META[cycle.delay.area].tone}>{DELAY_AREA_META[cycle.delay.area].label}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={overall.tone}>{overall.emoji} {overall.label}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <AccountCreationMilestoneDots ticket={t} />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${t.issueKey}-detail`} className="bg-neutral-50/60">
                      <td colSpan={columns.length + 2} className="px-6 py-4 border-t border-dashed border-neutral-200">
                        {cycle ? (
                          <AccountCreationTicketTimeline stages={cycle.stages} summary={cycle.summary} delay={cycle.delay} />
                        ) : (
                          <p className="text-sm text-neutral-400">No SE-execution or peer-review history available for this ticket.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
      <TablePagination page={page} pageCount={pageCount} totalCount={visible.length} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
