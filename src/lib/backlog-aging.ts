import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, backlogAgingAssignee, backlogAgingAssigneeLabel, isExcludedIssueType } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, isoDateDiffDays } from "@/lib/manila-date";

export type BacklogAgingTicket = {
  teamKey: string;
  issueKey: string;
  issueType: string;
  /** The team's configured owner — Assigned COD for DBA/DevOps, Assigned SE for ST. */
  assignee: string;
  dueDate: string;
  resolvedDate: string;
  daysOverdue: number;
};

export type BacklogAgingReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  /** Column header for `assignee` — "Assigned COD" or "Assigned SE", per the team's config. */
  assigneeLabel: string;
  overdueCount: number;
  resolvedInPeriod: number;
  backlogAgingRate: number | null;
  tickets: BacklogAgingTicket[];
};

const EMPTY_REPORT: BacklogAgingReport = {
  team: "", range: "month", period: "", issueType: null, assigneeLabel: "Assignee",
  overdueCount: 0, resolvedInPeriod: 0, backlogAgingRate: null, tickets: [],
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type ResolvedTicketRow = {
  team_key: string;
  issue_key: string;
  issue_type: string | null;
  resolved_datetime: string;
  due_date: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
};

/**
 * Coarse UTC-range prefilter (widened by a day on each side to safely cover the +8h Manila
 * shift) — cuts down what's transferred for a typical week/month/quarter without risking
 * missing a true match; the exact Manila-day check happens in JS afterward, same as the GAS
 * version's toDisplayDate_ comparison.
 */
async function fetchResolvedTickets(
  teamKeys: string[],
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<ResolvedTicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<ResolvedTicketRow>((from, to) => {
    let query = getSupabaseClient()
      .from("tickets")
      .select("team_key,issue_key,issue_type,resolved_datetime,due_date,assigned_se,assigned_cod")
      .in("team_key", teamKeys)
      .not("resolved_datetime", "is", null)
      .gte("resolved_datetime", rangeStartUtc.toISOString())
      .lte("resolved_datetime", rangeEndUtc.toISOString());
    if (issueType) query = query.eq("issue_type", issueType);
    return query.range(from, to);
  });
}

/**
 * Phase 4 of the Sheets -> Supabase migration: reads the `tickets` table directly instead of
 * proxying through the GAS `backlog-aging-report` route. Ported from
 * gas/BacklogAgingApi.gs's getBacklogAgingReport_ — the overdue test stays character-for-
 * character the same (resolved calendar day strictly later than the due date) so this
 * reconciles with the "N of M resolved overdue" the metrics scorecard reports.
 *
 * A team's excluded issue types (see excludedIssueTypes in lib/teams.ts) are dropped from BOTH the
 * numerator and the denominator here and in lib/metrics.ts.
 */
export async function getBacklogAgingReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<BacklogAgingReport> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const allTeams = await getTeams();
    const teams = team === "ALL" ? allTeams : allTeams.filter((t) => t.team_key === team);
    if (!teams.length) throw new Error(`Unknown team: ${team}`);

    const rows = await fetchResolvedTickets(teams.map((t) => t.team_key), startDate, endDate, issueType);
    const teamByKey = new Map(teams.map((t) => [t.team_key, t]));

    const tickets: BacklogAgingTicket[] = [];
    let resolvedInPeriod = 0;

    for (const r of rows) {
      // Skipped before the denominator, exactly as lib/metrics.ts skips its metrics_daily rows —
      // the two must narrow the population identically or the scorecard's "N of M resolved
      // overdue" stops reconciling with this list.
      if (isExcludedIssueType(r.team_key, r.issue_type)) continue;

      const resolvedIso = toManilaDateString(r.resolved_datetime);
      if (!resolvedIso || resolvedIso < startDate || resolvedIso > endDate) continue;
      resolvedInPeriod++;

      const dueIso = r.due_date;
      if (!dueIso || resolvedIso <= dueIso) continue;

      const teamConfig = teamByKey.get(r.team_key);
      if (!teamConfig) continue;

      tickets.push({
        teamKey: r.team_key,
        issueKey: r.issue_key,
        issueType: r.issue_type || "",
        assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
        dueDate: dueIso,
        resolvedDate: resolvedIso,
        daysOverdue: isoDateDiffDays(dueIso, resolvedIso),
      });
    }

    tickets.sort((a, b) => b.daysOverdue - a.daysOverdue || a.issueKey.localeCompare(b.issueKey));

    return {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: teams.length === 1 ? backlogAgingAssigneeLabel(teams[0]) : "Assignee",
      overdueCount: tickets.length,
      resolvedInPeriod,
      backlogAgingRate: resolvedInPeriod ? round4(tickets.length / resolvedInPeriod) : null,
      tickets,
    };
  } catch {
    return { ...EMPTY_REPORT, team, range, period, issueType: issueType ?? null };
  }
}
