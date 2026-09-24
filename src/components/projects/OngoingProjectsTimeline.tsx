"use client";

import { useState } from "react";
import type { TeamConfig } from "@/lib/teams";
import {
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
import { ProjectsGanttChart } from "@/components/forms/ProjectsGanttChart";
import { ProjectDrilldownPanel } from "@/components/projects/ProjectDrilldownPanel";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";

/** Landing-page timeline — ongoing projects only, bar-only (no task sub-bars), clicking a bar
 * opens the same `ProjectDrilldownPanel` every other entry point uses. Owns its own panel
 * instance, same self-contained-island pattern as `ProjectsView`/`EisenhowerOverview`. */
export function OngoingProjectsTimeline({
  projects,
  teams,
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

  const ongoing = projects.filter((p) => !p.archived && p.status !== "Done");

  return (
    <>
      <ProjectsGanttChart
        projects={ongoing}
        teams={teams}
        processedByProject={processedByProject}
        tasksByProject={tasksByProject}
        showTaskBars={false}
        onProjectClick={(project) => {
          setSelectedId(project.project_id);
          setDrilldownOpen(true);
        }}
      />

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
    </>
  );
}
