"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { QuadrantSelect } from "@/components/work/Quadrant";
import type { Triage } from "@/lib/work";
import { HEALTH_META, type Project, type ProjectPhase, type ProjectTask } from "@/lib/project-tracking";
import { resolveDisplayPercent } from "@/lib/projection";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { EditProjectDialog } from "@/components/forms/EditProjectDialog";
import { ProjectOnePager } from "@/components/projects/ProjectOnePager";
import { PhasesPanel } from "@/components/projects/PhasesPanel";
import { ProjectPhaseGanttChart } from "@/components/projects/ProjectPhaseGanttChart";

const STATUS_OPTIONS: Project["status"][] = ["Not Started", "In Progress", "Blocked", "Done"];

/**
 * The project drill-down — header facts + quick inline changes + the read-only one-pager, on a
 * `SidePanel`. Deliberately thin on mutations: status/health/priority are one PATCH per field
 * (same granular-PATCH contract `ProjectMatrix`'s own quadrant control already relies on), and
 * anything bigger (name, dates, batch config, the one-pager text itself) reuses the EXISTING
 * `EditProjectDialog` rather than duplicating that form here.
 */
export function ProjectDrilldownPanel({
  project,
  open,
  onClose,
  teams,
  processedByProject,
  tasksByProject,
  phasesByProject,
}: {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  teams: TeamConfig[];
  processedByProject: Record<string, number>;
  tasksByProject: Record<string, ProjectTask[]>;
  phasesByProject: Record<string, ProjectPhase[]>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>) {
    if (!project) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.project_id, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  if (!project) {
    return (
      <SidePanel open={open} onClose={onClose} title="Project" width="wide">
        <p className="text-sm text-neutral-400">No project selected.</p>
      </SidePanel>
    );
  }

  const teamName = teams.find((t) => t.team_key === project.owning_team)?.team_name;
  const tasks = tasksByProject[project.project_id] ?? [];
  const hasTasks = tasks.length > 0;
  const taskStats = hasTasks ? { total: tasks.length, done: tasks.filter((t) => t.done).length } : undefined;
  const pct = resolveDisplayPercent(project, processedByProject[project.project_id], taskStats);
  const phases = phasesByProject[project.project_id] ?? [];

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        title={project.project_name}
        description={teamName ? teamLabel(teamName) : undefined}
        width="wide"
      >
        <div className="flex flex-col gap-6">
          {error && <p className="form-error">{error}</p>}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setEditing(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              {project.archived && <Badge tone="neutral">Archived</Badge>}
            </div>
            <button
              onClick={() => patch({ archived: !project.archived })}
              disabled={pending}
              className="btn-ghost text-sm"
            >
              {project.archived ? "Unarchive" : "Archive"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Owner" value={project.owner || "—"} />
            <Field label="Status">
              <select
                value={project.status}
                onChange={(e) => patch({ status: e.target.value })}
                disabled={pending}
                className="form-input text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Health">
              <select
                value={project.health}
                onChange={(e) => patch({ health: e.target.value })}
                disabled={pending}
                className="form-input text-sm"
              >
                <option value="">Unset</option>
                {(Object.keys(HEALTH_META) as Array<keyof typeof HEALTH_META>).map((h) => (
                  <option key={h} value={h}>{HEALTH_META[h].label}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <QuadrantSelect
                value={project as Triage}
                onChange={(next) => patch({ urgent: next.urgent, important: next.important })}
                size="md"
              />
            </Field>
            <Field label="Start Date" value={project.start_date ? formatManilaDate(project.start_date) : "—"} />
            <Field label="Target Date" value={project.target_date ? formatManilaDate(project.target_date) : "—"} />
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Progress</p>
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 rounded-full bg-neutral-100 overflow-hidden">
                <div className="h-full rounded-full bg-sprout-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-medium text-neutral-900">{pct}%</span>
            </div>
          </div>

          <div className="border-t border-line/70 pt-4">
            <p className="text-xs uppercase tracking-wide text-neutral-400 mb-3">Phases</p>
            <div className="flex flex-col gap-4">
              {phases.length > 0 && <ProjectPhaseGanttChart phases={phases} />}
              <PhasesPanel projectId={project.project_id} phases={phases} />
            </div>
          </div>

          <div className="border-t border-line/70 pt-4">
            <p className="text-xs uppercase tracking-wide text-neutral-400 mb-3">One-pager</p>
            <ProjectOnePager project={project} />
          </div>
        </div>
      </SidePanel>

      {editing && (
        <EditProjectDialog
          project={project}
          computedPercent={pct}
          hasTasks={hasTasks}
          teams={teams}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">{label}</p>
      {children ?? <p className="text-sm text-neutral-800">{value}</p>}
    </div>
  );
}
