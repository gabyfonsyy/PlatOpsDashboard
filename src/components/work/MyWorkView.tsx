"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProjectStrip, TaskBoard } from "@/components/work/TaskBoard";
import { UpcomingPanel } from "@/components/work/UpcomingPanel";
import { RepeatingList } from "@/components/work/RepeatingList";
import { celebrate } from "@/lib/celebrate";
import { isOpen, type WorkProject, type WorkRecurrence, type WorkTask } from "@/lib/work";

/**
 * Owns the two pieces of state shared across this page's task surfaces (it's My Work in Light and
 * Dark, Mission Control in Gaby's View — see lib/nav.ts; the code uses the plain name throughout):
 *
 *  1. Which project is selected — lifted so clicking a project card filters the board in place,
 *     rather than navigating away. Deliberately not a URL param: it's a transient view toggle, not
 *     a location worth linking to or putting in the back button.
 *
 *  2. The optimistic task store. It holds today, ahead and overdue together, as one array, because
 *     rescheduling moves a task BETWEEN those surfaces — push something to tomorrow and it has to
 *     leave the board and appear under Tomorrow in the same frame. Split stores would each apply
 *     their own half of that move and disagree until the server answered.
 *
 * `useOptimistic` + `startTransition` also means a failed write rolls back automatically when the
 * transition settles and the server state comes back unchanged — no manual undo bookkeeping.
 */

type Action =
  | { ids: string[]; patch: Partial<WorkTask> }
  | { remove: string };

export function MyWorkView({
  today,
  tasks,
  upcoming,
  overdue,
  projects,
  recurrences,
  recurrencesReady,
}: {
  today: string;
  tasks: WorkTask[];
  upcoming: WorkTask[];
  overdue: WorkTask[];
  projects: WorkProject[];
  recurrences: WorkRecurrence[];
  recurrencesReady: boolean;
}) {
  const router = useRouter();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The server hands these over already partitioned; they're re-merged here so the optimistic
  // reducer sees every task it might have to move, then re-partitioned below off `work_date`.
  const all = useMemo(() => [...tasks, ...upcoming, ...overdue], [tasks, upcoming, overdue]);

  const [optimistic, applyOptimistic] = useOptimistic(all, (current: WorkTask[], action: Action) => {
    if ("remove" in action) return current.filter((t) => t.task_id !== action.remove);
    const ids = new Set(action.ids);
    return current.map((t) => (ids.has(t.task_id) ? { ...t, ...action.patch } : t));
  });

  // Same partitioning rule the store uses, applied client-side so an optimistic date change moves
  // a row between sections immediately instead of waiting for the refresh.
  const partition = useMemo(() => {
    const todayTasks: WorkTask[] = [];
    const ahead: WorkTask[] = [];
    const behind: WorkTask[] = [];
    for (const task of optimistic) {
      if (task.work_date === today) todayTasks.push(task);
      else if (!isOpen(task)) continue; // settled work on another day isn't outstanding
      else if (task.work_date > today) ahead.push(task);
      else behind.push(task);
    }
    return { todayTasks, ahead, behind };
  }, [optimistic, today]);

  async function send(method: "PATCH" | "DELETE", body: Record<string, unknown>) {
    const res = await fetch("/api/work/tasks", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
  }

  function patchTask(task: WorkTask, patch: Partial<WorkTask>) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ ids: [task.task_id], patch });
      try {
        await send("PATCH", { task_id: task.task_id, ...patch });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        celebrate("nope");
        router.refresh();
      }
    });
  }

  /** One request for the whole batch — see updateTasks in work-store. */
  function moveMany(batch: WorkTask[], work_date: string) {
    const ids = batch.map((t) => t.task_id);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      applyOptimistic({ ids, patch: { work_date } });
      try {
        await send("PATCH", { task_ids: ids, work_date });
        celebrate("success");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        celebrate("nope");
        router.refresh();
      }
    });
  }

  function toggleDone(task: WorkTask) {
    const done = task.status === "Done";
    // Un-ticking returns the task to To Do rather than to whatever it was before: guessing the
    // previous state wrongly is more annoying than the one extra click.
    patchTask(task, { status: done ? "To Do" : "Done" });
    if (done) return;
    // Finishing the last Focus item of TODAY is the moment worth marking, not every checkbox —
    // and not a future task ticked off early, which isn't the end of anything.
    const remainingFocus = partition.todayTasks.filter(
      (t) => t.lane === "Focus" && t.task_id !== task.task_id && isOpen(t)
    );
    const isTodayFocusFinale =
      task.work_date === today && task.lane === "Focus" && remainingFocus.length === 0;
    celebrate(isTodayFocusFinale ? "milestone" : "success");
  }

  function removeTask(task: WorkTask) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ remove: task.task_id });
      try {
        await send("DELETE", { task_id: task.task_id });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-neutral-900">Today</h2>
          <TaskBoard
            tasks={partition.todayTasks}
            projects={projects}
            today={today}
            projectFilter={projectFilter}
            onClearFilter={() => setProjectFilter(null)}
            onToggleDone={toggleDone}
            onPatch={patchTask}
            onDelete={removeTask}
          />
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-neutral-900">Projects</h2>
          <ProjectStrip
            projects={projects}
            activeId={projectFilter}
            onSelect={setProjectFilter}
          />

          {/* Beneath Projects rather than beside the board: a schedule is something you set up
              occasionally and then stop looking at. Its output is already on the board. */}
          <h2 className="text-sm font-semibold text-neutral-900 mt-2">Repeating</h2>
          <RepeatingList
            rules={recurrences}
            ready={recurrencesReady}
            projects={projects}
            today={today}
          />
        </div>
      </div>

      <UpcomingPanel
        today={today}
        upcoming={partition.ahead}
        overdue={partition.behind}
        projects={projects}
        onToggleDone={toggleDone}
        onPatch={patchTask}
        onDelete={removeTask}
        onMoveMany={moveMany}
      />
    </div>
  );
}
