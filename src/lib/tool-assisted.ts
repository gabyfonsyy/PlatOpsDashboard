import { getSupabaseClient } from "@/lib/supabase";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";

export type ToolAssistedTicket = {
  issueKey: string;
  issueType: string;
  assignee: string;
  labels: string;
  hasLabel: boolean;
  created: string;
  todoExitAt: string;
  peerReviewAt: string;
  cycleTimeMinutes: number;
};

export type ToolAssistedReport = {
  team: string;
  range: string;
  period: string;
  label: string;
  toolAssisted: { count: number; avgCycleTimeMinutes: number | null; tickets: ToolAssistedTicket[] };
  others: { count: number; avgCycleTimeMinutes: number | null };
};

const EMPTY_REPORT: ToolAssistedReport = {
  team: "ST", range: "month", period: "", label: "tool-assisted",
  toolAssisted: { count: 0, avgCycleTimeMinutes: null, tickets: [] },
  others: { count: 0, avgCycleTimeMinutes: null },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Ported from gas/JiraSync.gs's CYCLE_TIME_END_STATUS_BY_ISSUE_TYPE/cycleTimeEndStatusForIssueType_ —
// Investigation/Data Generation end at "For Checking" instead of "For Peer Review", so
// cycle_time_end wouldn't mean the same thing for those; excluded from this comparison.
const CYCLE_TIME_END_STATUS_BY_ISSUE_TYPE: Record<string, string> = {
  "data generation": "for checking",
  investigation: "for checking",
};

function cycleTimeEndStatusForIssueType(issueType: string | null): string {
  return CYCLE_TIME_END_STATUS_BY_ISSUE_TYPE[(issueType || "").toLowerCase()] || "for peer review";
}

type TicketRow = {
  issue_key: string;
  issue_type: string | null;
  created: string;
  first_out_of_backlog_todo: string | null;
  cycle_time_end: string | null;
  assigned_se: string | null;
  labels: string | null;
};

/** Coarse UTC-range prefilter (±1 day for the Manila shift) + exact Manila-day check in JS, same split as the other Phase 4 ports. */
async function fetchStTicketsCreatedBetween(startDate: string, endDate: string): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  const { data, error } = await getSupabaseClient()
    .from("tickets")
    .select("issue_key,issue_type,created,first_out_of_backlog_todo,cycle_time_end,assigned_se,labels")
    .eq("team_key", "ST")
    .gte("created", rangeStartUtc.toISOString())
    .lte("created", rangeEndUtc.toISOString());
  if (error) throw new Error(`Supabase tickets query failed: ${error.message}`);
  return (data ?? []) as TicketRow[];
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `tool-assisted-cycle-time` route. Ported from
 * gas/ToolAssistedApi.gs's getToolAssistedCycleTimeReport_.
 */
export async function getToolAssistedCycleTimeReport(range: string, period: string, label?: string): Promise<ToolAssistedReport> {
  try {
    const normalizedLabel = (label || "tool-assisted").trim().toLowerCase();
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);

    const rows = (await fetchStTicketsCreatedBetween(startDate, endDate)).filter((r) => {
      if (!r.created) return false;
      const createdDate = toManilaDateString(r.created);
      if (!createdDate || createdDate < startDate || createdDate > endDate) return false;
      return cycleTimeEndStatusForIssueType(r.issue_type) === "for peer review";
    });

    const withCycleTime: ToolAssistedTicket[] = rows
      .filter((r) => r.first_out_of_backlog_todo && r.cycle_time_end)
      .map((r) => {
        const labelList = (r.labels || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
        return {
          issueKey: r.issue_key,
          issueType: r.issue_type || "",
          assignee: r.assigned_se || "(unassigned)",
          labels: r.labels || "",
          hasLabel: labelList.includes(normalizedLabel),
          created: r.created,
          todoExitAt: r.first_out_of_backlog_todo!,
          peerReviewAt: r.cycle_time_end!,
          cycleTimeMinutes: round2(minutesBetween(r.first_out_of_backlog_todo!, r.cycle_time_end!)),
        };
      });

    const toolAssisted = withCycleTime.filter((t) => t.hasLabel).sort((a, b) => b.cycleTimeMinutes - a.cycleTimeMinutes);
    const others = withCycleTime.filter((t) => !t.hasLabel);

    const avgMinutes = (list: ToolAssistedTicket[]) =>
      list.length ? round2(list.reduce((sum, t) => sum + t.cycleTimeMinutes, 0) / list.length) : null;

    return {
      team: "ST", range, period,
      label: label || "tool-assisted",
      toolAssisted: { count: toolAssisted.length, avgCycleTimeMinutes: avgMinutes(toolAssisted), tickets: toolAssisted },
      others: { count: others.length, avgCycleTimeMinutes: avgMinutes(others) },
    };
  } catch {
    return { ...EMPTY_REPORT, range, period };
  }
}
