import { projectQuadrantOf, type Project } from "@/lib/project-tracking";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Copy } from "@/components/ui/Copy";

/**
 * Rendered instead of `ProjectMatrix` when no team pill is selected — the matrix's Eisenhower
 * layout doesn't make sense mixed across teams (one Drive square with every team's fires in it
 * tells you nothing), so "All Teams" gets its own, coarser view: one tile per team, the
 * important+urgent list across all of them, and what's coming up next.
 */
export function AllTeamsPortfolio({
  projects,
  teams,
  blockedProjectIds,
}: {
  projects: Project[];
  teams: TeamConfig[];
  blockedProjectIds: Set<string>;
}) {
  const teamNameByKey = new Map(teams.map((t) => [t.team_key, t.team_name]));
  const labelFor = (key: string) => {
    const name = teamNameByKey.get(key);
    return name ? teamLabel(name) : key;
  };

  const byTeam = teams
    .map((t) => ({ team: t, projects: projects.filter((p) => p.owning_team === t.team_key && !p.archived) }))
    .filter((g) => g.projects.length > 0);

  const importantUrgent = projects.filter(
    (p) => !p.archived && p.status !== "Done" && projectQuadrantOf(p) === "drive"
  );

  const upcoming = projects
    .filter((p) => !p.archived && p.status !== "Done" && p.target_date)
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {byTeam.map(({ team, projects: teamProjects }) => {
          const atRisk = teamProjects.filter((p) => p.health === "at_risk" || p.health === "off_track").length;
          const blocked = teamProjects.filter(
            (p) => p.status === "Blocked" || blockedProjectIds.has(p.project_id)
          ).length;
          return (
            <div key={team.team_key} className="card p-4">
              <h3 className="text-sm font-semibold text-neutral-800">{teamLabel(team.team_name)}</h3>
              <p className="text-2xl font-semibold text-neutral-900 mt-1">{teamProjects.length}</p>
              <p className="text-xs text-neutral-500">active projects</p>
              {(atRisk > 0 || blocked > 0) && (
                <div className="flex items-center gap-1 mt-2">
                  {atRisk > 0 && <Badge tone="warning">{atRisk} at risk</Badge>}
                  {blocked > 0 && <Badge tone="danger">{blocked} blocked</Badge>}
                </div>
              )}
            </div>
          );
        })}
        {byTeam.length === 0 && (
          <p className="text-sm text-neutral-400 col-span-full">
            <Copy serious="No active projects across any team yet." playful="Every team's board is empty — a quiet day." />
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-neutral-800 mb-2">Important + Urgent</h3>
          {importantUrgent.length === 0 ? (
            <p className="text-sm text-neutral-400">
              <Copy serious="Nothing in Drive right now." playful="Nothing urgent and important — enjoy it." />
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {importantUrgent.map((p) => (
                <li key={p.project_id} className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate text-neutral-700">{p.project_name}</span>
                  <span className="text-xs text-neutral-400 shrink-0">{labelFor(p.owning_team)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-neutral-800 mb-2">Upcoming Deadlines</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-neutral-400">
              <Copy serious="No target dates on the horizon." playful="Nothing due on the horizon." />
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {upcoming.map((p) => (
                <li key={p.project_id} className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate text-neutral-700">{p.project_name}</span>
                  <span className="text-xs text-neutral-400 shrink-0 whitespace-nowrap">
                    {labelFor(p.owning_team)} · {formatManilaDate(p.target_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
