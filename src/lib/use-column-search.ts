"use client";

import { useMemo, useState, type DependencyList } from "react";

/**
 * Per-column, case-insensitive substring search shared by every ticket detail table in this app
 * (Account Creation Receipts, Automated Tickets, Backlog/Open, Breakdown, Cycle Time, Lead Time,
 * Outcome, and P1) — sits next to useTablePagination for the same reason: one place owning a piece
 * of table behavior every one of those tables previously reimplemented byte-for-byte.
 *
 * `searchableColumns` returns, for one row, the STRING EACH CELL RENDERS (not the underlying raw
 * field) so what you type matches what you see — e.g. a Manila-anchored date string, not a raw UTC
 * timestamp a day off. It is built into one row of derived strings per row via `useMemo`, keyed off
 * `deps`, so filtering never re-formats a date or re-derives a cell on every keystroke — callers
 * pass the same dependency list they'd give `useMemo` themselves (typically `[rows]`, or `[rows,
 * somethingElseTheMappingClosesOver]` when the mapping also reads e.g. a hidden-labels set).
 *
 * Filtering is an AND across every non-empty column filter: a row survives only if every active
 * filter's value is a case-insensitive, trimmed substring of that column's cell.
 */
export function useColumnSearch<T>(
  rows: T[],
  searchableColumns: (row: T) => Record<string, string | null | undefined>,
  deps: DependencyList
) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const searchable = useMemo(
    () => rows.map((row) => ({ row, cells: searchableColumns(row) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");

  const visible = useMemo(
    () =>
      searchable
        .filter(({ cells }) =>
          active.every(([key, value]) => (cells[key] ?? "").toLowerCase().includes(value.trim().toLowerCase()))
        )
        .map(({ row }) => row),
    [searchable, active]
  );

  return { filters, setFilters, active, visible };
}
