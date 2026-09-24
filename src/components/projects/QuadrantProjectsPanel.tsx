"use client";

import { QUADRANT_META, type Quadrant } from "@/lib/work";
import { currentPhaseFor, type Project, type ProjectPhase, type ProjectTask } from "@/lib/project-tracking";
import { resolveDisplayPercent } from "@/lib/projection";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { SidePanel } from "@/components/ui/SidePanel";
import { ProjectSummaryCard } from "@/components/projects/ProjectSummaryCard";
import { Copy } from "@/components/ui/Copy";

/**
 * Level 2 of the drill-down: every project in one quadrant, as compact cards — navigational only,
 * same as `EisenhowerOverview`. Clicking a card hands the project back up to the parent, which
 * closes this panel and opens the (unchanged) `ProjectDrilldownPanel` — a sequential swap, since
 * no two `SidePanel`s are ever open at once anywhere in this app.
 */
export function QuadrantProjectsPanel({
  quadrant,
  onClose,
  projects,
  teams,
  processedByProject,
  tasksByProject,
  phasesByProject,
  onProjectClick,
}: {
  /** `"unsorted"` reuses this same panel for the not-yet-triaged bucket, rather than a second
   * near-identical component. */
  quadrant: Quadrant | "unsorted" | null;
  onClose: () => void;
  projects: Project[];
  teams: TeamConfig[];
  processedByProject: Record<string, number>;
  tasksByProject: Record<string, ProjectTask[]>;
  phasesByProject: Record<string, ProjectPhase[]>;
  onProjectClick: (project: Project) => void;
}) {
  const teamNameByKey = new Map(teams.map((t) => [t.team_key, t.team_name]));
  const labelFor = (key: string) => {
    const name = teamNameByKey.get(key);
    return name ? teamLabel(name) : key;
  };

  const meta = quadrant && quadrant !== "unsorted" ? QUADRANT_META[quadrant] : null;
  const title = meta ? meta.verb : quadrant === "unsorted" ? "Unsorted" : "Quadrant";
  const axis = meta ? meta.axis : quadrant === "unsorted" ? "Not yet triaged" : undefined;

  return (
    <SidePanel
      open={quadrant !== null}
      onClose={onClose}
      title={title}
      description={axis ? `${axis} — ${projects.length} project${projects.length === 1 ? "" : "s"}` : undefined}
    >
      {projects.length === 0 ? (
        <p className="text-sm text-neutral-400">
          <Copy serious="Nothing in this quadrant." playful="All clear here." />
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => {
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
                onClick={() => onProjectClick(p)}
              />
            );
          })}
        </div>
      )}
    </SidePanel>
  );
}
