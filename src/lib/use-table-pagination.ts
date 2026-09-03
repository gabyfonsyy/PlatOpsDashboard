"use client";

import { useEffect, useMemo, useState } from "react";

/** Her 2026-09-03 standard for every ticket detail table across the app — Lead Time, Cycle Time,
 * P1 SLA, Escalation/FCR/On-Hold/Automated Tickets (all four via BreakdownTicketsTable), and any
 * new drill-down going forward. Pass a different pageSize only for a reason worth documenting. */
export const DEFAULT_TABLE_PAGE_SIZE = 10;

/**
 * Client-side pagination over an already-filtered row array. Every ticket detail table in this
 * app already does its own search/cross-filtering in the browser (the report caps what it sends
 * at BREAKDOWN_TICKET_LIMIT, so this never needs a server round trip) — this hook just slices
 * whatever survived that filtering into pages, so it composes with the existing `visible`/`scoped`
 * arrays rather than replacing them.
 *
 * Resets to page 1 whenever `rows` itself changes (a new search term, a new cross-filter click) —
 * deliberately, so a filter change can never strand the viewer on a page number that no longer
 * exists, or one that now shows an unrelated slice of a different result set.
 */
export function useTablePagination<T>(rows: T[], pageSize: number = DEFAULT_TABLE_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const clampedPage = Math.min(page, pageCount);
  const start = (clampedPage - 1) * pageSize;
  const pageRows = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize]);

  return { page: clampedPage, setPage, pageCount, pageRows, pageSize, start };
}
