"use client";

import { useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ArrowDownToLine,
  AlertCircle,
  History,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskRow } from "@/components/work/TaskBoard";
import { Copy } from "@/components/ui/Copy";
import {
  DECK_COPY,
  dayDistance,
  dayLabel,
  groupTasksByDay,
  type WorkProject,
  type WorkTask,
} from "@/lib/work";

/**
 * Everything that isn't today, behind one toggle — work already planned for a later day, work due
 * on an earlier day that never got finished, and work from an earlier day that DID get finished.
 *
 * All three are deliberately OUTSIDE the board rather than mixed into it. The board's whole value
 * is that it answers one question — what needs me today — and a list that silently accumulates
 * next fortnight's plans plus every unfinished and finished thing from last week answers that
 * question worse every day. Nothing rolls over on its own either: bringing a day forward is a
 * button, so today's list is always something that was chosen rather than inherited.
 *
 * Opening it splits into two boxes, because "what's behind me" and "what's ahead of me" are
 * different questions asked in different moods — one is a look back, the other is a look forward —
 * and a single flat list made "still unfinished from Tuesday" and "planned for next Monday" read as
 * the same kind of thing. Past then splits again into Done and Unfinished, collapsed behind their
 * own clicks: a look back is optional by nature, and two lists nobody asked to see yet is a wall of
 * text where a header would do.
 */
