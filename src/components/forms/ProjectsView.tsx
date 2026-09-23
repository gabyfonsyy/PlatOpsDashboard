"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import {
  EMPTY_PROJECT_FILTERS,
  isBlocked,
  projectMatchesFilters,
  type Project as ProjectRecord,
  type ProjectActivityEntry,
  type ProjectFilterCriteria,
  type ProjectNote,
  type ProjectPhase,
  type ProjectRisk,
  type ProjectTask as TaskRecord,
} from "@/lib/project-tracking";
import { cn } from "@/lib/utils";
import { ProjectsTable } from "@/components/forms/ProjectsTable";
import { ProjectsGanttChart } from "@/components/forms/ProjectsGanttChart";
import { FiltersBar } from "@/components/projects/FiltersBar";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";

type View = "table" | "gantt";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "table", label: "Table" },
  { value: "gantt", label: "Timeline" },
];

function AccordionSection({
  title,
  count,
  countLabel,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  countLabel: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight className={cn("w-4 h-4 text-neutral-400 shrink-0 transition-transform", open && "rotate-90")} />
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        </div>
        <span className="text-xs text-neutral-400 whitespace-nowrap">
          {count} {countLabel}
        </span>
      </button>

      {open && <div className="border-t border-neutral-200/70 p-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

export function ProjectsView({
  projects,
  teams,
  linkedCount,
  processedByProject,
  tasksByProject,
  tickets,
  jiraBaseUrl,
  phasesByProject,
  notesByProject,
  risksByProject,
  activityByProject,
}: {
  projects: ProjectRecord[];
  teams: TeamConfig[];
  linkedCount: Record<string, number>;
  processedByProject?: Record<string, number>;
  tasksByProject?: Record<string, TaskRecord[]>;
  tickets?: ProgressTicketOption[];
  jiraBaseUrl?: string;
  /** Phase 6 filter/stale-signal context — optional so any other caller of this component keeps
   * working unfiltered/unbadged rather than needing every one of these maps. */
  phasesByProject?: Record<string, ProjectPhase[]>;
  notesByProject?: Record<string, ProjectNote[]>;
  risksByProject?: Record<string, ProjectRisk[]>;
  activityByProject?: Record<string, ProjectActivityEntry[]>;
}) {
  const [view, setView] = useState<View>("table");
  const [criteria, setCriteria] = useState<ProjectFilterCriteria>(EMPTY_PROJECT_FILTERS);

  const visibleProjects = useMemo(
    () =>
      projects.filter((p) =>
        projectMatchesFilters(p, criteria, {
          phases: phasesByProject?.[p.project_id] ?? [],
          blocked: isBlocked(notesByProject?.[p.project_id] ?? []),
          hasOpenRisk: (risksByProject?.[p.project_id] ?? []).some((r) => r.status === "open"),
          linkedTicketCount: linkedCount[p.project_id] ?? 0,
        })
      ),
    [projects, criteria, phasesByProject, notesByProject, risksByProject, linkedCount]
  );

  const activeProjects = visibleProjects.filter((p) => p.status !== "Done");
  const completedProjects = visibleProjects.filter((p) => p.status === "Done");

  return (
    <div className="flex flex-col gap-4">
      <FiltersBar criteria={criteria} onChange={setCriteria} />

      <AccordionSection title="Projects" count={activeProjects.length} countLabel="active" defaultOpen>
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1 w-fit">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setView(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                view === opt.value ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {view === "table" ? (
          <ProjectsTable
            projects={activeProjects}
            teams={teams}
            linkedCount={linkedCount}
            processedByProject={processedByProject}
            tasksByProject={tasksByProject}
            tickets={tickets}
            jiraBaseUrl={jiraBaseUrl}
            activityByProject={activityByProject}
            bare
          />
        ) : (
          <ProjectsGanttChart
            projects={activeProjects}
            teams={teams}
            processedByProject={processedByProject}
            tasksByProject={tasksByProject}
            bare
          />
        )}
      </AccordionSection>

      {completedProjects.length > 0 && (
        <AccordionSection title="Completed Projects" count={completedProjects.length} countLabel="done" defaultOpen={false}>
          <ProjectsTable
            projects={completedProjects}
            teams={teams}
            linkedCount={linkedCount}
            processedByProject={processedByProject}
            tasksByProject={tasksByProject}
            tickets={tickets}
            jiraBaseUrl={jiraBaseUrl}
            activityByProject={activityByProject}
            bare
          />
        </AccordionSection>
      )}
    </div>
  );
}
