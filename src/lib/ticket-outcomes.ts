import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import {
  getTeams,
  excludedIssueTypes,
  isExcludedIssueType,
  backlogAgingAssignee,
  backlogAgingAssigneeLabel,
  type TeamConfig,
} from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString } from "@/lib/manila-date";
import { teamLabel } from "@/lib/utils";
import { BREAKDOWN_TICKET_LIMIT, type CountRow } from "@/lib/ticket-breakdowns";

export type OutcomeKind = "cancelled" | "archived" | "rejected";

/** Ticket count with an empty/null reason field is a fact, not a gap — never dropped silently. */
export const NO_REASON_LABEL = "No Reason Provided";

type OutcomeDef = {
  /** Jira status name(s) that count as this outcome, matched case/whitespace-insensitively. */
  statusNames: string[];
  /** Display form of the primary status name, for prose (tooltips, etc). */
  statusLabel: string;
  reasonColumn: "cancellation_reason" | "archive_reason" | "rejection_category";
  reasonLabel: string;
  pageTitle: string;
  cardLabel: string;
};

/**
 * One row per outcome, matching the brief's Section 4 table exactly. `statusNames` for
 * "cancelled" includes both spellings — the same pair gas/Aggregation.gs's
 * excludeFromAssigneePerf_ treats as terminal for DE/DEV.
 */
const OUTCOME_DEFS: Record<OutcomeKind, OutcomeDef> = {
  cancelled: {
    statusNames: ["cancelled", "canceled"],
    statusLabel: "Cancelled",
    reasonColumn: "cancellation_reason",
    reasonLabel: "Cancellation Reason",
    pageTitle: "Cancelled Tickets",
    cardLabel: "Cancelled Tickets",
  },
  archived: {
    statusNames: ["archived"],
    statusLabel: "Archived",
    reasonColumn: "archive_reason",
    reasonLabel: "Archive Reason",
    pageTitle: "Archived Tickets",
    cardLabel: "Archived Tickets",
  },
  rejected: {
    statusNames: ["rejected"],
    statusLabel: "Rejected",
    reasonColumn: "rejection_category",
    reasonLabel: "Ticket Rejection Category",
    pageTitle: "Rejected Tickets",
    cardLabel: "Rejected Tickets",
  },
};

export function outcomeDef(outcome: OutcomeKind): OutcomeDef {
  return OUTCOME_DEFS[outcome];
}

/**
 * Which outcomes a team's tickets can actually reach — the same terminal-status vocabulary
 * switch gas/Aggregation.gs's excludeFromAssigneePerf_ already uses: ST-shaped teams
 * (has_fcr_escalation) terminate work via Archived/Rejected, DE/DEV terminate via Cancelled.
 * Reused rather than adding a new teams_config flag, since this one already draws exactly the
 * line this feature needs.
 */
export function teamHasOutcome(team: TeamConfig, outcome: OutcomeKind): boolean {
  return outcome === "cancelled" ? !team.has_fcr_escalation : team.has_fcr_escalation;
}

export function outcomesForTeam(team: TeamConfig): OutcomeKind[] {
  return (Object.keys(OUTCOME_DEFS) as OutcomeKind[]).filter((o) => teamHasOutcome(team, o));
}

export type OutcomeTicket = {
  issueKey: string;
  issueType: string;
  team: string;
  assignee: string;
  status: string;
  /** Already defaulted to NO_REASON_LABEL — never blank. */
  reason: string;
  createdAt: string;
  resolvedAt: string;
};

export type TicketOutcomeReport = {
  team: string;
  outcome: OutcomeKind;
  range: string;
  period: string;
  issueType: string | null;
  reasonFilter: string | null;
  assigneeLabel: string;
  reasonLabel: string;
  pageTitle: string;
  /** Every ticket resolved in the period, this outcome or not — the scorecard's denominator. */
  resolvedInPeriod: number;
  outcomeCount: number;
  outcomeShare: number | null;
  /**
   * Always computed over the FULL outcome population for the period, independent of
   * reasonFilter — so the breakdown stays a stable reference (and its counts keep summing to
   * outcomeCount, "No Reason Provided" included) no matter which reason the ticket table below
   * is currently filtered to.
   */
  byReason: CountRow[];
  /** Matching reasonFilter, before the BREAKDOWN_TICKET_LIMIT cap — for the table's truncation note. */
  ticketsTotalCount: number;
  tickets: OutcomeTicket[];
};

export type TicketOutcomeCardData = {
  outcome: OutcomeKind;
  count: number;
  resolvedInPeriod: number;
  share: number | null;
  byReason: CountRow[];
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function toCountRows(counts: Record<string, number>, denominator: number): CountRow[] {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count, share: denominator ? round4(count / denominator) : null }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

type OutcomeRow = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
  created: string;
  resolved_datetime: string;
  cancellation_reason: string | null;
  archive_reason: string | null;
  rejection_category: string | null;
};

const SELECT =
  "issue_key,issue_type,status,assigned_se,assigned_cod,created,resolved_datetime," +
  "cancellation_reason,archive_reason,rejection_category";

/**
 * Every ticket RESOLVED in the period, regardless of outcome — the same basis every other Team
 * Stats drill-down uses (see lib/ticket-breakdowns.ts's fetchResolvedRows), so this feature
 * reconciles with the cards beside the ones that link here. Coarse UTC prefilter widened a day
 * each side, exact Manila-day check in JS — the same split as every other report in this app.
 */