export function UpcomingPanel({
  today,
  upcoming,
  overdue,
  pastCompleted,
  projects,
  slipCounts,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
  onMoveMany,
}: {
  today: string;
  upcoming: WorkTask[];
  overdue: WorkTask[];
  /** Done/deferred tasks from before today — the other half of the Past box. */
  pastCompleted: WorkTask[];
  projects: WorkProject[];
  /** Passed straight through to the rows, which mark anything pushed more than once. */
  slipCounts: Map<string, number>;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
  onMoveMany: (tasks: WorkTask[], date: string) => void;
}) {
  // Collapsed by default: the point of the section is that it ISN'T demanding attention. Opens
  // itself when something is overdue, which is the one case that does.
  const [open, setOpen] = useState(overdue.length > 0);
  // Unfinished carries the same urgency as before, so it inherits the same default. Done is a
  // review nobody is nagged into — it stays shut until asked for, every time.
  const [unfinishedOpen, setUnfinishedOpen] = useState(overdue.length > 0);
  const [doneOpen, setDoneOpen] = useState(false);

  const days = groupTasksByDay(upcoming);
  const overdueDays = groupTasksByDay(overdue);
  // Newest day first — reviewing what you did leads with the most recent day, not the oldest one
  // still inside the history window.
  const pastDays = [...groupTasksByDay(pastCompleted)].reverse();

  const parts = [
    upcoming.length > 0 && `${upcoming.length} planned`,
    overdue.length > 0 && `${overdue.length} unfinished`,
    pastCompleted.length > 0 && `${pastCompleted.length} done`,
  ].filter(Boolean);

  return (
    <section className="flex flex-col gap-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 self-start group"
      >
        <CalendarClock className="w-4 h-4 text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-900">
          <Copy serious={DECK_COPY.notToday.serious} playful={DECK_COPY.notToday.playful} />
        </h2>
        <span className="text-xs text-neutral-400">
          {parts.length === 0 ? "nothing outside today" : parts.join(" · ")}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-neutral-400 transition-transform duration-200 group-hover:text-neutral-600",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Past — a look back, split into the two things "past" can mean. */}
          <div className="card p-4 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-neutral-400" />
              <h3 className="text-sm font-semibold text-neutral-900">
                <Copy serious={DECK_COPY.past.serious} playful={DECK_COPY.past.playful} />
              </h3>
            </div>

            {/* Unfinished first — it's the only part of this box that's actually urgent. */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setUnfinishedOpen((o) => !o)}
                aria-expanded={unfinishedOpen}
                className="flex items-center gap-2 self-start group"
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  Unfinished
                </p>
                <span className="text-xs text-neutral-400">{overdue.length}</span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 group-hover:text-neutral-600",
                    unfinishedOpen && "rotate-180"
                  )}
                />
              </button>

              {unfinishedOpen &&
                (overdueDays.length === 0 ? (
                  <p className="text-xs text-neutral-400">
                    Nothing still open from an earlier day.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => onMoveMany(overdue, today)}
                      className="btn-secondary py-1 px-3 text-xs self-start"
                    >
                      <ArrowDownToLine className="w-3.5 h-3.5" />
                      Bring all {overdue.length} to today
                    </button>
                    {overdueDays.map(({ date, tasks }) => (
                      <DayGroup
                        key={date}
                        date={date}
                        today={today}
                        tasks={tasks}
                        projects={projects}
                        slipCounts={slipCounts}
                        onToggleDone={onToggleDone}
                        onPatch={onPatch}
                        onDelete={onDelete}
                        onPush={onPush}
                        onCopy={onCopy}
                        onMoveMany={onMoveMany}
                      />
                    ))}
                  </div>
                ))}
            </div>

            {/* Done second — the review you go looking for, not the one that's waiting for you. */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setDoneOpen((o) => !o)}
                aria-expanded={doneOpen}
                className="flex items-center gap-2 self-start group"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />
                <p className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
                  Done
                </p>
                <span className="text-xs text-neutral-400">{pastCompleted.length}</span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 group-hover:text-neutral-600",
                    doneOpen && "rotate-180"
                  )}
                />
              </button>

              {doneOpen &&
                (pastDays.length === 0 ? (
                  <p className="text-xs text-neutral-400">Nothing finished before today yet.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {pastDays.map(({ date, tasks }) => (
                      <PastDayGroup
                        key={date}
                        date={date}
                        today={today}
                        tasks={tasks}
                        projects={projects}
                        slipCounts={slipCounts}
                        onToggleDone={onToggleDone}
                        onPatch={onPatch}
                        onDelete={onDelete}
                        onPush={onPush}
                        onCopy={onCopy}
                      />
                    ))}
                  </div>
                ))}
            </div>
          </div>

          {/* Ahead — a look forward, nothing to click through: everything planned is worth seeing
              at a glance, not filed behind a second toggle the way the two Past lists are. */}
          <div className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-neutral-400" />
              <h3 className="text-sm font-semibold text-neutral-900">
                <Copy serious={DECK_COPY.ahead.serious} playful={DECK_COPY.ahead.playful} />
              </h3>
            </div>

            {days.length === 0 ? (
              <p className="text-xs text-neutral-400">
                <Copy
                  serious="Nothing scheduled for a later day. Add a task and pick a date to plan ahead."
                  playful="The future is empty. Enjoy it while it lasts."
                />
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {days.map(({ date, tasks }) => (
                  <DayGroup
                    key={date}
                    date={date}
                    today={today}
                    tasks={tasks}
                    projects={projects}
                    slipCounts={slipCounts}
                    onToggleDone={onToggleDone}
                    onPatch={onPatch}
                    onDelete={onDelete}
                    onPush={onPush}
                    onCopy={onCopy}
                    onMoveMany={onMoveMany}
                  />
                ))}
              </div>
            )}
          </div>
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
  slipCounts,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
  onMoveMany,
}: {
  date: string;
  today: string;
  tasks: WorkTask[];
  projects: WorkProject[];
  slipCounts: Map<string, number>;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
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
            slipCount={slipCounts.get(task.task_id) ?? 0}
            onToggleDone={onToggleDone}
            onPatch={onPatch}
            onDelete={onDelete}
            onPush={onPush}
            onCopy={onCopy}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One day's worth of already-settled tasks. Same rows as DayGroup, minus "Move to today" — a
 * finished or parked task isn't waiting on anything, so the one action every other day group
 * offers has nothing to do here.
 */
function PastDayGroup({
  date,
  today,
  tasks,
  projects,
  slipCounts,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
}: {
  date: string;
  today: string;
  tasks: WorkTask[];
  projects: WorkProject[];
  slipCounts: Map<string, number>;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
          {dayLabel(date, today)}
        </p>
        <span className="text-xs text-neutral-400">{tasks.length}</span>
      </div>
      <div className="card divide-y divide-neutral-100">
        {tasks.map((task) => (
          <TaskRow
            key={task.task_id}
            task={task}
            projects={projects}
            today={today}
            slipCount={slipCounts.get(task.task_id) ?? 0}
            onToggleDone={onToggleDone}
            onPatch={onPatch}
            onDelete={onDelete}
            onPush={onPush}
            onCopy={onCopy}
          />
        ))}
      </div>
    </div>
  );
}
