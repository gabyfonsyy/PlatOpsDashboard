"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUADRANT_ORDER, type Triage } from "@/lib/work";
import { QuadrantCell, QuadrantSelect } from "@/components/work/Quadrant";
import { projectMatrixTally, type Project } from "@/lib/project-tracking";
import { cn } from "@/lib/utils";

/**
 * Eisenhower matrix for the team-filtered project list, built from the same shared pieces My
 * Work's board uses (QuadrantCell/QuadrantSelect) — the UI concept is borrowed, the data is not:
 * this reads/writes `projects`, never `work_projects`.
 */
export function ProjectMatrix({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { cells, unsorted } = projectMatrixTally(projects);

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
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ProjectMatrixRow({
  index,
  project,
  pending,
  onQuadrantChange,
}: {
  index: number;
  project: Project;
  pending: boolean;
  onQuadrantChange: (project: Project, next: Triage) => void;
}) {
  return (
    <li className={cn("flex items-center gap-2 text-sm", pending && "opacity-60")}>
      <span className="text-neutral-300 w-4 text-right shrink-0">{index}.</span>
      <span className="flex-1 min-w-0 truncate text-neutral-800" title={project.project_name}>
        {project.project_name}
      </span>
      <QuadrantSelect
        value={project as Triage}
        onChange={(next) => onQuadrantChange(project, next)}
        label={`Quadrant for ${project.project_name}`}
      />
    </li>
  );
}
