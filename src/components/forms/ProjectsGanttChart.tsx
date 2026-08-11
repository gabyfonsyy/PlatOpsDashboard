"use client";

import { Fragment } from "react";
import type { TeamConfig } from "@/lib/teams";
import type { ProjectRecord, TaskRecord } from "@/lib/types";
import { teamLabel, cn } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { resolveDisplayPercent } from "@/lib/projection";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAD_DAYS = 7;
const MIN_BAR_PERCENT = 2;
const LABEL_COL = "220px";

const STATUS_BAR: Record<ProjectRecord["status"], { track: string; fill: string }> = {
  "Not Started": { track: "bg-neutral-200", fill: "bg-neutral-400" },
  "In Progress": { track: "bg-amber-100", fill: "bg-amber-500" },
  "Blocked": { track: "bg-red-100", fill: "bg-red-500" },
  "Done": { track: "bg-emerald-100", fill: "bg-emerald-500" },
};

/**
 * Sheets round-trips a stored date as a UTC ISO timestamp (see formatManilaDate in lib/format.ts),
 * not a plain "yyyy-MM-dd" — normalise through that first, then parse as a local calendar date so
 * bar positions aren't shifted by the browser's own timezone.
 */
function parseLocalDate(value: string | undefined | null): number | null {
  if (!value) return null;
  const plain = formatManilaDate(value);
  if (!plain) return null;
  const d = new Date(`${plain}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function startOfMonth(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

type DatedRow = { project: ProjectRecord; start: number; end: number };
type DatedTask = { task: TaskRecord; start: number; end: number };

export function ProjectsGanttChart({
  projects,
  teams,
  processedByProject = {},
  tasksByProject = {},
  bare = false,
}: {
  projects: ProjectRecord[];
  teams: TeamConfig[];
  /** Actual items/DBs processed per project, summed from the PROJECT_PROGRESS log. */
  processedByProject?: Record<string, number>;
  /** Task checklist per project, from the PROJECT_TASKS log — tasks with both dates get their own sub-bar. */
  tasksByProject?: Record<string, TaskRecord[]>;
  /** Skip the outer `.card` wrapper — for embedding inside a parent that already provides one. */
  bare?: boolean;
}) {
  const teamNameByKey = new Map(teams.map((t) => [t.team_key, t.team_name]));
  const labelFor = (key: string) => {
    const name = teamNameByKey.get(key);
    return name ? teamLabel(name) : key;
  };

  const dated: DatedRow[] = projects
    .map((project) => ({ project, start: parseLocalDate(project.start_date), end: parseLocalDate(project.target_date) }))
    .filter((r): r is { project: ProjectRecord; start: number; end: number } => r.start !== null && r.end !== null)
    .map((r) => ({ ...r, end: Math.max(r.end, r.start) }));

  const omittedCount = projects.length - dated.length;

  if (dated.length === 0) {
    return (
      <div className={cn(bare ? "" : "card", "p-8 text-center text-neutral-400")}>
        No projects have both a start and target date yet — add dates to see them on the timeline.
      </div>
    );
  }

  const datedTasksByProject = new Map<string, DatedTask[]>();
  for (const project of projects) {
    const dt: DatedTask[] = (tasksByProject[project.project_id] ?? [])
      .map((task) => ({ task, start: parseLocalDate(task.start_date), end: parseLocalDate(task.target_date) }))
      .filter((t): t is DatedTask => t.start !== null && t.end !== null)
      .map((t) => ({ ...t, end: Math.max(t.end, t.start) }));
    if (dt.length) datedTasksByProject.set(project.project_id, dt);
  }
  const allTaskDates = Array.from(datedTasksByProject.values()).flat();

  const domainStart = Math.min(...dated.map((r) => r.start), ...allTaskDates.map((t) => t.start)) - PAD_DAYS * DAY_MS;
  const domainEnd = Math.max(...dated.map((r) => r.end), ...allTaskDates.map((t) => t.end)) + PAD_DAYS * DAY_MS;
  const domainSpan = domainEnd - domainStart;
  const pct = (ts: number) => ((ts - domainStart) / domainSpan) * 100;

  const ticks: { left: number; label: string }[] = [];
  let cursor = startOfMonth(domainStart);
  while (cursor.getTime() <= domainEnd) {
    ticks.push({
      left: pct(cursor.getTime()),
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    });
    cursor = addMonths(cursor, 1);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const todayLeft = todayTs >= domainStart && todayTs <= domainEnd ? pct(todayTs) : null;

  const groups: { key: string; rows: DatedRow[] }[] = teams
    .map((t) => ({ key: t.team_key, rows: dated.filter((r) => r.project.owning_team === t.team_key) }))
    .filter((g) => g.rows.length > 0);
  const knownKeys = new Set(teams.map((t) => t.team_key));
  const orphanKeys = Array.from(
    new Set(dated.filter((r) => !knownKeys.has(r.project.owning_team)).map((r) => r.project.owning_team))
  );
  orphanKeys.forEach((key) => groups.push({ key, rows: dated.filter((r) => r.project.owning_team === key) }));
  groups.forEach((g) => g.rows.sort((a, b) => a.start - b.start));

  return (
    <div className={bare ? "overflow-x-auto" : "card overflow-x-auto"}>
      <div className="min-w-[720px] p-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}>
          <div />
          <div className="relative h-6 border-b border-neutral-200">
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-neutral-100 text-xs text-neutral-400 pl-1.5"
                style={{ left: `${t.left}%` }}
              >
                {t.label}
              </div>
            ))}
            {todayLeft !== null && (
              <div className="absolute top-0 h-full border-l-2 border-sprout-500" style={{ left: `${todayLeft}%` }} />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 mt-3">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <div className="grid gap-4" style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {labelFor(group.key)}
                </div>
                <div />
              </div>

              {group.rows.map(({ project: r, start, end }) => {
                const tone = STATUS_BAR[r.status] ?? STATUS_BAR["Not Started"];
                const left = pct(start);
                const width = Math.max(pct(end) - left, MIN_BAR_PERCENT);
                const processed = processedByProject[r.project_id];
                const datedTasks = datedTasksByProject.get(r.project_id) ?? [];
                const allTasks = tasksByProject[r.project_id] ?? [];
                const taskStats = allTasks.length
                  ? { total: allTasks.length, done: allTasks.filter((t) => t.done).length }
                  : undefined;
                const completePercent = resolveDisplayPercent(r, processed, taskStats);
                return (
                  <Fragment key={r.project_id}>
                    <div className="grid gap-4 items-center" style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}>
                      <div className="text-sm text-neutral-700 truncate" title={r.project_name}>
                        {r.project_name}
                      </div>
                      <div className="relative h-6">
                        {todayLeft !== null && (
                          <div className="absolute top-0 h-full border-l border-neutral-100" style={{ left: `${todayLeft}%` }} />
                        )}
                        <div
                          className={cn("absolute top-1 h-4 rounded-md overflow-hidden", tone.track)}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${r.project_name} — ${formatManilaDate(r.start_date)} to ${formatManilaDate(r.target_date)} — ${r.status}, ${completePercent}% complete`}
                        >
                          <div className={cn("h-full", tone.fill)} style={{ width: `${completePercent}%` }} />
                        </div>
                      </div>
                    </div>

                    {datedTasks.map(({ task, start: tStart, end: tEnd }) => {
                      const tLeft = pct(tStart);
                      const tWidth = Math.max(pct(tEnd) - tLeft, MIN_BAR_PERCENT);
                      return (
                        <div
                          key={task.task_id}
                          className="grid gap-4 items-center"
                          style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}
                        >
                          <div className="text-xs text-neutral-400 truncate pl-4" title={task.task_name}>
                            {task.task_name}
                          </div>
                          <div className="relative h-4">
                            {todayLeft !== null && (
                              <div className="absolute top-0 h-full border-l border-neutral-100" style={{ left: `${todayLeft}%` }} />
                            )}
                            <div
                              className="absolute top-0.5 h-3 rounded bg-neutral-100"
                              style={{ left: `${tLeft}%`, width: `${tWidth}%` }}
                              title={`${task.task_name} — ${formatManilaDate(task.start_date)} to ${formatManilaDate(task.target_date)} — ${task.done ? "Done" : "Not done"}`}
                            >
                              <div
                                className={cn("h-full rounded", task.done ? "bg-emerald-500" : "bg-sky-400")}
                                style={{ width: task.done ? "100%" : "35%" }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>

        {omittedCount > 0 && (
          <p className="text-xs text-neutral-400 mt-4">
            {omittedCount} project{omittedCount === 1 ? "" : "s"} without both a start and target date aren&apos;t shown here.
          </p>
        )}
      </div>
    </div>
  );
}
