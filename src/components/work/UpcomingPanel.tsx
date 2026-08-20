"use client";

import { useState } from "react";
import { CalendarClock, ChevronDown, ArrowDownToLine, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskRow } from "@/components/work/TaskBoard";
import { Copy } from "@/components/ui/Copy";
import {
  dayDistance,
  dayLabel,
  groupTasksByDay,
  type WorkProject,
  type WorkTask,
} from "@/lib/work";

/**
 * Everything that isn't today: work already planned for a later day, and work that was due on an
 * earlier day and never got finished.
 *
 * Both are deliberately OUTSIDE the board rather than mixed into it. The board's whole value is
 * that it answers one question — what needs me today — and a list that silently accumulates next
 * fortnight's plans plus every unfinished thing from last week answers that question worse every
 * day. Nothing rolls over on its own either: bringing a day forward is a button, so today's list
 * is always something that was chosen rather than inherited.
 */
export function UpcomingPanel({
  today,
  upcoming,
  overdue,
  projects,
  onToggleDone,
  onPatch,
  onDelete,
  onMoveMany,
}: {
  today: string;
  upcoming: WorkTask[];
  overdue: WorkTask[];
  projects: WorkProject[];
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onMoveMany: (tasks: WorkTask[], date: string) => void;
}) {
  // Collapsed by default: the point of the section is that it ISN'T demanding attention. Opens
  // itself when something is overdue, which is the one case that does.
  const [open, setOpen] = useState(overdue.length > 0);

  const days = groupTasksByDay(upcoming);
  const overdueDays = groupTasksByDay(overdue);
  const total = upcoming.length + overdue.length;

  return (
    <section className="flex flex-col gap-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 self-start group"
      >
        <CalendarClock className="w-4 h-4 text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-900">Ahead</h2>
        <span className="text-xs text-neutral-400">
          {total === 0
            ? "nothing planned"
            : `${upcoming.length} planned${overdue.length ? ` · ${overdue.length} unfinished` : ""}`}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-neutral-400 transition-transform duration-200 group-hover:text-neutral-600",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-5">
          {/* Overdue first — it's the only part of this section that's actually urgent. */}
          {overdueDays.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    Still open from earlier
                  </p>
                </div>
                <button
                  onClick={() => onMoveMany(overdue, today)}
                  className="btn-secondary py-1 px-3 text-xs"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Bring all {overdue.length} to today
                </button>
              </div>
              {overdueDays.map(({ date, tasks }) => (
                <DayGroup
                  key={date}
                  date={date}
                  today={today}
                  tasks={tasks}
                  projects={projects}
                  onToggleDone={onToggleDone}
                  onPatch={onPatch}
                  onDelete={onDelete}
                  onMoveMany={onMoveMany}
                />
              ))}
            </div>
          )}

          {days.length === 0 ? (
            <div className="card px-4 py-3">
              <p className="text-xs text-neutral-400">
                <Copy
                  serious="Nothing scheduled for a later day. Add a task and pick a date to plan ahead."
                  playful="The future is empty. Enjoy it while it lasts."
                />
              </p>
            </div>
          ) : (
            days.map(({ date, tasks }) => (
              <DayGroup
                key={date}
                date={date}
                today={today}
                tasks={tasks}
                projects={projects}
                onToggleDone={onToggleDone}
                onPatch={onPatch}
                onDelete={onDelete}
                onMoveMany={onMoveMany}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One day's worth of planned tasks. Rows are the same TaskRow the board uses — a planned task
 * should be editable exactly like a today task, including its date, so re-planning never means
 * finding some other screen.
 */
function DayGroup({
  date,
  today,
  tasks,
  projects,
  onToggleDone,
  onPatch,
  onDelete,
  onMoveMany,
}: {
  date: string;
  today: string;
  tasks: WorkTask[];
  projects: WorkProject[];
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onMoveMany: (tasks: WorkTask[], date: string) => void;
}) {
  const distance = dayDistance(date, today);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <p className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
            {dayLabel(date, today)}
          </p>
          <span className="text-xs text-neutral-400">{tasks.length}</span>
          {distance && <span className="text-xs text-neutral-300">· {distance}</span>}
        </div>
        <button
          onClick={() => onMoveMany(tasks, today)}
          className="text-xs text-neutral-400 hover:text-sprout-700 transition-colors"
        >
          Move to today
        </button>
      </div>
      <div className="card divide-y divide-neutral-100">
        {tasks.map((task) => (
          <TaskRow
            key={task.task_id}
            task={task}
            projects={projects}
            today={today}
            onToggleDone={onToggleDone}
            onPatch={onPatch}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
