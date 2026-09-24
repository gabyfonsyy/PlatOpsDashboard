"use client";

import { useMemo, useState } from "react";
import type { TeamConfig } from "@/lib/teams";
import {
  EMPTY_PROJECT_FILTERS,
  currentPhaseFor,
  isBlocked,
  projectMatchesFilters,
  type InitiativeTicket,
  type Project as ProjectRecord,
  type ProjectActivityEntry,
  type ProjectDependency,
  type ProjectFilterCriteria,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectPhase,
  type ProjectPhaseTicket,
  type ProjectRisk,
  type ProjectTask as TaskRecord,
} from "@/lib/project-tracking";
import { resolveDisplayPercent } from "@/lib/projection";
import { teamLabel } from "@/lib/utils";
import { FiltersBar } from "@/components/projects/FiltersBar";
import { ProjectSummaryCard } from "@/components/projects/ProjectSummaryCard";
import { ProjectDrilldownPanel } from "@/components/projects/ProjectDrilldownPanel";
import { Accordion } from "@/components/ui/Accordion";
import { Copy } from "@/components/ui/Copy";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";

/**
 * Ongoing + Completed sections of the landing page — compact `ProjectSummaryCard`s, narrowed by
 * `FiltersBar` (unchanged logic, just feeding cards instead of a `<table>` now). Owns its own
 * drill-down panel instance, same self-contained-island pattern the edge-tab panels already use,
 * rather than lifting selection state up to a shared parent with `EisenhowerOverview`.
 */
export function ProjectsView({
  projects,
  teams,
  linkedCount,
  processedByProject = {},
  tasksByProject = {},
  tickets = [],
  jiraBaseUrl,
  phasesByProject = {},
  notesByProject = {},
  activityByProject = {},
  milestonesByProject = {},
  dependenciesByProject = {},
  risksByProject = {},
  phaseTicketsByProject = {},
  allTickets = [],
  linkedTicketsByProject = {},
}: {
  projects: ProjectRecord[];
  teams: TeamConfig[];
  linkedCount: Record<string, number>;
  processedByProject?: Record<string, number>;
  tasksByProject?: Record<string, TaskRecord[]>;
  tickets?: ProgressTicketOption[];
  jiraBaseUrl?: string;
  phasesByProject?: Record<string, ProjectPhase[]>;
  notesByProject?: Record<string, ProjectNote[]>;
  activityByProject?: Record<string, ProjectActivityEntry[]>;
  milestonesByProject?: Record<string, ProjectMilestone[]>;
  dependenciesByProject?: Record<string, ProjectDependency[]>;
  risksByProject?: Record<string, ProjectRisk[]>;
  phaseTicketsByProject?: Record<string, ProjectPhaseTicket[]>;
  allTickets?: InitiativeTicket[];
  linkedTicketsByProject?: Record<string, InitiativeTicket[]>;
}) {
  const [criteria, setCriteria] = useState<ProjectFilterCriteria>(EMPTY_PROJECT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const selectedProject = projects.find((p) => p.project_id === selectedId) ?? null;

  function openProject(project: ProjectRecord) {
    setSelectedId(project.project_id);
    setDrilldownOpen(true);
  }

  const teamNameByKey = new Map(teams.map((t) => [t.team_key, t.team_name]));
  const labelFor = (key: string) => {
    const name = teamNameByKey.get(key);
    return name ? teamLabel(name) : key;
  };

  const visibleProjects = useMemo(
    () =>
      projects.filter((p) =>
        projectMatchesFilters(p, criteria, {
          phases: phasesByProject[p.project_id] ?? [],
          blocked: isBlocked(notesByProject[p.project_id] ?? []),
          hasOpenRisk: (risksByProject[p.project_id] ?? []).some((r) => r.status === "open"),
          linkedTicketCount: linkedCount[p.project_id] ?? 0,
        })
      ),
    [projects, criteria, phasesByProject, notesByProject, risksByProject, linkedCount]
  );

  const activeProjects = visibleProjects.filter((p) => p.status !== "Done");
  const completedProjects = visibleProjects.filter((p) => p.status === "Done");

  function renderCards(list: ProjectRecord[], emptySerious: string, emptyPlayful: string) {
    if (list.length === 0) {
      return (
        <p className="text-sm text-neutral-400">
          <Copy serious={emptySerious} playful={emptyPlayful} />
        </p>
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((p) => {
          const tasks = tasksByProject[p.project_id] ?? [];
          const taskStats = tasks.length > 0 ? { total: tasks.length, done: tasks.filter((t) => t.done).length } : undefined;
          const pct = resolveDisplayPercent(p, processedByProject[p.project_id], taskStats);
          const phase = currentPhaseFor(phasesByProject[p.project_id] ?? []);
          return (
            <ProjectSummaryCard
              key={p.project_id}
              project={p}
              teamLabel={labelFor(p.owning_team)}
              percentComplete={pct}
              currentPhaseName={phase?.name ?? null}
              onClick={() => openProject(p)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FiltersBar criteria={criteria} onChange={setCriteria} />

      <Accordion title="Ongoing Projects" count={activeProjects.length} countLabel="active" defaultOpen>
        {renderCards(activeProjects, "No projects match these filters.", "Nothing matches — try loosening a filter.")}
      </Accordion>

      {completedProjects.length > 0 && (
        <Accordion title="Completed Projects" count={completedProjects.length} countLabel="done" defaultOpen={false}>
          {renderCards(completedProjects, "No completed projects yet.", "Nothing wrapped up yet.")}
        </Accordion>
      )}

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
        progressTicketOptions={tickets}
        jiraBaseUrl={jiraBaseUrl}
      />
    </div>
  );
}
