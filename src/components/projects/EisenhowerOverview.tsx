"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { QUADRANT_ORDER, QUADRANT_META, type Quadrant } from "@/lib/work";
import {
  projectMatrixTally,
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
import { cn } from "@/lib/utils";
import { HealthDot } from "@/components/projects/HealthDot";
import { QuadrantProjectsPanel } from "@/components/projects/QuadrantProjectsPanel";
import { ProjectDrilldownPanel } from "@/components/projects/ProjectDrilldownPanel";
import { resolveDisplayPercent } from "@/lib/projection";
import { Copy } from "@/components/ui/Copy";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";

const PREVIEW_LIMIT = 3;

/**
 * The landing-page Eisenhower matrix: four compact, purely navigational tiles (name, axis, count,
 * up to 3 project previews with a health dot + %) plus an "Unsorted" row when anything hasn't been
 * triaged. No inline `QuadrantSelect` here anymore — priority reassignment lives in the project
 * detail panel, which already has it. Orchestrates the two-level drill-down: tile click opens
 * `QuadrantProjectsPanel`, card click there closes it and opens the (unchanged)
 * `ProjectDrilldownPanel` — a sequential swap, never two `SidePanel`s open at once.
 */
export function EisenhowerOverview({
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
  blockedProjectIds,
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
  blockedProjectIds: Set<string>;
  phaseTicketsByProject: Record<string, ProjectPhaseTicket[]>;
  allTickets: InitiativeTicket[];
  linkedTicketsByProject: Record<string, InitiativeTicket[]>;
  progressTicketOptions: ProgressTicketOption[];
  jiraBaseUrl?: string;
}) {
  const { cells, unsorted } = projectMatrixTally(projects);
  const [openQuadrant, setOpenQuadrant] = useState<Quadrant | "unsorted" | null>(null);
  // Selection persists across close (only ever set, never cleared to null) — same reasoning as
  // OverviewQuickPanel's own data: the drill-down keeps showing the last-viewed project while the
  // SidePanel's slide-out transition plays, instead of the content vanishing mid-animation.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const selectedProject = projects.find((p) => p.project_id === selectedId) ?? null;

  function openProject(project: Project) {
    setOpenQuadrant(null);
    setSelectedId(project.project_id);
    setDrilldownOpen(true);
  }

  const activeQuadrantProjects: Project[] =
    openQuadrant === null ? [] : openQuadrant === "unsorted" ? unsorted : cells[openQuadrant];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {QUADRANT_ORDER.map((q) => {
          const meta = QUADRANT_META[q];
          const items = cells[q];
          const preview = items.slice(0, PREVIEW_LIMIT);
          return (
            <div
              key={q}
              className={cn("card border-l-2 p-4 flex flex-col gap-2 hover:shadow-md transition-shadow", meta.accent)}
            >
              <button type="button" onClick={() => setOpenQuadrant(q)} className="text-left flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className={cn("text-sm font-semibold", meta.text)}>{meta.verb}</h3>
                  <span className="text-xs text-neutral-400 shrink-0">{items.length}</span>
                </div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">{meta.axis}</p>
                <p className="text-xs text-neutral-500 -mt-1">
                  <Copy serious={meta.line} playful={meta.playful.line} />
                </p>
              </button>

              {preview.length === 0 ? (
                <p className="text-xs text-neutral-400 italic">
                  <Copy serious="Nothing here." playful="All clear here." />
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {preview.map((p) => {
                    const tasks = tasksByProject[p.project_id] ?? [];
                    const taskStats =
                      tasks.length > 0 ? { total: tasks.length, done: tasks.filter((t) => t.done).length } : undefined;
                    const pct = resolveDisplayPercent(p, processedByProject[p.project_id], taskStats);
                    return (
                      <li key={p.project_id}>
                        <button
                          type="button"
                          onClick={() => openProject(p)}
                          className="w-full flex items-center gap-1.5 text-xs text-neutral-700 hover:text-sprout-700 transition-colors text-left"
                        >
                          <HealthDot health={p.health} />
                          <span className="truncate flex-1 min-w-0">{p.project_name}</span>
                          <span className="text-neutral-400 shrink-0">{pct}%</span>
                        </button>
                      </li>
                    );
                  })}
                  {items.length > preview.length && (
                    <li className="text-[11px] text-neutral-400">+{items.length - preview.length} more</li>
                  )}
                </ul>
              )}

              <button
                type="button"
                onClick={() => setOpenQuadrant(q)}
                className="text-xs text-sprout-700 font-medium mt-1 inline-flex items-center gap-1 self-start"
              >
                View Quadrant <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {unsorted.length > 0 && (
        <button
          type="button"
          onClick={() => setOpenQuadrant("unsorted")}
          className="card p-3 text-left flex items-center justify-between gap-2 hover:shadow-md transition-shadow"
        >
          <span className="text-sm text-neutral-600">
            {unsorted.length} project{unsorted.length === 1 ? "" : "s"} not sorted into the matrix yet
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        </button>
      )}

      <QuadrantProjectsPanel
        quadrant={openQuadrant}
        onClose={() => setOpenQuadrant(null)}
        projects={activeQuadrantProjects}
        teams={teams}
        processedByProject={processedByProject}
        tasksByProject={tasksByProject}
        phasesByProject={phasesByProject}
        onProjectClick={openProject}
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
    </div>
  );
}
