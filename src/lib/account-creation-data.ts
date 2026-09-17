import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { toManilaDateString } from "@/lib/manila-date";
import type { AccountCreationTicketRow, SeWorkCycleRaw } from "@/lib/account-creation-sla";

/** Supabase access for Account Creation (ST) reports — kept separate from the pure SLA math in account-creation-sla.ts. */

type Row = AccountCreationTicketRow;
type BaseRow = Omit<Row, "se_work_cycles_json" | "l3_issue_key" | "l3_endorsed_at" | "l3_completed_at">;

const SELECT =
  "issue_key,created,first_out_of_backlog_todo,cycle_time_end,resolved_datetime,assigned_se,labels,escalation_value,peer_review_cycles_json";

/** Coarse UTC-range prefilter (±1 day for the Manila shift) + exact Manila-day check in the caller — same split as every other Phase 4 report port (late-pickup.ts, tool-assisted.ts, ticket-outcomes.ts). */
async function fetchAccountCreationTicketsCreatedBetween(startDate: string, endDate: string): Promise<BaseRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<BaseRow>((from, to) =>
    getSupabaseClient()
      .from("tickets")
      .select(SELECT)
      .eq("team_key", "ST")
      .eq("issue_type", "Account Creation")
      .gte("created", rangeStartUtc.toISOString())
      .lte("created", rangeEndUtc.toISOString())
      .order("issue_key")
      .range(from, to)
  );
}

/**
 * se_work_cycles_json is fetched separately from SELECT above, rather than folded into it, and
 * merged in below — that shared query backs EVERY Account Creation report (Watchtower/
 * Performance/SE Efficiency/Tooling Impact/SE Patterns/Ticket Receipts), so if this new column
 * doesn't exist yet on a given Supabase instance (before supabase/add-se-work-cycles-column.sql
 * is run there), a single missing-column error would 42703 the WHOLE page — not just the new
 * SE-execution-vs-peer-review feature. Isolating it here means only the new feature degrades
 * (gracefully, to null/"unable to determine" per ticket) until that migration runs; every other
 * section keeps working exactly as it did before this feature existed. Mirrors how
 * archive_reason/summary's own rollout gap behaved (each already isolated to its own dedicated
 * query, per lib/ticket-outcomes.ts) — this file's shared query just wasn't isolated the same way
 * before this field was added, so isolation happens here instead.
 */
async function fetchSeWorkCyclesByIssueKey(issueKeys: string[]): Promise<Record<string, SeWorkCycleRaw[] | null>> {
  if (!issueKeys.length) return {};
  try {
    const rows = await fetchAllRows<{ issue_key: string; se_work_cycles_json: SeWorkCycleRaw[] | null }>((from, to) =>
      getSupabaseClient()
        .from("tickets")
        .select("issue_key,se_work_cycles_json")
        .eq("team_key", "ST")
        .in("issue_key", issueKeys)
        .order("issue_key")
        .range(from, to)
    );
    const map: Record<string, SeWorkCycleRaw[] | null> = {};
    for (const r of rows) map[r.issue_key] = r.se_work_cycles_json;
    return map;
  } catch {
    return {};
  }
}

type L3Linkage = { l3_issue_key: string | null; l3_endorsed_at: string | null; l3_completed_at: string | null };

/**
 * Isolated from the shared SELECT for the same reason se_work_cycles_json is above — if
 * l3_issue_key/l3_endorsed_at/l3_completed_at don't exist yet on a given Supabase instance (before
 * supabase/add-l3-linkage-columns.sql is run there), a missing-column error must only degrade this
 * feature, never the whole page.
 */
async function fetchL3LinkageByIssueKey(issueKeys: string[]): Promise<Record<string, L3Linkage>> {
  if (!issueKeys.length) return {};
  try {
    const rows = await fetchAllRows<{ issue_key: string } & L3Linkage>((from, to) =>
      getSupabaseClient()
        .from("tickets")
        .select("issue_key,l3_issue_key,l3_endorsed_at,l3_completed_at")
        .eq("team_key", "ST")
        .in("issue_key", issueKeys)
        .order("issue_key")
        .range(from, to)
    );
    const map: Record<string, L3Linkage> = {};
    for (const r of rows) {
      map[r.issue_key] = { l3_issue_key: r.l3_issue_key, l3_endorsed_at: r.l3_endorsed_at, l3_completed_at: r.l3_completed_at };
    }
    return map;
  } catch {
    return {};
  }
}

/** Account Creation tickets created within [startDate, endDate] (Manila calendar days, inclusive). */
export async function fetchAccountCreationTicketRows(startDate: string, endDate: string): Promise<Row[]> {
  const filtered = (await fetchAccountCreationTicketsCreatedBetween(startDate, endDate)).filter((r) => {
    if (!r.created) return false;
    const createdDate = toManilaDateString(r.created);
    return createdDate !== null && createdDate >= startDate && createdDate <= endDate;
  });

  const issueKeys = filtered.map((r) => r.issue_key);
  const [seWorkMap, l3Map] = await Promise.all([
    fetchSeWorkCyclesByIssueKey(issueKeys),
    fetchL3LinkageByIssueKey(issueKeys),
  ]);

  return filtered.map((r) => ({
    ...r,
    se_work_cycles_json: seWorkMap[r.issue_key] ?? null,
    l3_issue_key: l3Map[r.issue_key]?.l3_issue_key ?? null,
    l3_endorsed_at: l3Map[r.issue_key]?.l3_endorsed_at ?? null,
    l3_completed_at: l3Map[r.issue_key]?.l3_completed_at ?? null,
  }));
}
