"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, ChevronRight, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";
import {
  FOCUS_SOFT_LIMIT,
  LANE_META,
  RECUR_FREQS,
  RECUR_LABELS,
  TASK_LANES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  addIsoDays,
  dayLabel,
  groupTasks,
  isOpen,
  nextMondayIso,
  recurrenceLabel,
  statusTone,
  type RecurFreq,
  type TaskLane,
  type WorkProject,
  type WorkTask,
} from "@/lib/work";
import { Copy } from "@/components/ui/Copy";

/**
 * Today's board. Purely presentational now — the optimistic task store lives one level up in
 * MyWorkView, because a task moved to tomorrow has to leave this board and appear in the
 * Upcoming panel in the same tick, and two separate optimistic stores can't agree on that.
 *
 * Every interaction is still optimistic: the row updates on click and the network call catches up
 * behind it. A to-do list that makes you wait 300ms to watch a checkbox tick is a to-do list you
 * stop trusting.
 */

export function TaskBoard({
  tasks,
  projects,
  today,
  projectFilter,
  onClearFilter,
  onToggleDone,
  onPatch,
  onDelete,
}: {
  tasks: WorkTask[];
  projects: WorkProject[];
  today: string;
  /** When set, only this project's tasks show — driven by clicking a project card. */
  projectFilter: string | null;
  onClearFilter: () => void;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
}) {
  const visible = useMemo(
    () => (projectFilter ? tasks.filter((t) => t.project_id === projectFilter) : tasks),
    [tasks, projectFilter]
  );
  const { lanes, settled } = useMemo(() => groupTasks(visible), [visible]);
  const projectName = (id: string | null) =>
    id ? projects.find((p) => p.project_id === id)?.name ?? null : null;

  const focusOpen = lanes.Focus.filter(isOpen).length;

  return (
    <div className="flex flex-col gap-4">
      <QuickAdd projects={projects} defaultProjectId={projectFilter} today={today} />

      {projectFilter && (
        <button onClick={onClearFilter} className="self-start btn-secondary py-1 px-3 text-xs">
          Showing {projectName(projectFilter)} only · clear
        </button>
      )}

      {TASK_LANES.map((lane) => (
        <Lane
          key={lane}
          lane={lane}
          tasks={lanes[lane]}
          projects={projects}
          today={today}
          overFocusLimit={lane === "Focus" && focusOpen > FOCUS_SOFT_LIMIT}
          onToggleDone={onToggleDone}
          onPatch={onPatch}
          onDelete={onDelete}
        />
      ))}

      {settled.length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-2">
            Settled today · {settled.length}
          </p>
          <div className="card divide-y divide-neutral-100">
            {settled.map((task) => (
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
      )}
    </div>
  );
}

function Lane({
  lane,
  tasks,
  projects,
  today,
  overFocusLimit,
  onToggleDone,
  onPatch,
  onDelete,
}: {
  lane: TaskLane;
  tasks: WorkTask[];
  projects: WorkProject[];
  today: string;
  overFocusLimit: boolean;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
}) {
  const meta = LANE_META[lane];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <p className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
            {/* Focus gets a marker. In Gaby's View the ship is going somewhere. */}
            {lane === "Focus" && <Copy serious="🔥 " playful="🚀 " />}
            {meta.label}
          </p>
          <span className="text-xs text-neutral-400">{tasks.length}</span>
        </div>
        {/* Nudge, not enforcement — Focus stops meaning anything once it holds six items. */}
        {overFocusLimit && (
          <span className="text-xs text-amber-600">
            More than {FOCUS_SOFT_LIMIT} in Focus — is all of it really today?
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="card px-4 py-3">
          <p className="text-xs text-neutral-400">{meta.hint}</p>
        </div>
      ) : (
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
      )}
    </div>
  );
}

/** Exported so the Upcoming panel renders planned tasks with exactly the same affordances. */
export function TaskRow({
  task,
  projects,
  today,
  onToggleDone,
  onPatch,
  onDelete,
}: {
  task: WorkTask;
  projects: WorkProject[];
  today: string;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
}) {
  const done = task.status === "Done";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);

  function commitTitle() {
    setEditing(false);
    const next = title.trim();
    if (!next || next === task.title) {
      setTitle(task.title);
      return;
    }
    onPatch(task, { title: next });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      {/* One click to complete. The checkbox is the primary affordance on the row. */}
      <button
        onClick={() => onToggleDone(task)}
        aria-label={done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        className={cn(
          "shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-200",
          done
            ? "bg-gradient-to-br from-sprout-500 to-sprout-600 border-transparent text-white"
            : "border-neutral-300 hover:border-sprout-400"
        )}
      >
        {done && <Check className="w-3.5 h-3.5" />}
      </button>

      {/* A task that will come back says so, quietly. Without it, finishing a recurring item
          looks identical to finishing a one-off, and deleting one looks permanent when it isn't. */}
      {task.recurrence_id && (
        <Repeat
          className="w-3 h-3 shrink-0 text-neutral-300"
          aria-hidden="true"
        />
      )}

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitle(task.title);
                setEditing(false);
              }
            }}
            className="form-input py-1 text-sm"
          />
        ) : (
          // Click-to-edit in place rather than a modal — the brief asks not to turn everything
          // into a dialog, and renaming a task is the most common edit by far.
          <button
            onClick={() => setEditing(true)}
            className={cn(
              "text-left text-sm w-full truncate transition-colors",
              done ? "text-neutral-400 line-through" : "text-neutral-900 hover:text-sprout-700"
            )}
          >
            {task.title}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {task.priority === "High" && !done && <Badge tone="danger">High</Badge>}
        {!done && task.status !== "To Do" && <Badge tone={statusTone(task.status)}>{task.status}</Badge>}

        <select
          value={task.project_id ?? ""}
          onChange={(e) => onPatch(task, { project_id: e.target.value || null })}
          className="form-input w-auto py-1 text-xs max-w-[9rem]"
          aria-label="Project"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.name}</option>
          ))}
        </select>

        {/* The less-used controls stay hidden until hover, so a row reads as one line of text. */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {/* Rescheduling is one control, not a submenu: pick a day and the row moves there. */}
          <input
            type="date"
            value={task.work_date}
            onChange={(e) => e.target.value && onPatch(task, { work_date: e.target.value })}
            className="form-input w-auto py-1 text-xs"
            aria-label={`Date for ${task.title}`}
            title={`Scheduled for ${dayLabel(task.work_date, today)}`}
          />
          <select
            value={task.lane}
            onChange={(e) => onPatch(task, { lane: e.target.value as TaskLane })}
            className="form-input w-auto py-1 text-xs"
            aria-label="Lane"
          >
            {TASK_LANES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={task.status}
            onChange={(e) => onPatch(task, { status: e.target.value as WorkTask["status"] })}
            className="form-input w-auto py-1 text-xs"
            aria-label="Status"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={task.priority}
            onChange={(e) => onPatch(task, { priority: e.target.value as WorkTask["priority"] })}
            className="form-input w-auto py-1 text-xs"
            aria-label="Priority"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button
            onClick={() => onDelete(task)}
            className="text-neutral-400 hover:text-red-600 transition-colors p-1"
            aria-label={`Delete ${task.title}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * When a new task is for. Today and tomorrow are one click because they're the two answers almost
 * every time; "Next Mon" exists because "not this week" is the third; and the date field only
 * appears when none of those is the answer, so the common path stays one select rather than a
 * calendar you have to think about.
 */
function WhenSelect({
  today,
  value,
  onChange,
}: {
  today: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const tomorrow = addIsoDays(today, 1);
  const monday = nextMondayIso(today);
  const presets = [
    { key: today, label: "Today" },
    { key: tomorrow, label: "Tomorrow" },
    // Skipped when next Monday IS tomorrow — two options for the same day is just a puzzle.
    ...(monday !== tomorrow ? [{ key: monday, label: "Next Mon" }] : []),
  ];
  const isPreset = presets.some((p) => p.key === value);

  return (
    <>
      <select
        value={isPreset ? value : "custom"}
        onChange={(e) => onChange(e.target.value === "custom" ? addIsoDays(today, 7) : e.target.value)}
        className="form-input w-auto text-sm"
        aria-label="When"
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
        <option value="custom">Pick a date…</option>
      </select>
      {!isPreset && (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value || today)}
          className="form-input w-auto text-sm"
          aria-label="Date for new task"
        />
      )}
    </>
  );
}

/**
 * Type, press Enter, done. The lane/project/when selects sit beside it and persist between adds,
 * so capturing five incoming requests is five keystrokes-plus-Enter rather than five dialogs — and
 * planning six things for Monday means setting the day once, not six times.
 */
function QuickAdd({
  projects,
  defaultProjectId,
  today,
}: {
  projects: WorkProject[];
  defaultProjectId: string | null;
  today: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [lane, setLane] = useState<TaskLane>("Today");
  const [when, setWhen] = useState<string>(today);
  const [repeat, setRepeat] = useState<RecurFreq | "">("");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * One form, two destinations. With Repeats set, the same fields describe a SCHEDULE rather than
   * a task, so it posts to /api/work/recurrences and the "when" value becomes the start date; the
   * server materialises the first instances, and they arrive through the normal task path on the
   * refresh below. Weekly and monthly take their day from the start date — see createRecurrence.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    // Cleared immediately so the next task can be typed while this one is still in flight.
    setTitle("");
    const recurring = repeat !== "";
    try {
      const res = await fetch(recurring ? "/api/work/recurrences" : "/api/work/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          recurring
            ? { title: value, lane, project_id: projectId || null, freq: repeat, start_date: when }
            : { title: value, lane, project_id: projectId || null, work_date: when }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      celebrate("success");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTitle(value); // hand the text back rather than losing it
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={submit} className="card p-3 flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={when === today ? "What needs doing?" : "What needs doing, later?"}
        className="form-input flex-1 min-w-[14rem]"
        aria-label="New task"
      />
      <WhenSelect today={today} value={when} onChange={setWhen} />
      <select
        value={repeat}
        onChange={(e) => setRepeat(e.target.value as RecurFreq | "")}
        className="form-input w-auto text-sm"
        aria-label="Repeats"
      >
        <option value="">Once</option>
        {RECUR_FREQS.map((f) => (
          <option key={f} value={f}>{RECUR_LABELS[f]}</option>
        ))}
      </select>
      <select
        value={lane}
        onChange={(e) => setLane(e.target.value as TaskLane)}
        className="form-input w-auto text-sm"
        aria-label="Lane for new task"
      >
        {TASK_LANES.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="form-input w-auto text-sm max-w-[10rem]"
        aria-label="Project for new task"
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.project_id} value={p.project_id}>{p.name}</option>
        ))}
      </select>
      <button type="submit" disabled={busy || !title.trim()} className="btn-primary">
        <Plus className="w-4 h-4" />
        Add
      </button>
      {/* Says what's about to happen, but only when it isn't the default (one task, today). */}
      {repeat !== "" ? (
        <p className="text-xs text-neutral-400 w-full">
          {recurrenceLabel({
            freq: repeat,
            byweekday: null,
            bymonthday: null,
          })}
          , starting {dayLabel(when, today)}. Manage it under Repeating.
        </p>
      ) : (
        when !== today && (
          <p className="text-xs text-neutral-400 w-full">
            Lands on {dayLabel(when, today)} — not today&apos;s board.
          </p>
        )
      )}
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
    </form>
  );
}

/** Compact project strip. Clicking a card filters the board rather than navigating away. */
export function ProjectStrip({
  projects,
  activeId,
  onSelect,
}: {
  projects: WorkProject[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    setBusy(true);
    setName("");
    try {
      await fetch("/api/work/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      celebrate("success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(project: WorkProject, status: string) {
    await fetch("/api/work/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.project_id, status }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {projects.length === 0 && (
          <div className="card p-4 sm:col-span-2 xl:col-span-3">
            <p className="text-sm text-neutral-500">
              <Copy
                serious="No projects yet — add one below to group your tasks."
                playful="No projects yet. Blissful."
              />
            </p>
          </div>
        )}

        {projects.map((p) => {
          const active = activeId === p.project_id;
          return (
            <div
              key={p.project_id}
              className={cn(
                "card p-4 transition-all duration-200",
                active && "ring-2 ring-sprout-400/50"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onSelect(active ? null : p.project_id)}
                  className="text-left min-w-0 group"
                >
                  <p className="text-sm font-semibold text-neutral-900 truncate group-hover:text-sprout-700 transition-colors">
                    {p.name}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5 inline-flex items-center gap-1">
                    {p.openTaskCount ?? 0} open
                    <ChevronRight className="w-3 h-3" />
                  </p>
                </button>
                <select
                  value={p.status}
                  onChange={(e) => setStatus(p, e.target.value)}
                  className="form-input w-auto py-1 text-xs shrink-0"
                  aria-label={`${p.name} status`}
                >
                  {["Active", "Paused", "Waiting", "Completed"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {p.currentFocus && (
                <p className="text-xs text-neutral-500 mt-2 truncate" title={p.currentFocus}>
                  Next: {p.currentFocus}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={add} className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a project…"
          className="form-input max-w-xs"
          aria-label="New project"
        />
        <button type="submit" disabled={busy || !name.trim()} className="btn-secondary">
          <Plus className="w-4 h-4" />
          Add
        </button>
      </form>
    </div>
  );
}
