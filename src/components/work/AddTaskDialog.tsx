"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import { WhenSelect } from "@/components/work/WhenSelect";
import { QuadrantSelect } from "@/components/work/Quadrant";
import {
  LANE_META,
  RECUR_FREQS,
  RECUR_LABELS,
  TASK_LANES,
  TASK_PRIORITIES,
  dayLabel,
  recurrenceLabel,
  type RecurFreq,
  type TaskLane,
  type TaskPriority,
  type Triage,
  type WorkProject,
} from "@/lib/work";

/**
 * The task capture form, behind a button rather than sitting open on the page.
 *
 * It used to be a permanently-visible row above the board: title plus six selects, all live at
 * once. That reads fine once you know what each one does, but the FIRST thing anyone sees when
 * they want to jot down "call the vendor back" is six dropdowns standing between them and typing —
 * and the row was the same width whether today held one task or none. A button that just says
 * "Add Task" costs nothing to look at, and the form only exists once you have actually asked for
 * it.
 *
 * The dialog does NOT close itself after a successful add. The original form's fields persisted
 * between adds on purpose — capturing five incoming requests was five keystrokes-plus-Enter, and
 * planning six things for Monday meant setting the day once rather than six times — and a popup
 * that closed on every add would undo exactly that. So it clears the title, keeps every other
 * field as it was, and waits for either another task or Cancel/the backdrop to actually leave.
 */
export function AddTaskDialog({
  projects,
  defaultProjectId,
  today,
}: {
  projects: WorkProject[];
  defaultProjectId: string | null;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary self-start">
        <Plus className="w-4 h-4" />
        Add Task
      </button>
      {open && (
        <AddTaskForm
          projects={projects}
          defaultProjectId={defaultProjectId}
          today={today}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddTaskForm({
  projects,
  defaultProjectId,
  today,
  onClose,
}: {
  projects: WorkProject[];
  defaultProjectId: string | null;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [lane, setLane] = useState<TaskLane>("Today");
  const [priority, setPriority] = useState<TaskPriority>("Normal");
  const [when, setWhen] = useState<string>(today);
  const [repeat, setRepeat] = useState<RecurFreq | "">("");
  /**
   * Defaults to Unsorted rather than to a square, on purpose. A default quadrant would be a lie
   * told about every task typed in a hurry, and the unsorted cell exists precisely so that
   * capturing something fast stays free.
   */
  const [triage, setTriage] = useState<Triage>({ urgent: null, important: null });
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

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
    const recurring = repeat !== "";
    try {
      const res = await fetch(recurring ? "/api/work/recurrences" : "/api/work/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          recurring
            ? {
                title: value,
                lane,
                priority,
                project_id: projectId || null,
                freq: repeat,
                start_date: when,
                ...triage,
              }
            : {
                title: value,
                lane,
                priority,
                project_id: projectId || null,
                work_date: when,
                ...triage,
              }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      celebrate("success");
      setTitle("");
      setAddedCount((n) => n + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card bg-surface w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Add Task</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="form-label" htmlFor="new-task-title">Task</label>
            <input
              id="new-task-title"
              ref={inputRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              className="form-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="form-label">When</span>
              <div className="flex items-center gap-2">
                <WhenSelect today={today} value={when} onChange={setWhen} />
              </div>
            </div>
            <div>
              <span className="form-label">Quadrant</span>
              <QuadrantSelect value={triage} onChange={setTriage} size="md" label="Quadrant for new task" />
            </div>
            <div>
              <label className="form-label" htmlFor="new-task-lane">Lane</label>
              <select
                id="new-task-lane"
                value={lane}
                onChange={(e) => setLane(e.target.value as TaskLane)}
                className="form-input"
              >
                {/* Value is the stored lane, text is the label — see LANE_META: 'Today' displays as 'To Do'. */}
                {TASK_LANES.map((l) => (
                  <option key={l} value={l}>{LANE_META[l].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="new-task-priority">Priority</label>
              <select
                id="new-task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="form-input"
              >
                {TASK_PRIORITIES.map((pr) => (
                  <option key={pr} value={pr}>{pr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="new-task-project">Project</label>
              <select
                id="new-task-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="form-input"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="new-task-repeat">Repeats</label>
              <select
                id="new-task-repeat"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as RecurFreq | "")}
                className="form-input"
              >
                <option value="">Once</option>
                {RECUR_FREQS.map((f) => (
                  <option key={f} value={f}>{RECUR_LABELS[f]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Says what's about to happen, but only when it isn't the default (one task, today). */}
          {repeat !== "" ? (
            <p className="text-xs text-neutral-400">
              {recurrenceLabel({ freq: repeat, byweekday: null, bymonthday: null })}, starting{" "}
              {dayLabel(when, today)}. Manage it under Repeating.
            </p>
          ) : (
            when !== today && (
              <p className="text-xs text-neutral-400">
                Lands on {dayLabel(when, today)} — not today&apos;s board.
              </p>
            )
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            {error && <p className="form-error mr-auto">{error}</p>}
            {!error && addedCount > 0 && (
              <p className="text-xs text-neutral-400 mr-auto">
                {addedCount} added this round · everything but the title stays set
              </p>
            )}
            <button type="button" onClick={onClose} className="btn-secondary">Done</button>
            <button type="submit" disabled={busy || !title.trim()} className="btn-primary">
              <Plus className="w-4 h-4" />
              Add Task
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
