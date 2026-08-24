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
 * Issue types that never count toward Backlog Aging, on any team.
 *
 * "Technical Story" is ST/SE internal engineering work — a due date on one is a planning marker
 * the team sets for itself, not a commitment to a requester, so resolving one late is not the
 * service failure the Backlog Aging rate is meant to surface. Leaving it in let a sprint's worth
 * of self-imposed dates swamp the metric.
 *
 * Applied ONLY to Backlog Aging (both the scorecard in lib/metrics.ts and the drill-down in
 * lib/backlog-aging.ts, which have to agree or the "N of M" under the card stops reconciling with
 * the list it links to). Ticket Volume, Lead Time and Cycle Time still count these tickets — they
 * are real work and those metrics are not judgments about lateness.
 *
 * Listed for every team rather than gated on a team flag: no other team currently uses the type,
 * so the filter is a no-op elsewhere, and a team that adopts it later gets the intended treatment
 * without another code change.
 */
export const BACKLOG_AGING_EXCLUDED_ISSUE_TYPES = ["Technical Story"];

/** Case/whitespace-insensitive so a Jira rename to "technical story" doesn't silently re-include it. */
export function isExcludedFromBacklogAging(issueType: string | null | undefined): boolean {
  const normalized = (issueType || "").trim().toLowerCase();
  return BACKLOG_AGING_EXCLUDED_ISSUE_TYPES.some((t) => t.toLowerCase() === normalized);
}
