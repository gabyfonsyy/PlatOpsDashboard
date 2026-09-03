"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

/**
 * The page footer for every ticket detail table (see lib/use-table-pagination.ts) — a single
 * shared control so "Page 3 of 9" looks and behaves identically everywhere it appears, now and on
 * whatever drill-down gets built next. Renders nothing when there's only one page, so an empty or
 * small result set doesn't grow a useless footer.
 */
export function TablePagination({
  page,
  pageCount,
  totalCount,
  pageSize,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  /** Count of rows the pagination is slicing — i.e. the FILTERED total, not the unfiltered one. */
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalCount === 0 || pageCount <= 1) return null;

  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-200 text-xs text-neutral-500">
      <span className="tabular-nums">
        {startIdx}–{endIdx} of {totalCount}
      </span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onPageChange(1)} disabled={page === 1} className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="First page">
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Previous page">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 tabular-nums">
          Page {page} of {pageCount}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page === pageCount} className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Next page">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onPageChange(pageCount)} disabled={page === pageCount} className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Last page">
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
