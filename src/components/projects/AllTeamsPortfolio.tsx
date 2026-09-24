"use client";

import { useState } from "react";
import {
  projectQuadrantOf,
  type InitiativeTicket,
  type Project,
  type ProjectActivityEntry,
  type ProjectDependency,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectPhase,
  type ProjectPhaseTicket,
  type ProjectRisk,
  type ProjectTask,
} from "@/lib/project-tracking";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Copy } from "@/components/ui/Copy";
import { ProjectDrilldownPanel } from "@/components/projects/ProjectDrilldownPanel";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";

/**
 * Rendered instead of `ProjectMatrix` when no team pill is selected — the matrix's Eisenhower
 * layout doesn't make sense mixed across teams (one Drive square with every team's fires in it
 * tells you nothing), so "All Teams" gets its own, coarser view: one tile per team, the
 * important+urgent list across all of them, and what's coming up next. Owns its own drill-down
 * panel instance, same self-contained-island pattern as EisenhowerOverview/ProjectsView/
 * OngoingProjectsTimeline — clicking a project here opens the same slide-out as everywhere else.
 */
export function AllTeamsPortfolio({
  projects,
  teams,
  blockedProjectIds,
  processedByProject,
  tasksByProject,
  phasesByProject,
  notesByProject,
  activityByProject,
  milestonesByProject,
  dependenciesByProject,
  risksByProject,
  phaseTicketsByProject,
  allTickets,
  linkedTicketsByProject,
  progressTicketOptions,
  jiraBaseUrl,
}: {
  projects: Project[];
  teams: TeamConfig[];
  blockedProjectIds: Set<string>;
  processedByProject: Record<string, number>;
  tasksByProject: Record<string, ProjectTask[]>;
  phasesByProject: Record<string, ProjectPhase[]>;
  notesByProject: Record<string, ProjectNote[]>;
  activityByProject: Record<string, ProjectActivityEntry[]>;
  milestonesByProject: Record<string, ProjectMilestone[]>;
  dependenciesByProject: Record<string, ProjectDependency[]>;
  risksByProject: Record<string, ProjectRisk[]>;
  phaseTicketsByProject: Record<string, ProjectPhaseTicket[]>;
  allTickets: InitiativeTicket[];
  linkedTicketsByProject: Record<string, InitiativeTicket[]>;
  progressTicketOptions: ProgressTicketOption[];
  jiraBaseUrl?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const selectedProject = projects.find((p) => p.project_id === selectedId) ?? null;

  function openProject(project: Project) {
    setSelectedId(project.project_id);
    setDrilldownOpen(true);
  }

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
            <div key={team.team_key} className="relative overflow-hidden card p-4">
              {/* background-color, not a border utility: [data-theme="adhd"] .card sets
                  border-color as an unlayered rule in globals.css, which beats any Tailwind
                  border-* class regardless of specificity — see HealthDot.tsx's healthAccentBg
                  for the full explanation. A bg overlay survives every theme instead. */}
              <span className="absolute inset-x-0 top-0 h-1 bg-sprout-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-neutral-800">{teamLabel(team.team_name)}</h3>
              <p className="text-2xl font-semibold text-sprout-700 mt-1">{teamProjects.length}</p>
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
            <ul className="flex flex-col gap-1">
              {importantUrgent.map((p) => (
                <li key={p.project_id}>
                  <button
                    type="button"
                    onClick={() => openProject(p)}
                    className="w-full text-sm flex items-center justify-between gap-2 hover:text-sprout-700 transition-colors text-left"
                  >
                    <span className="truncate text-neutral-700">{p.project_name}</span>
                    <span className="text-xs text-neutral-400 shrink-0">{labelFor(p.owning_team)}</span>
                  </button>
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
            <ul className="flex flex-col gap-1">
              {upcoming.map((p) => (
                <li key={p.project_id}>
                  <button
                    type="button"
                    onClick={() => openProject(p)}
                    className="w-full text-sm flex items-center justify-between gap-2 hover:text-sprout-700 transition-colors text-left"
                  >
                    <span className="truncate text-neutral-700">{p.project_name}</span>
                    <span className="text-xs text-neutral-400 shrink-0 whitespace-nowrap">
                      {labelFor(p.owning_team)} · {formatManilaDate(p.target_date)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ProjectDrilldownPanel
        project={selectedProject}
        open={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
        teams={teams}
        processedByProject={processedByProject}
        tasksByProject={tasksByProject}
        phasesByProject={phasesByProject}
        notesByProject={notesByProject}
        activityByProject={activityByProject}
        milestonesByProject={milestonesByProject}
        dependenciesByProject={dependenciesByProject}
        risksByProject={risksByProject}
        phaseTicketsByProject={phaseTicketsByProject}
        allTickets={allTickets}
        linkedTicketsByProject={linkedTicketsByProject}
        progressTicketOptions={progressTicketOptions}
        jiraBaseUrl={jiraBaseUrl}
      />
    </div>
  );
}
