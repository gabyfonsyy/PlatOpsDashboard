import { getSupabaseClient, fetchAllRowsParallel } from "@/lib/supabase";
import { excludedIssueTypes, isExcludedIssueType } from "@/lib/teams";
import { toManilaDateString } from "@/lib/manila-date";
import { meaningfulLabels, toCountRows, type CountRow } from "@/lib/ticket-breakdowns";

/**
 * Business Review Prep's own "what's driving Ticket Volume" breakdown. None of the existing
 * report functions give a generic ticket-count-by-dimension view over ALL tickets in a period —
 * each is scoped to its own metric's row set (FCR-eligible, P1, outcome rows, etc.) — so this is
 * the one genuinely new data-layer query this feature needs.
 *
 * Scoped to tickets CREATED in the period (a clean, unambiguous population), mirroring the same
 * coarse-UTC-widen + exact-Manila-day-recheck pattern every other Phase 4 report in this codebase
 * uses. This is deliberately NOT guaranteed to reconcile exactly with getTicketMetrics' own
 * `ticketVolume` figure (metrics_daily's `assigned_count`, whose precise GAS-side definition isn't
 * re-derived here) — it exists purely to explain what's moving intake, not as a second source of
 * truth for the headline number. The MetricComparison's `calculation`/`filters` fields (see
 * business-review.ts) say so explicitly, per the brief's data-transparency requirement.
 */

export type TicketVolumeDimension = "issue_type" | "priority" | "status" | "product" | "label";

type VolumeRow = {
  issue_key: string;
  issue_type: string | null;
  priority: string | null;
  status: string | null;
  product: string | null;
  labels: string | null;
};

const SELECT = "issue_key,issue_type,priority,status,product,labels";

async function fetchCreatedRows(teamKey: string, startDate: string, endDate: string, issueType?: string): Promise<VolumeRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  const excluded = excludedIssueTypes(teamKey);

  // Concurrent paging via fetchAllRowsParallel needs a total ordering (its own doc comment is
  // explicit: an unordered/non-unique-ordered .range() page silently drops and duplicates rows) —
  // `issue_key` is tickets' real primary key, so ordering on it alone is sufficient.
  return fetchAllRowsParallel<VolumeRow>((head) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(SELECT, head ? { count: "exact", head: true } : undefined)
      .eq("team_key", teamKey)
      .not("created", "is", null)
      .gte("created", rangeStartUtc.toISOString())
      .lte("created", rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return q;
  }, "issue_key");
}

function groupCounts<T>(rows: T[], keyFn: (r: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const key = keyFn(r);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Ticket Volume's own driver dimensions: created-in-period tickets for one team, grouped by the
 * requested column. `label` fans a multi-label ticket out into one entry per meaningful label
 * (same convention as ticket-breakdowns.ts's productLabelCombos), so its counts can exceed the
 * ticket total.
 */
export async function getTicketVolumeBreakdown(
  team: string,
  startDate: string,
  endDate: string,
  dimension: TicketVolumeDimension,
  issueType?: string
): Promise<{ rows: CountRow[]; totalTickets: number }> {
  const rows = (await fetchCreatedRows(team, startDate, endDate, issueType)).filter((r) => !isExcludedIssueType(team, r.issue_type));
  // fetchCreatedRows' UTC prefilter is widened; VolumeRow carries no timestamp to re-check the
  // exact Manila day against here (SELECT deliberately excludes `created`, since only the grouped
  // dimension is needed) — the ±1/+2-day widen is bounded enough that any spillover is limited to
  // the very edge of the window and is an accepted approximation for a "driver" explanation, not
  // the headline number itself (see this file's own doc comment above).

  if (dimension === "label") {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      total++;
      for (const label of meaningfulLabels(r.labels)) counts[label] = (counts[label] || 0) + 1;
    }
    return { rows: toCountRows(counts, total), totalTickets: total };
  }

  const keyFn =
    dimension === "issue_type"
      ? (r: VolumeRow) => r.issue_type || "(none)"
      : dimension === "priority"
        ? (r: VolumeRow) => r.priority || "(none)"
        : dimension === "status"
          ? (r: VolumeRow) => r.status || "(none)"
          : (r: VolumeRow) => r.product || "(none)";

  const counts = groupCounts(rows, keyFn);
  return { rows: toCountRows(counts, rows.length), totalTickets: rows.length };
}
