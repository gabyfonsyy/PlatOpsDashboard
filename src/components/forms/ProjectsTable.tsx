"use client";

import { Fragment, useState } from "react";
import { Pencil, ChevronRight, ChevronDown } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { ProjectRecord, TaskRecord } from "@/lib/types";
import { computeProjection, hasProjectionInputs, resolveDisplayPercent, type WeeklyOverride } from "@/lib/projection";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EditProjectDialog } from "@/components/forms/EditProjectDialog";
import { ProjectTasksPanel } from "@/components/forms/ProjectTasksPanel";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";

const STATUS_TONE: Record<ProjectRecord["status"], "neutral" | "warning" | "success" | "danger"> = {
  "Not Started": "neutral",
  "In Progress": "warning",
  "Blocked": "danger",
  "Done": "success",
};

function parseWeeklyPlan(raw: string): WeeklyOverride[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Whole weeks elapsed from a yyyy-MM-dd start to today (0 if missing/invalid/future). */
function weeksElapsedSince(start?: string): number {
  if (!start) return 0;
  const s = new Date(`${start}T00:00:00`).getTime();
  if (Number.isNaN(s)) return 0;
  const weeks = (Date.now() - s) / (7 * 24 * 60 * 60 * 1000);
  return weeks > 0 ? weeks : 0;
}

export function ProjectsTable({
  projects,
  teams,
  linkedCount,
  processedByProject = {},
  tasksByProject = {},
  tickets = [],
  jiraBaseUrl,
  bare = false,
}: {
  projects: ProjectRecord[];
  teams: TeamConfig[];
  linkedCount: Record<string, number>;
  /** Actual items/DBs processed per project, summed from the PROJECT_PROGRESS log. */
  processedByProject?: Record<string, number>;
  /** Task checklist per project, from the PROJECT_TASKS log. */
  tasksByProject?: Record<string, TaskRecord[]>;
  /** Jira initiative tickets, for the task checklist's ticket field. */
  tickets?: ProgressTicketOption[];
  jiraBaseUrl?: string;
  /** Skip the outer `.card` wrapper — for embedding inside a parent that already provides one. */
  bare?: boolean;
}) {
  const [editing, setEditing] = useState<{ project: ProjectRecord; computedPercent: number; hasTasks: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const teamNameByKey = new Map(teams.map((t) => [t.team_key, t.team_name]));
  const labelFor = (key: string) => {
    const name = teamNameByKey.get(key);
    return name ? teamLabel(name) : key;
  };
  const involvedKeys = (r: ProjectRecord) =>
    String(r.teams_involved || "").split(",").map((s) => s.trim()).filter(Boolean);

  const table = (
    <div className={bare ? "overflow-x-auto" : "card overflow-x-auto"}>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Project</th>
            <th className="px-4 py-3">Teams</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 min-w-[9rem]">Progress</th>
            <th className="px-4 py-3">Target</th>
            <th className="px-4 py-3">Projection</th>
            <th className="px-4 py-3">Tickets</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {projects.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">No projects tracked yet.</td>
            </tr>
          )}
          {projects.map((r) => {
            const processed = processedByProject[r.project_id];
            const hasProcessed = processed !== undefined;
            const elapsed = weeksElapsedSince(r.start_date);
            const observedItemsPerWeek = hasProcessed && elapsed > 0 ? processed / elapsed : null;
            const proj =
              hasProjectionInputs({ totalItems: r.total_items, batchSize: r.batch_size }) || hasProcessed
                ? computeProjection({
                    totalItems: r.total_items,
                    batchSize: r.batch_size,
                    batchesPerWeek: r.batches_per_week,
                    startDate: r.start_date || null,
                    targetDate: r.target_date || null,
                    weeklyPlan: parseWeeklyPlan(r.weekly_plan_json),
                    processedItems: hasProcessed ? processed : null,
                    observedItemsPerWeek,
                  })
                : null;
            // Prefer the actual-throughput forecast once we have real processed data; else planned.
            const completionDate = proj?.actualCompletionDate ?? proj?.completionDate;
            const onTrack = proj?.actualCompletionDate ? proj?.actualOnTrack : proj?.onTrack;
            const isActualForecast = !!proj?.actualCompletionDate;
            const totalItems = r.total_items === "" || r.total_items === null ? undefined : Number(r.total_items);
            const tasks = tasksByProject[r.project_id] ?? [];
            const hasTasks = tasks.length > 0;
            const taskStats = hasTasks ? { total: tasks.length, done: tasks.filter((t) => t.done).length } : undefined;
            const pct = resolveDisplayPercent(r, hasProcessed ? processed : undefined, taskStats);
            const isExpanded = expanded.has(r.project_id);
            // Only task-mode projects (or legacy rows that already have tasks) get the expand toggle —
            // keeps the table clean for Manual/Scheduled Activities projects that don't use a checklist.
            const canExpandTasks = r.tracking_mode === "tasks" || hasTasks;
            return (
              <Fragment key={r.project_id}>
              <tr>
                <td className="px-4 py-3 font-medium text-neutral-900">
                  {canExpandTasks ? (
                    <button
                      onClick={() => toggleExpanded(r.project_id)}
                      className="inline-flex items-center gap-1.5 text-left hover:text-sprout-700"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      )}
                      {r.project_name}
                    </button>
                  ) : (
                    r.project_name
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="success">{labelFor(r.owning_team)}</Badge>
                  {involvedKeys(r)
                    .filter((k) => k !== r.owning_team)
                    .map((k) => <Badge key={k} tone="neutral">{labelFor(k)}</Badge>)}
                </td>
                <td className="px-4 py-3">{r.owner}</td>
                <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                      <div className="h-full rounded-full bg-sprout-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-neutral-500 whitespace-nowrap">
                      {taskStats
                        ? `${taskStats.done}/${taskStats.total} tasks (${pct}%)`
                        : hasProcessed && totalItems
                          ? `${processed.toLocaleString()} / ${totalItems.toLocaleString()} (${pct}%)`
                          : hasProcessed
                            ? `${processed.toLocaleString()} done`
                            : `${pct}%`}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{r.target_date ? formatManilaDate(r.target_date) : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {completionDate ? (
                    <span className="inline-flex items-center gap-2">
                      <span title={isActualForecast ? "Forecast from actual throughput" : "Planned cadence"}>
                        {formatManilaDate(completionDate)}
                        {isActualForecast && <span className="text-neutral-400"> *</span>}
                      </span>
                      {onTrack === true && <Badge tone="success">On track</Badge>}
                      {onTrack === false && <Badge tone="danger">Behind</Badge>}
                    </span>
                  ) : proj?.requiredBatchesPerWeek ? (
                    <span className="text-neutral-500">need {proj.requiredBatchesPerWeek}/wk</span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {linkedCount[r.project_id] ? (
                    <span className="font-medium text-neutral-900">{linkedCount[r.project_id]}</span>
                  ) : (
                    <span className="text-neutral-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setEditing({ project: r, computedPercent: pct, hasTasks })}
                      className="text-neutral-400 hover:text-sprout-600 transition-colors"
                      aria-label="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <DeleteButton endpoint="/api/gas/projects" id={r.project_id} />
                  </div>
                </td>
              </tr>
              {isExpanded && (
                <tr>
                  <td colSpan={9} className="p-0">
                    <ProjectTasksPanel projectId={r.project_id} tasks={tasks} tickets={tickets} jiraBaseUrl={jiraBaseUrl} />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {table}
      {editing && (
        <EditProjectDialog
          project={editing.project}
          computedPercent={editing.computedPercent}
          hasTasks={editing.hasTasks}
          teams={teams}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
