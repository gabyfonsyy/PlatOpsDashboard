import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TeamConfig } from "@/lib/teams";
import type { RosterMember } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Team options for the manager-entered forms: the real Jira teams (TEAMS_CONFIG) plus any
 * extra team_keys that only exist in the roster (e.g. "EL" for an Engineering Lead who isn't
 * part of a Jira project). Roster-only keys show the raw key as their label. This keeps such
 * groups selectable in the Leave/RTO forms without adding them to TEAMS_CONFIG (which would
 * pull them into nav, dashboards, and Jira sync).
 */
export function teamSelectOptions(
  teams: TeamConfig[],
  roster: RosterMember[]
): { value: string; label: string }[] {
  const options = teams.map((t) => ({ value: t.team_key, label: teamLabel(t.team_name) }));
  const seen = new Set(teams.map((t) => t.team_key));
  for (const m of roster) {
    const key = String(m.team_key || "").trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      options.push({ value: key, label: key });
    }
  }
  return options;
}

/**
 * Short display label for a team. If team_name carries a parenthetical abbreviation
 * (e.g. "Support Experts (SE)") we show just that abbreviation ("SE"); otherwise the
 * name is used as-is ("DBA", "DevOps"). Lives here (not teams.ts) so client components
 * can use it without pulling in the server-only GAS client.
 */
export function teamLabel(name: string): string {
  const match = name.match(/\(([^)]+)\)/);
  return match ? match[1].trim() : name.trim();
}
