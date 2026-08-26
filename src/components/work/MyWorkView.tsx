"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProjectStrip, TaskBoard } from "@/components/work/TaskBoard";
import { UpcomingPanel } from "@/components/work/UpcomingPanel";
import { RepeatingList } from "@/components/work/RepeatingList";
import { RescheduleReasonStrip } from "@/components/work/RescheduleReasonStrip";
import { celebrate } from "@/lib/celebrate";
import {
  isOpen,
  pushTargetDate,
  type WorkProject,
  type WorkRecurrence,
  type WorkTask,
} from "@/lib/work";

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
  /**
   * The slip that was just made, if any — what the reason strip describes. One at a time: pushing
   * a second task supersedes the first, because a stack of "why?" prompts is a form, and this is
   * meant to be a question you can ignore.
   */
  const [slip, setSlip] = useState<{ task: WorkTask; from: string; to: string } | null>(null);

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
    /**
     * Any move to a LATER day is a slip, however it was made — the push button, the row's date
     * field, a drag added later. Detected here rather than in the push handler so every path gets
     * the same follow-up question, and so this stays in step with the server, which logs on
     * exactly the same condition (see updateTask). Moving a task EARLIER is the opposite act and
     * gets no strip.
     */
    if (typeof patch.work_date === "string" && patch.work_date > task.work_date) {
      setSlip({ task, from: task.work_date, to: patch.work_date });
    }
    startTransition(async () => {
      applyOptimistic({ ids: [task.task_id], patch });
      try {
        await send("PATCH", { task_id: task.task_id, ...patch });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        celebrate("nope");
        setSlip(null); // the move didn't happen, so there is nothing to explain
        router.refresh();
      }
    });
  }

  /** One click: to the next working day, from today if the task is already overdue. */
  function pushTask(task: WorkTask) {
    patchTask(task, { work_date: pushTargetDate(task.work_date, today) });
  }

  /**
   * Puts the task back and removes the slip that was just logged, so an undone misclick leaves no
   * trace in the reason tallies. The PATCH is backward, so it is never logged as a new slip.
   */
  function undoSlip() {
    if (!slip) return;
    const { task, from } = slip;
    setSlip(null);
    setError(null);
    startTransition(async () => {
      applyOptimistic({ ids: [task.task_id], patch: { work_date: from } });
      try {
        await send("PATCH", { task_id: task.task_id, work_date: from });
        await fetch("/api/work/tasks/reason", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: task.task_id }),
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        router.refresh();
      }
    });
  }

  /**
   * Copies a task onto another day, leaving the original where it is. Not optimistic: the new row
   * is the server's to mint (id, stamps, the fields a copy inherits), and inventing a placeholder
   * task client-side to be replaced a moment later is how two ids for one task get into a list.
   */
  function copyTask(task: WorkTask, date: string) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/work/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ copy_of: task.task_id, work_date: date }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
        celebrate("success");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        celebrate("nope");
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

      {/* Above the board, because the task it is asking about has just left the board. */}
      {slip && (
        <RescheduleReasonStrip
          key={`${slip.task.task_id}:${slip.to}`}
          task={slip.task}
          from={slip.from}
          to={slip.to}
          today={today}
          onUndo={undoSlip}
          onDismiss={() => setSlip(null)}
        />
      )}

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
            onPush={pushTask}
            onCopy={copyTask}
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
        onPush={pushTask}
        onCopy={copyTask}
        onMoveMany={moveMany}
      />
    </div>
  );
}
