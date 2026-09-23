"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUADRANT_ORDER, type Triage } from "@/lib/work";
import { QuadrantCell, QuadrantSelect } from "@/components/work/Quadrant";
import { projectMatrixTally, type Project, type ProjectPhase, type ProjectTask } from "@/lib/project-tracking";
import { ProjectDrilldownPanel } from "@/components/projects/ProjectDrilldownPanel";
import type { TeamConfig } from "@/lib/teams";
import { cn } from "@/lib/utils";

/**
 * Eisenhower matrix for the team-filtered project list, built from the same shared pieces My
 * Work's board uses (QuadrantCell/QuadrantSelect) — the UI concept is borrowed, the data is not:
 * this reads/writes `projects`, never `work_projects`. A row click (anywhere but the quadrant
 * select itself) opens the Phase 2 drill-down panel for that project.
 */
export function ProjectMatrix({
  projects,
  teams,
  processedByProject,
  tasksByProject,
  phasesByProject,
}: {
  projects: Project[];
  teams: TeamConfig[];
  processedByProject: Record<string, number>;
  tasksByProject: Record<string, ProjectTask[]>;
  phasesByProject: Record<string, ProjectPhase[]>;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selection persists across close (only ever set, never cleared to null) so the drill-down keeps
  // showing the last-viewed project while the SidePanel's own slide-out transition plays, instead
  // of the content vanishing mid-animation — same approach OverviewQuickPanel uses for its data.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const { cells, unsorted } = projectMatrixTally(projects);
  const selectedProject = projects.find((p) => p.project_id === selectedId) ?? null;

  function openDrilldown(project: Project) {
    setSelectedId(project.project_id);
    setDrilldownOpen(true);
  }

  async function onQuadrantChange(project: Project, next: Triage) {
    setPendingId(project.project_id);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.project_id, urgent: next.urgent, important: next.important }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(`Could not update “${project.project_name}”: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="form-error">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {QUADRANT_ORDER.map((q) => (
          <QuadrantCell key={q} quadrant={q} count={cells[q].length}>
            {cells[q].length === 0 ? (
              <p className="text-xs text-neutral-400 italic">Nothing here.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {cells[q].map((p, i) => (
                  <ProjectMatrixRow
                    key={p.project_id}
                    index={i + 1}
                    project={p}
                    pending={pendingId === p.project_id}
                    onQuadrantChange={onQuadrantChange}
                    onOpen={openDrilldown}
                  />
                ))}
              </ol>
            )}
          </QuadrantCell>
        ))}
      </div>

      {unsorted.length > 0 && (
        <div className="card p-3 flex flex-col gap-1.5">
          <p className="text-xs text-neutral-500">
            {unsorted.length} project{unsorted.length === 1 ? "" : "s"} not sorted into the matrix yet
          </p>
          <ol className="flex flex-col gap-1.5">
            {unsorted.map((p, i) => (
              <ProjectMatrixRow
                key={p.project_id}
                index={i + 1}
                project={p}
                pending={pendingId === p.project_id}
                onQuadrantChange={onQuadrantChange}
                onOpen={openDrilldown}
              />
            ))}
          </ol>
        </div>
      )}

      <ProjectDrilldownPanel
        project={selectedProject}
        open={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
        teams={teams}
        processedByProject={processedByProject}
        tasksByProject={tasksByProject}
        phasesByProject={phasesByProject}
      />
    </div>
  );
}

function ProjectMatrixRow({
  index,
  project,
  pending,
  onQuadrantChange,
  onOpen,
}: {
  index: number;
  project: Project;
  pending: boolean;
  onQuadrantChange: (project: Project, next: Triage) => void;
  onOpen: (project: Project) => void;
}) {
  return (
    <li className={cn("flex items-center gap-2 text-sm", pending && "opacity-60")}>
      <span className="text-neutral-300 w-4 text-right shrink-0">{index}.</span>
      <button
        type="button"
        onClick={() => onOpen(project)}
        className="flex-1 min-w-0 truncate text-left text-neutral-800 hover:text-sprout-700 transition-colors"
        title={project.project_name}
      >
        {project.project_name}
      </button>
      <QuadrantSelect
        value={project as Triage}
        onChange={(next) => onQuadrantChange(project, next)}
        label={`Quadrant for ${project.project_name}`}
      />
    </li>
  );
}
