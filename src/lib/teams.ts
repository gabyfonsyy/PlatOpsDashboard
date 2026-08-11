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
