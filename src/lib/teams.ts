import { fetchGas } from "@/lib/gas-client";

export type TeamConfig = {
  team_key: string;
  team_name: string;
  jira_project_key: string;
  resolved_date_field_type: "native" | "text";
  resolved_date_field_id: string;
  assignee_field_id: string;
  has_fcr_escalation: boolean;
  has_holding_reason: boolean;
  has_rejection_category: boolean;
  has_cancellation_reason: boolean;
  has_peer_review_tracking: boolean;
  backlog_status_names_csv: string;
  issue_types_csv: string;
  color_accent: string;
  active: boolean;
  sort_order: number;
};

/** Server-side cached fetch of the TEAMS_CONFIG tab — drives nav/tabs and per-team routing. */
export async function getTeams(): Promise<TeamConfig[]> {
  const teams = await fetchGas<TeamConfig[]>("teams", {}, { next: { revalidate: 300 } });
  return teams.filter((t) => t.active).sort((a, b) => a.sort_order - b.sort_order);
}

export async function getTeamByKey(teamKey: string): Promise<TeamConfig | undefined> {
  const teams = await getTeams();
  return teams.find((t) => t.team_key.toLowerCase() === teamKey.toLowerCase());
}

/**
 * The team's configured owner column — same switch gas/Aggregation.gs uses for per-assignee
 * rollups, and every Phase 4 report drill-down (Backlog Aging, Lead/Cycle Time, ...) needs it.
 */
export function backlogAgingAssignee(team: TeamConfig, row: { assigned_se: string | null; assigned_cod: string | null }): string {
  return (team.assignee_field_id === "customfield_10189" ? row.assigned_se : row.assigned_cod) || "";
}

export function backlogAgingAssigneeLabel(team: TeamConfig): string {
  return team.assignee_field_id === "customfield_10189" ? "Assigned SE" : "Assigned COD";
}

/**
 * Issue types a team does not count in ANY metric — excluded from Ticket Volume, Lead Time, Cycle
 * Time, Backlog Aging, FCR, Escalation and every drill-down, not merely filtered out of one card.
 *
 * "Technical Story" is SE/ST internal engineering work. It is not requester-facing delivery, and a
 * due date on one is a planning marker the team sets for itself rather than a commitment to anyone
 * — so counting it made every SE metric partly a measurement of the team's own sprint hygiene.
 * Gaby asked for it out of the computations entirely on 2026-08-24 (it was scoped to Backlog Aging
 * only earlier that day).
 *
 * Keyed by team so this cannot quietly change another team's numbers; SE/ST is the only team that
 * uses the type today.
 */
const EXCLUDED_ISSUE_TYPES_BY_TEAM: Record<string, string[]> = {
  ST: ["Technical Story"],
};

/** The excluded types for one team, or [] — safe to spread into a query builder unconditionally. */
export function excludedIssueTypes(teamKey: string): string[] {
  return EXCLUDED_ISSUE_TYPES_BY_TEAM[teamKey] ?? [];
}

/**
 * Case/whitespace-insensitive so a Jira rename to "technical story" doesn't silently re-include
 * it. `teamKey` matters: the same issue-type name on another team is not excluded.
 */
export function isExcludedIssueType(teamKey: string, issueType: string | null | undefined): boolean {
  const normalized = (issueType || "").trim().toLowerCase();
  return excludedIssueTypes(teamKey).some((t) => t.toLowerCase() === normalized);
}