async function fetchResolvedRows(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<OutcomeRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  const excluded = excludedIssueTypes(teamKey);

  return fetchAllRows<OutcomeRow>((from, to) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(SELECT)
      .eq("team_key", teamKey)
      .not("resolved_datetime", "is", null)
      .gte("resolved_datetime", rangeStartUtc.toISOString())
      .lte("resolved_datetime", rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    // MANDATORY — see automated-tickets.ts's buildResolvedQuery for why an unordered .range()
    // page silently drops and duplicates rows.
    return q.order("issue_key").range(from, to);
  });
}

function statusMatches(status: string | null, outcome: OutcomeKind): boolean {
  const set = new Set(OUTCOME_DEFS[outcome].statusNames);
  return set.has((status || "").trim().toLowerCase());
}

function reasonValue(row: OutcomeRow, outcome: OutcomeKind): string {
  const raw = row[OUTCOME_DEFS[outcome].reasonColumn];
  const trimmed = (raw || "").trim();
  return trimmed || NO_REASON_LABEL;
}

function toTicket(r: OutcomeRow, teamConfig: TeamConfig, outcome: OutcomeKind): OutcomeTicket {
  return {
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    team: teamLabel(teamConfig.team_name),
    assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
    status: r.status || "",
    reason: reasonValue(r, outcome),
    createdAt: r.created,
    resolvedAt: r.resolved_datetime,
  };
}

async function loadOutcomeScope(team: string, outcome: OutcomeKind, range: string, period: string, issueType?: string) {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const teamConfig = (await getTeams()).find((t) => t.team_key === team);
  if (!teamConfig) throw new Error(`Unknown team: ${team}`);

  const allResolved = (await fetchResolvedRows(team, startDate, endDate, issueType)).filter((r) => {
    if (isExcludedIssueType(team, r.issue_type)) return false;
    const iso = toManilaDateString(r.resolved_datetime);
    return iso !== null && iso >= startDate && iso <= endDate;
  });
  const outcomeRows = allResolved.filter((r) => statusMatches(r.status, outcome));
  return { teamConfig, resolvedInPeriod: allResolved.length, outcomeRows };
}

const emptyReport = (
  team: string,
  outcome: OutcomeKind,
  range: string,
  period: string,
  issueType: string | undefined,
  reasonFilter: string | undefined
): TicketOutcomeReport => ({
  team, outcome, range, period, issueType: issueType ?? null, reasonFilter: reasonFilter ?? null,
  assigneeLabel: "Assignee",
  reasonLabel: OUTCOME_DEFS[outcome].reasonLabel,
  pageTitle: OUTCOME_DEFS[outcome].pageTitle,
  resolvedInPeriod: 0, outcomeCount: 0, outcomeShare: null, byReason: [], ticketsTotalCount: 0, tickets: [],
});

/**
 * Full drill-down report for one outcome (Cancelled/Archived/Rejected) on one team.
 *
 * `reasonFilter`, when given, narrows ONLY the ticket table (`tickets`/`ticketsTotalCount`) — see
 * TicketOutcomeReport.byReason's doc comment for why the breakdown itself stays unfiltered.
 */
export async function getTicketOutcomeReport(
  team: string,
  outcome: OutcomeKind,
  range: string,
  period: string,
  issueType?: string,
  reasonFilter?: string
): Promise<TicketOutcomeReport> {
  try {
    const { teamConfig, resolvedInPeriod, outcomeRows } = await loadOutcomeScope(team, outcome, range, period, issueType);
    const def = OUTCOME_DEFS[outcome];

    const reasonCounts: Record<string, number> = {};
    for (const r of outcomeRows) {
      const reason = reasonValue(r, outcome);
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }

    const filtered = reasonFilter ? outcomeRows.filter((r) => reasonValue(r, outcome) === reasonFilter) : outcomeRows;
    const tickets = filtered
      .slice()
      .sort((a, b) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1))
      .slice(0, BREAKDOWN_TICKET_LIMIT)
      .map((r) => toTicket(r, teamConfig, outcome));

    return {
      team, outcome, range, period, issueType: issueType ?? null, reasonFilter: reasonFilter ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      reasonLabel: def.reasonLabel,
      pageTitle: def.pageTitle,
      resolvedInPeriod,
      outcomeCount: outcomeRows.length,
      outcomeShare: resolvedInPeriod ? round4(outcomeRows.length / resolvedInPeriod) : null,
      byReason: toCountRows(reasonCounts, outcomeRows.length),
      ticketsTotalCount: filtered.length,
      tickets,
    };
  } catch {
    return emptyReport(team, outcome, range, period, issueType, reasonFilter);
  }
}

/**
 * Every outcome applicable to this team (see outcomesForTeam), computed from ONE shared fetch of
 * the period's resolved tickets — so the SE team page's two cards (Archived + Rejected) cost one
 * round trip, not two. Empty array for a team with no applicable outcome (DE/DEV, once ST-only
 * outcomes are asked for, or vice versa) or on any failure.
 */
export async function getTicketOutcomeCards(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<TicketOutcomeCardData[]> {
  try {
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) return [];
    const outcomes = outcomesForTeam(teamConfig);
    if (!outcomes.length) return [];

    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const allResolved = (await fetchResolvedRows(team, startDate, endDate, issueType)).filter((r) => {
      if (isExcludedIssueType(team, r.issue_type)) return false;
      const iso = toManilaDateString(r.resolved_datetime);
      return iso !== null && iso >= startDate && iso <= endDate;
    });

    return outcomes.map((outcome) => {
      const rows = allResolved.filter((r) => statusMatches(r.status, outcome));
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const reason = reasonValue(r, outcome);
        counts[reason] = (counts[reason] || 0) + 1;
      }
      return {
        outcome,
        count: rows.length,
        resolvedInPeriod: allResolved.length,
        share: allResolved.length ? round4(rows.length / allResolved.length) : null,
        byReason: toCountRows(counts, rows.length),
      };
    });
  } catch {
    return [];
  }
}
