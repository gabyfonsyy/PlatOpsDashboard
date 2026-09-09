import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { toManilaDateString } from "@/lib/manila-date";
import type { AccountCreationTicketRow } from "@/lib/account-creation-sla";

/** Supabase access for Account Creation (ST) reports — kept separate from the pure SLA math in account-creation-sla.ts. */

type Row = AccountCreationTicketRow;

const SELECT =
  "issue_key,created,first_out_of_backlog_todo,cycle_time_end,resolved_datetime,assigned_se,labels,escalation_value,peer_review_cycles_json";

/** Coarse UTC-range prefilter (±1 day for the Manila shift) + exact Manila-day check in the caller — same split as every other Phase 4 report port (late-pickup.ts, tool-assisted.ts, ticket-outcomes.ts). */
async function fetchAccountCreationTicketsCreatedBetween(startDate: string, endDate: string): Promise<Row[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<Row>((from, to) =>
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

/** Account Creation tickets created within [startDate, endDate] (Manila calendar days, inclusive). */
export async function fetchAccountCreationTicketRows(startDate: string, endDate: string): Promise<Row[]> {
  return (await fetchAccountCreationTicketsCreatedBetween(startDate, endDate)).filter((r) => {
    if (!r.created) return false;
    const createdDate = toManilaDateString(r.created);
    return createdDate !== null && createdDate >= startDate && createdDate <= endDate;
  });
}
