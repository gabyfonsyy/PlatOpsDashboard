"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Plus,
  Trash2,
  ChevronRight,
  ChevronsRight,
  CopyPlus,
  Repeat,
  StickyNote,
  PauseCircle,
  History,
  MoreVertical,
  Pencil,
  ChevronDown,
  AlertCircle,
  User,
  Target,
  Flag,
  TrendingDown,
} from "lucide-react";
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
  pushTargetDate,
  recurrenceLabel,
  statusTone,
  QUADRANT_META,
  QUADRANT_ORDER,
  DECK_COPY,
  briefGaps,
  currentPhaseFor,
  groupByQuadrant,
  matrixReadout,
  metricLine,
  parkComplaint,
  projectDrift,
  projectReadout,
  quadrantOf,
  type Quadrant,
  type RecurFreq,
  type TaskLane,
  type TaskPriority,
  type Triage,
  type WorkProject,
  type WorkTask,
} from "@/lib/work";
import { Copy } from "@/components/ui/Copy";
import {
  MatrixReadoutStrip,
  ParkFields,
  ParkedNote,
  QuadrantCell,
  QuadrantSelect,
} from "@/components/work/Quadrant";
import { BriefSummary, ProjectBriefPanel } from "@/components/work/ProjectBriefPanel";

/**
 * How today's work is arranged. Two framings of exactly the same rows, never two lists:
 *
 *   lanes  — where a task sits in today's view. Intent: what am I doing about this today?
 *   matrix — Eisenhower. Judgement: what KIND of work is this, and should it be mine at all?
 *
 * They are deliberately not merged. A lane answers "is this today's problem", a quadrant answers
 * "is this worth being anybody's problem", and collapsing the two would force "urgent, not mine,
 * and blocked on someone else" to pick one label. Switching framings re-groups the same tasks; it
 * never filters, so nothing can hide in the framing you are not looking at.
 */
export type Grouping = "lane" | "matrix";

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
  grouping,
  slipCounts,
  projectFilter,
  onClearFilter,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
}: {
  tasks: WorkTask[];
  projects: WorkProject[];
  today: string;
  grouping: Grouping;
  /** How many times each task has been pushed. Drives the "moved N times" marker on a row. */
  slipCounts: Map<string, number>;
  /** When set, only this project's tasks show — driven by clicking a project card. */
  projectFilter: string | null;
  onClearFilter: () => void;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
}) {
  const visible = useMemo(
    () => (projectFilter ? tasks.filter((t) => t.project_id === projectFilter) : tasks),
    [tasks, projectFilter]
  );
  const { lanes, settled } = useMemo(() => groupTasks(visible), [visible]);
  const projectName = (id: string | null) =>
    id ? projects.find((p) => p.project_id === id)?.name ?? null : null;

  const focusOpen = lanes.Focus.filter(isOpen).length;
  // Computed from the visible rows, so filtering to one project describes THAT project's day
  // rather than quietly reporting on tasks the board isn't showing.
  const readout = useMemo(() => matrixReadout(visible, slipCounts), [visible, slipCounts]);
  /**
   * Project-level lines, folded into the SAME strip as the task ones rather than given a panel of
   * their own. "Two active projects have no task anywhere" and "5 of 7 tasks are in Drive" are
   * observations about one day at two scales, and splitting them into two boxes is how a page
   * ends up being read as two unrelated warnings.
   *
   * Suppressed while a project filter is on: every line would be about projects the board is not
   * currently showing.
   */
  const projectNotes = useMemo(
    () => (projectFilter ? [] : projectReadout(projects)),
    [projects, projectFilter]
  );

  return (
    <div className="flex flex-col gap-4">
      <QuickAdd projects={projects} defaultProjectId={projectFilter} today={today} />

      {projectFilter && (
        <button onClick={onClearFilter} className="self-start btn-secondary py-1 px-3 text-xs">
          Showing {projectName(projectFilter)} only · clear
        </button>
      )}

      {grouping === "matrix" ? (
        <>
          <MatrixReadoutStrip readout={readout} extra={projectNotes} />
          <MatrixBoard
            tasks={visible.filter(isOpen)}
            projects={projects}
            today={today}
            slipCounts={slipCounts}
            readout={readout}
            onToggleDone={onToggleDone}
            onPatch={onPatch}
            onDelete={onDelete}
            onPush={onPush}
            onCopy={onCopy}
          />
        </>
      ) : (
        TASK_LANES.map((lane) => (
          <Lane
            key={lane}
            lane={lane}
            tasks={lanes[lane]}
            projects={projects}
            today={today}
            slipCounts={slipCounts}
            overFocusLimit={lane === "Focus" && focusOpen > FOCUS_SOFT_LIMIT}
            onToggleDone={onToggleDone}
            onPatch={onPatch}
            onDelete={onDelete}
            onPush={onPush}
            onCopy={onCopy}
          />
        ))
      )}

      {settled.length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-2 flex items-center gap-2">
            <span
              className="signal"
              style={{ ["--signal-rgb" as string]: "var(--ok-500)" }}
              aria-hidden="true"
            />
            <Copy serious={DECK_COPY.settled.serious} playful={DECK_COPY.settled.playful} />
            <span className="text-neutral-300">· {settled.length}</span>
          </p>
          <div className="card divide-y divide-neutral-100">
            {settled.map((task) => (
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
      )}
    </div>
  );
}

function Lane({
  lane,
  tasks,
  projects,
  today,
  slipCounts,
  overFocusLimit,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
}: {
  lane: TaskLane;
  tasks: WorkTask[];
  projects: WorkProject[];
  today: string;
  slipCounts: Map<string, number>;
  overFocusLimit: boolean;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
}) {
  const meta = LANE_META[lane];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          {/* A point of light rather than an emoji, and on every lane rather than just one: the
              dot is the same status vocabulary the rest of the deck uses, so a lane heading reads
              as part of the instrument panel instead of as a label with a sticker on it. */}
          {/* Steady, never pulsing. Focus is "current", not "critical" — the breathing dot is
              reserved for things that are actually wrong, or it stops meaning anything. */}
          <span
            className="signal self-center"
            style={{ ["--signal-rgb" as string]: LANE_SIGNAL[lane] }}
            aria-hidden="true"
          />
          <p className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
            <Copy serious={meta.label} playful={meta.playful} />
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
          <p className="text-xs text-neutral-400">
            <Copy serious={meta.hint} playful={meta.playfulHint} />
          </p>
        </div>
      ) : (
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
      )}
    </div>
  );
}

/**
 * Which light each lane shows. Tokens, never hex — the palette moves per theme and these have to
 * move with it. Focus takes the accent because it is the one lane that is a commitment; Waiting
 * takes gold because "held up" is the deck's attention colour; Incoming stays neutral, since
 * untriaged work has no status yet by definition.
 */
const LANE_SIGNAL: Record<TaskLane, string> = {
  Focus: "var(--a-500)",
  Today: "var(--n-400)",
  Waiting: "var(--warn-500)",
  Incoming: "var(--n-300)",
};

/**
 * The 2x2. Four cells plus a fifth, full-width one for anything not yet triaged.
 *
 * The unsorted cell is separate and is NOT hidden when it is empty on the way in — an untriaged
 * task quietly filed under "Kill or park" would be the single worst thing this feature could do,
 * so unsorted work is given its own visible place and asked, once, to be sorted. When there is
 * none, the cell disappears entirely: an empty box captioned "nothing to sort" is just furniture.
 *
 * Only OPEN tasks are laid out here. Done and Deferred work still collects under "Settled today"
 * below the grid, because a finished task has no quadrant worth arguing about and four cells
 * padded out with yesterday's ticks is how the matrix stops being readable at a glance.
 */
function MatrixBoard({
  tasks,
  projects,
  today,
  slipCounts,
  readout,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
}: {
  tasks: WorkTask[];
  projects: WorkProject[];
  today: string;
  slipCounts: Map<string, number>;
  readout: ReturnType<typeof matrixReadout>;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
}) {
  // Same order inside a cell as inside a lane — High first, then oldest — so switching framing
  // re-groups the rows without also silently re-ranking them.
  const byPriority = { High: 0, Normal: 1, Low: 2 } as const;
  const { cells, unsorted } = useMemo(() => {
    const grouped = groupByQuadrant(tasks);
    const rank = (a: WorkTask, b: WorkTask) =>
      byPriority[a.priority] - byPriority[b.priority] || a.created_at.localeCompare(b.created_at);
    for (const q of QUADRANT_ORDER) grouped.cells[q].sort(rank);
    grouped.unsorted.sort(rank);
    return grouped;
  }, [tasks]);
  // Which squares are currently living out their own failure mode, so the cell can say so in
  // place rather than only in the strip above the board.
  const warned = new Set(readout.notes.map((n) => n.quadrant).filter(Boolean) as Quadrant[]);

  const rows = (list: WorkTask[], emptyHint: { serious: string; playful: string } | null) =>
    list.length === 0 ? (
      emptyHint ? (
        <p className="text-xs text-neutral-400">
          <Copy serious={emptyHint.serious} playful={emptyHint.playful} />
        </p>
      ) : null
    ) : (
      // `min-w-0`: a flex/grid child's automatic minimum size is its CONTENT width, so without
      // this a row that refuses to shrink widens the cell itself rather than wrapping inside it —
      // the overflow just reappears one level up and the 2x2 goes uneven.
      <div className="-mx-4 min-w-0 divide-y divide-neutral-100">
        {list.map((task) => (
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
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Two columns from md up, NOT from the viewport's xl: this grid renders inside MyWorkView's
          2/3 column, so the breakpoint has to describe THIS container. Same lesson as the
          ProjectStrip fix. */}
      {/* `auto-rows-fr` plus the default stretch is what makes the four boxes the same size. The
          headers are different heights by nature — "If everything is here, nothing is" is six words
          and the Kill-or-park note is fourteen — so cells sized to their content came out visibly
          uneven, with Kill-or-park the odd one out. `items-start` (which was here) made it worse by
          shrinking every cell to its own content. Rows are equal, cells stretch to their row, and
          QuadrantCell pins its header to a fixed height so the task lists start on the same line. */}
      <div className="grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-4">
        {QUADRANT_ORDER.map((q) => (
          <QuadrantCell
            key={q}
            quadrant={q}
            count={cells[q].length}
            warn={warned.has(q) ? QUADRANT_META[q].note : null}
          >
            {rows(cells[q], EMPTY_CELL[q])}
          </QuadrantCell>
        ))}
      </div>

      {unsorted.length > 0 && (
        <section className="card border-l-2 border-l-neutral-200 p-4 flex flex-col gap-3">
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-700">Not sorted yet</h3>
            <span className="text-xs text-neutral-400">{unsorted.length}</span>
          </header>
          <p className="text-xs text-neutral-500">
            <Copy
              serious="Two questions each: does it have a deadline that is real, and does it matter if it is never done. Untriaged work is parked in neither square until you answer."
              playful="Two questions each: is the deadline real, and would anyone notice if it never happened? Until you answer, these are in no square at all."
            />
          </p>
          {rows(unsorted, null)}
        </section>
      )}
    </div>
  );
}

/**
 * What an empty square means — different for each, so none of them just says "nothing here".
 * Two registers, same claim, picked by CSS (see ui/Copy).
 */
const EMPTY_CELL: Record<Quadrant, { serious: string; playful: string }> = {
  drive: {
    serious: "Nothing you personally have to steer today.",
    playful: "Nobody needs you at the wheel today. Suspicious, but take it.",
  },
  protect: {
    serious: "Empty. This is the square that pays for next quarter.",
    playful: "Empty — and this is the one that pays for next quarter.",
  },
  delegate: {
    serious: "Nothing leaking. Keep it that way.",
    playful: "No leaks. Smugness permitted.",
  },
  park: {
    serious: "Nothing to kill and nothing rotting.",
    playful: "Nothing rotting in here. Lovely.",
  },
};

/**
 * The row's actions, behind one button.
 *
 * Push, copy, park and delete used to be four separate icons in the hover cluster, wedged between
 * four dropdowns — nine controls appearing at once on hover, with the destructive one sitting
 * directly beside the ones you press every evening. Actions and field editors are different kinds
 * of thing and now look it: the selects still change a value in place, and anything that DOES
 * something to the task lives here.
 *
 * `position: absolute`, not `fixed`, and that is load-bearing. `.card` is `backdrop-blur-xl`,
 * which makes it a containing block for fixed descendants (the trap documented at length in
 * ui/SidePanel) — an absolutely positioned menu is measured against the row instead and is
 * unaffected. `.card` sets no `overflow`, so a menu overhanging the last row is not clipped.
 */
function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // `mousedown` rather than `click`: closing on click would fire after a menu item's own
    // handler had already re-rendered the row, and on a row that MOVES (push) the item would be
    // gone by the time the document listener ran.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "p-1 rounded-md transition-colors",
          open ? "text-neutral-700 bg-neutral-100" : "text-neutral-300 hover:text-neutral-700"
        )}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        // Right-aligned: the button sits at the row's right edge, so a left-aligned menu would
        // hang off the card.
        <div role="menu" className="dropdown-menu left-auto right-0 min-w-[13rem]">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One line in a RowMenu. `tone="danger"` is reserved for the irreversible one. */
function RowMenuItem({
  icon: Icon,
  children,
  onClick,
  hint,
  tone,
}: {
  icon: typeof PauseCircle;
  children: React.ReactNode;
  onClick: () => void;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        "dropdown-item w-full text-left",
        tone === "danger" && "text-red-600 hover:bg-red-50 hover:text-red-700"
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{children}</span>
      </span>
      {hint && <span className="text-[11px] text-neutral-400 shrink-0">{hint}</span>}
    </button>
  );
}

/** Exported so the Upcoming panel renders planned tasks with exactly the same affordances. */
export function TaskRow({
  task,
  projects,
  today,
  slipCount = 0,
  onToggleDone,
  onPatch,
  onDelete,
  onPush,
  onCopy,
}: {
  task: WorkTask;
  projects: WorkProject[];
  today: string;
  /**
   * How many times this task has already been pushed to a later day. Shown from two onwards —
   * one slip is a Tuesday, and marking it would turn an ordinary act into an accusation. Repeated
   * slipping is the finding, and it is the evidence behind "Protect gets eaten first".
   */
  slipCount?: number;
  onToggleDone: (t: WorkTask) => void;
  onPatch: (t: WorkTask, patch: Partial<WorkTask>) => void;
  onDelete: (t: WorkTask) => void;
  /** One click, no dialog: move to the next working day. The reason is asked for afterwards. */
  onPush: (t: WorkTask) => void;
  onCopy: (t: WorkTask, date: string) => void;
}) {
  const done = task.status === "Done";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(task.notes ?? "");
  const hasNotes = Boolean((task.notes ?? "").trim());

  const pushTo = pushTargetDate(task.work_date, today);
  const [copyOpen, setCopyOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkReason, setParkReason] = useState(task.park_reason ?? "");
  const [parkDecision, setParkDecision] = useState(task.park_decision ?? "");
  const [parkError, setParkError] = useState<string | null>(null);
  const parked = task.status === "Deferred";
  // The plan this task belongs to, if it belongs to one at all.
  const phases = projects.find((p) => p.project_id === task.project_id)?.phases ?? [];
  const phase = phases.find((ph) => ph.id === task.phase_id) ?? null;
  // Defaults to the same day the push button would use, which on a weekday is tomorrow and on a
  // Friday is Monday — so the common answer is already selected and copying is two clicks.
  const [copyDate, setCopyDate] = useState(pushTo);

  /**
   * Notes save on blur rather than on every keystroke: a note is written in one go, and a PATCH
   * per character would put a paragraph's worth of writes through the optimistic store. An
   * emptied box is stored as null, so "no notes" is one value rather than sometimes "".
   */
  function commitNotes() {
    const next = notes.trim();
    if (next === (task.notes ?? "").trim()) return;
    onPatch(task, { notes: next || null });
  }

  /**
   * Parking a task, with the two answers attached. Both are sent in the SAME patch as the status,
   * not saved first and parked second: the server refuses a park that arrives without them (see
   * the tasks route), and splitting it into two writes would mean the first one could land while
   * the second failed, leaving a reason attached to a task that is not parked.
   */
  function park() {
    const complaint = parkComplaint({ park_reason: parkReason, park_decision: parkDecision });
    if (complaint) {
      setParkError(complaint);
      return;
    }
    setParkError(null);
    setParkOpen(false);
    onPatch(task, {
      status: "Deferred",
      park_reason: parkReason.trim(),
      park_decision: parkDecision.trim(),
    });
  }

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
    <div>
    {/*
      Wraps rather than squeezes. The controls on the right are `shrink-0`, so in a one-line row
      they take their width first and the title — the only thing on the row you actually read —
      gets whatever is left, which in the board's 2/3 column was a couple of characters ("Q…").
      `flex-wrap` plus a real flex-basis on the title means the cluster drops to a second line when
      it can't fit beside a readable title, instead of eating it.
    */}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 group">
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

      {/* basis-56 is the floor: below ~14rem of room for the title the controls wrap away rather
          than truncate it further. Editing claims the whole line — a rename you can't read back
          is worse than a title you can't read. */}
      <div className={cn("min-w-0 grow", editing ? "basis-full" : "basis-56")}>
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
            title={task.title}
            className={cn(
              "text-left text-sm w-full truncate transition-colors",
              done ? "text-neutral-400 line-through" : "text-neutral-900 hover:text-sprout-700"
            )}
          >
            {task.title}
          </button>
        )}
      </div>

      {/*
        Allowed to SHRINK and to WRAP, which it was not before.

        `shrink-0` was right when this row only ever rendered in the board's two-thirds column: the
        controls took their width first and the title got what was left. In a matrix cell — half of
        that column, so roughly 390px — the same rule means a cluster with an intrinsic width of
        ~600px simply hangs out the side of the box, because a flex item that can neither shrink
        nor wrap has nowhere else to go.

        Making it shrinkable does NOT bring the crushed title back: the title carries `basis-56` as
        a floor and this cluster's base size is its content, so under compression the wide one
        gives up the most. Clipping with `overflow-hidden` was the other option and is worse — it
        would also clip the row menu, which is absolutely positioned and has to escape the row.
      */}
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 min-w-0 ml-auto">
        {task.priority === "High" && !done && <Badge tone="danger">High</Badge>}
        {!done && task.status !== "To Do" && <Badge tone={statusTone(task.status)}>{task.status}</Badge>}

        {/* Which phase this advances, readable without hovering — it is the only thing on the
            row that says what the work is FOR, and a plan you have to go looking for is a plan
            that stops being followed. */}
        {phase && !done && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-neutral-400 shrink-0 max-w-[10rem]"
            title={`Phase: ${phase.name} — ends when: ${phase.exit}`}
          >
            <Flag className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{phase.name}</span>
          </span>
        )}

        {/* From two slips on. See the note on slipCount: the second move is the pattern, and it
            is the only evidence the Protect warning above the board is standing on. */}
        {slipCount > 1 && !done && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-amber-600 shrink-0"
            title={`Pushed to a later day ${slipCount} times`}
          >
            <History className="w-3 h-3" aria-hidden="true" />
            {slipCount}&times;
          </span>
        )}

        {/* Always visible, never behind hover: which square something is in is the one thing on
            the row worth reading without touching it. See QuadrantSelect. */}
        <QuadrantSelect
          value={task as Triage}
          onChange={(next) => onPatch(task, next as Partial<WorkTask>)}
          label={`Quadrant for ${task.title}`}
        />

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

        {/* The less-used controls stay hidden until hover, so a row reads as one line of text.
            Hidden by WIDTH, not just opacity: opacity-0 still reserved ~450px of the row for four
            controls nobody could see, which is what crushed the title. `w-0 overflow-hidden` gives
            that space back and — unlike `hidden`/`invisible` — leaves the controls in the focus
            order, so Tab still reaches them and focus-within opens the cluster.

            Wrapping is what stops it spilling out of a narrow matrix cell: expanded it is
            `w-auto`, i.e. as wide as five selects care to be, so being shrinkable and wrapping is
            what folds it onto a second line inside the cell instead. The row gets taller on hover
            in a narrow column, which is the correct trade and the same one `basis-56` makes.

            But the wrap is `group-hover:`/`focus-within:` ONLY, never the resting state. Wrapping
            at `w-0` would put each of the five controls on its own line — clipped to zero WIDTH by
            `overflow-hidden`, which does nothing about height — so every row on the page would
            stand five lines tall to hide controls nobody can see. Exactly the bug `w-0` was
            introduced to fix, in the other axis. */}
        {/* Only the FIELD EDITORS are behind hover now. Each one changes a value in place and
            none of them does anything to the task, which is what makes them safe to reveal on a
            mouse-over; the actions moved into the menu at the end of the row. */}
        <div className="flex flex-nowrap group-hover:flex-wrap focus-within:flex-wrap items-center gap-1 min-w-0 w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:opacity-100 focus-within:w-auto focus-within:opacity-100 transition-opacity">
          {/* Rescheduling is one control, not a submenu: pick a day and the row moves there. */}
          {/* The widest control here by some way, and usually the one that refuses to fit.
              `min-w-0` lets it give up its last few pixels rather than the cluster wrapping a
              whole line for its sake. */}
          <input
            type="date"
            value={task.work_date}
            onChange={(e) => e.target.value && onPatch(task, { work_date: e.target.value })}
            className="form-input w-auto min-w-0 py-1 text-xs"
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
              <option key={l} value={l}>{LANE_META[l].label}</option>
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

          {/* Only when there is a plan to point at. A phase picker on a task with no project, or
              on a project whose brief has not been phased, is a dropdown with one option in it. */}
          {phases.length > 0 && (
            <select
              value={task.phase_id ?? ""}
              onChange={(e) => onPatch(task, { phase_id: e.target.value || null })}
              className="form-input w-auto py-1 text-xs max-w-[10rem]"
              aria-label={`Phase for ${task.title}`}
              title="Which phase of the project this advances"
            >
              <option value="">No phase</option>
              {phases.map((ph, i) => (
                <option key={ph.id} value={ph.id}>
                  {i + 1}. {ph.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Outside the hover-hidden group: a task that HAS a note must advertise it even at rest,
            or the note is invisible until you happen to hover the row it belongs to. */}
        <button
          onClick={() => setNotesOpen((v) => !v)}
          className={cn(
            "p-1 transition-colors",
            hasNotes
              ? "text-sprout-600 hover:text-sprout-700"
              : "text-neutral-300 hover:text-neutral-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
          )}
          aria-label={hasNotes ? `Notes for ${task.title}` : `Add notes to ${task.title}`}
          aria-expanded={notesOpen}
          title={hasNotes ? (task.notes ?? "") : "Add notes"}
        >
          <StickyNote className="w-3.5 h-3.5" />
        </button>

        {/* Always visible, unlike the field editors: these are the things you open the row to DO,
            and hunting for a hover target is what made the push button feel buried. */}
        <RowMenu label={`Actions for ${task.title}`}>
          {(close) => (
            <>
              {/* Still one click from here — "not today" is a 6pm thought and anything that asks a
                  question first (which day? why?) turns it into a chore. The reason popup catches
                  up afterwards; see MyWorkView. */}
              {!done && (
                <RowMenuItem
                  icon={ChevronsRight}
                  hint={dayLabel(pushTo, today)}
                  onClick={() => {
                    onPush(task);
                    close();
                  }}
                >
                  Push to next working day
                </RowMenuItem>
              )}
              <RowMenuItem
                icon={CopyPlus}
                onClick={() => {
                  setCopyOpen(true);
                  close();
                }}
              >
                Copy to another day…
              </RowMenuItem>
              {!done && !parked && (
                <RowMenuItem
                  icon={PauseCircle}
                  onClick={() => {
                    setParkOpen(true);
                    close();
                  }}
                >
                  Park it…
                </RowMenuItem>
              )}
              {/* Separated and last. It is the only irreversible item in the list, and it used to
                  sit immediately beside the button pressed every evening. */}
              <div className="my-1 border-t border-line/70" role="separator" />
              <RowMenuItem
                icon={Trash2}
                tone="danger"
                onClick={() => {
                  onDelete(task);
                  close();
                }}
              >
                Delete
              </RowMenuItem>
            </>
          )}
        </RowMenu>
      </div>
    </div>

    {copyOpen && (
      <div className="px-4 pb-3 pl-12 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Copy to</span>
        <WhenSelect today={today} value={copyDate} onChange={setCopyDate} />
        <button
          onClick={() => {
            onCopy(task, copyDate);
            setCopyOpen(false);
          }}
          className="btn-secondary py-1 px-3 text-xs"
        >
          <CopyPlus className="w-3.5 h-3.5" />
          Copy
        </button>
        <button
          onClick={() => setCopyOpen(false)}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          Cancel
        </button>
        {/* Said out loud because copy and push sit next to each other and look alike. The whole
            difference between them is what happens to the row you are pointing at. */}
        <p className="text-[11px] text-neutral-400 w-full">
          This one stays on {dayLabel(task.work_date, today)}.
        </p>
      </div>
    )}

    {/* What a park said, readable at rest — a park nobody can see is indistinguishable from a
        task that quietly stopped mattering, which is the exact confusion the fourth quadrant is
        supposed to end. */}
    {parked && (task.park_reason || task.park_decision) && !parkOpen && (
      <ParkedNote
        reason={task.park_reason}
        decision={task.park_decision}
        className="px-4 pb-3 pl-12"
      />
    )}

    {parkOpen && (
      <div className="px-4 pb-3 pl-12 flex flex-col gap-2">
        <ParkFields
          reason={parkReason}
          decision={parkDecision}
          onReason={setParkReason}
          onDecision={setParkDecision}
        />
        {parkError && <p className="text-xs text-red-600">{parkError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={park} className="btn-secondary py-1 px-3 text-xs">
            <PauseCircle className="w-3.5 h-3.5" />
            Park it
          </button>
          {/* The other half of the square, offered in the same breath. "Kill or park" is a choice
              between two things, and a UI that only offers one of them is quietly recommending it. */}
          <button
            onClick={() => onDelete(task)}
            className="text-xs text-neutral-400 hover:text-red-600 transition-colors"
          >
            Delete it instead
          </button>
          <button
            onClick={() => {
              setParkOpen(false);
              setParkError(null);
            }}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )}

    {notesOpen && (
      <div className="px-4 pb-3 pl-12">
        <textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setNotes(task.notes ?? "");
              setNotesOpen(false);
            }
          }}
          rows={3}
          placeholder="Notes, links, context…"
          className="form-input text-sm w-full"
          aria-label={`Notes for ${task.title}`}
        />
        <p className="text-[11px] text-neutral-400 mt-1">Saves when you click away · Esc to discard</p>
      </div>
    )}
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
  const [priority, setPriority] = useState<TaskPriority>("Normal");
  const [when, setWhen] = useState<string>(today);
  const [repeat, setRepeat] = useState<RecurFreq | "">("");
  /**
   * Triage at capture, and it persists between adds like every other select here. Sorting a task
   * later means opening the row and answering two questions about something you have already
   * stopped thinking about; sorting it now costs one click while the judgement is still fresh.
   *
   * It defaults to Unsorted rather than to a square, on purpose. A default quadrant would be a
   * lie told about every task typed in a hurry, and the unsorted cell exists precisely so that
   * capturing something fast stays free.
   */
  const [triage, setTriage] = useState<Triage>({ urgent: null, important: null });
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
      {/* Directly after the title: the two questions are easiest to answer in the same breath as
          typing the thing they are about. */}
      <QuadrantSelect value={triage} onChange={setTriage} size="md" label="Quadrant for new task" />
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
      {/* Priority at logging time: setting it later means opening the row's hover controls, and a
          task typed as urgent is most reliably marked urgent in the same breath. */}
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as TaskPriority)}
        className="form-input w-auto text-sm"
        aria-label="Priority for new task"
      >
        {TASK_PRIORITIES.map((pr) => (
          <option key={pr} value={pr}>{pr}</option>
        ))}
      </select>
      <select
        value={lane}
        onChange={(e) => setLane(e.target.value as TaskLane)}
        className="form-input w-auto text-sm"
        aria-label="Lane for new task"
      >
        {/* Value is the stored lane, text is the label — see LANE_META: 'Today' displays as 'To Do'. */}
        {TASK_LANES.map((l) => (
          <option key={l} value={l}>{LANE_META[l].label}</option>
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

/**
 * Compact project strip. Clicking a card filters the board rather than navigating away.
 *
 * Projects carry the same two axes as tasks, and in matrix mode they are grouped by them — because
 * the quadrant question is arguably MORE useful here. A task in the wrong square costs an
 * afternoon; a personal project that has sat in Kill-or-park for three months costs a quarter, and
 * it is the kind of thing that is invisible precisely because nothing about it ever changes.
 */
export function ProjectStrip({
  projects,
  tasks,
  activeId,
  grouping,
  onSelect,
}: {
  projects: WorkProject[];
  /**
   * Every task in play — today, ahead and overdue. Needed because a project's current phase is
   * derived from its open work wherever that work is scheduled: a phase whose only remaining task
   * is dated next Tuesday is still the phase you are in.
   */
  tasks: WorkTask[];
  activeId: string | null;
  grouping: Grouping;
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * Which brief is open: a project to edit, "new" for one being created, or nothing.
   *
   * Adding a project goes THROUGH the brief rather than round it. A name-only quick-add would be
   * used every time — it is one keystroke cheaper — and the six questions would then exist as a
   * thing you are supposed to remember to go back and fill in, which is the same as not existing.
   * The typed name is carried into the panel so nothing is retyped.
   */
  const [briefFor, setBriefFor] = useState<WorkProject | "new" | null>(null);

  function openNew(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBriefFor("new");
  }

  /**
   * Every project write goes through here so one place surfaces the server's refusal — notably
   * the park rule, which is enforced in the store and would otherwise fail silently behind a
   * fire-and-forget fetch. That was the previous behaviour: no response was read at all.
   */
  async function patchProject(project: WorkProject, patch: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch("/api/work/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.project_id, ...patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
      return false;
    }
  }

  /**
   * Deletes a project. Its tasks are not deleted with it — the FK is `on delete set null` — so
   * they stay on the days they happened, without a project. The card says how many are about to be
   * let loose before it asks, which is the number that makes the decision.
   */
  async function removeProject(project: WorkProject) {
    setError(null);
    try {
      const res = await fetch("/api/work/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.project_id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      if (activeId === project.project_id) onSelect(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    }
  }

  /**
   * Grouped by quadrant in matrix mode, in the fixed reading order, with untriaged projects last.
   * Stacked sections rather than a 2x2: this strip is a third of the page wide, and a two-column
   * grid inside it would give each project card a sixth of the viewport — the same mistake the
   * xl:grid-cols-3 bug made here before.
   */
  // Bucketed once rather than filtered per card: with a dozen projects and a full board, the
  // per-card filter is a dozen passes over the same array on every keystroke in the add box.
  const byProject = useMemo(() => {
    const map = new Map<string, WorkTask[]>();
    for (const task of tasks) {
      if (!task.project_id) continue;
      const bucket = map.get(task.project_id);
      if (bucket) bucket.push(task);
      else map.set(task.project_id, [task]);
    }
    return map;
  }, [tasks]);

  const groups = useMemo(() => {
    if (grouping !== "matrix") return [{ key: "all" as const, quadrant: null, items: projects }];
    const { cells, unsorted } = groupByQuadrant(projects);
    return [
      ...QUADRANT_ORDER.filter((q) => cells[q].length > 0).map((q) => ({
        key: q as string,
        quadrant: q,
        items: cells[q],
      })),
      ...(unsorted.length > 0
        ? [{ key: "unsorted", quadrant: null as Quadrant | null, items: unsorted }]
        : []),
    ];
  }, [projects, grouping]);

  return (
    <div className="flex flex-col gap-3">
      {/* Add sits ABOVE the list, mirroring QuickAdd above the task board: the input you reach for
          shouldn't move down the page every time you use it, and with a long project list it was
          scrolling out of reach entirely. */}
      <form onSubmit={openNew} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a project…"
          className="form-input flex-1 min-w-0"
          aria-label="New project"
        />
        <button type="submit" disabled={!name.trim()} className="btn-secondary shrink-0">
          <Plus className="w-4 h-4" />
          Add
        </button>
      </form>
      <p className="text-[11px] text-neutral-400 -mt-1">
        Opens the one-pager: problem, outcome, metric, what is explicitly out, phases, owner.
      </p>

      {briefFor && (
        <ProjectBriefPanel
          // Remounts per project, so the panel's fields are never seeded from the last one it
          // showed — the classic bug with a form kept alive behind a conditional.
          key={briefFor === "new" ? "new" : briefFor.project_id}
          open
          project={briefFor === "new" ? null : briefFor}
          initialName={briefFor === "new" ? name : undefined}
          onClose={() => setBriefFor(null)}
          onSaved={() => {
            setName("");
            celebrate("success");
            router.refresh();
          }}
        />
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {projects.length === 0 && (
        <div className="card p-4">
          <p className="text-sm text-neutral-500">
            <Copy
              serious="No projects yet — add one above to group your tasks."
              playful="No projects yet. Blissful."
            />
          </p>
        </div>
      )}

      {groups.map((group) => {
        const meta = group.quadrant ? QUADRANT_META[group.quadrant] : null;
        return (
          <div key={group.key} className="flex flex-col gap-3">
            {grouping === "matrix" && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wide",
                      meta ? meta.text : "text-neutral-500"
                    )}
                  >
                    {meta ? meta.verb : "Not sorted yet"}
                  </p>
                  <span className="text-xs text-neutral-400">{group.items.length}</span>
                </div>
                {meta && <p className="text-[11px] text-neutral-400">{meta.note}</p>}
              </div>
            )}

            {/* One column from xl up, NOT three. This strip renders inside MyWorkView's right-hand
                column, which is one third of an xl:grid-cols-3 page grid — so xl:grid-cols-3 here
                made each card a ninth of the page, squeezing the name against the status dropdown
                until they overlapped. The breakpoints have to describe THIS container. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
              {group.items.map((p) => (
                <ProjectCard
                  key={p.project_id}
                  project={p}
                  projectTasks={byProject.get(p.project_id) ?? EMPTY_TASKS}
                  active={activeId === p.project_id}
                  onSelect={() => onSelect(activeId === p.project_id ? null : p.project_id)}
                  onPatch={(patch) => patchProject(p, patch)}
                  onEdit={() => setBriefFor(p)}
                  onDelete={() => removeProject(p)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Shared empty array, so a project with no tasks does not get a new one on every render. */
const EMPTY_TASKS: WorkTask[] = [];

/**
 * One project. Carries its own park draft, because parking is a two-answer form and a single
 * shared draft in the strip would leak half-typed reasons between cards.
 */
function ProjectCard({
  project,
  projectTasks,
  active,
  onSelect,
  onPatch,
  onEdit,
  onDelete,
}: {
  project: WorkProject;
  /** This project's tasks across today, ahead and overdue — what the phase readout is derived from. */
  projectTasks: WorkTask[];
  active: boolean;
  onSelect: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const p = project;
  const [parkOpen, setParkOpen] = useState(false);
  const [reason, setReason] = useState(p.park_reason ?? "");
  const [decision, setDecision] = useState(p.park_decision ?? "");
  const [complaint, setComplaint] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  /**
   * Delete is a two-step in place rather than a `confirm()`: a native dialog cannot say the one
   * thing that decides it — how many tasks are attached — and it blocks the whole tab to ask a
   * question the card can ask better. Resets on any re-render that closes the card.
   */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const quadrant = quadrantOf(p);
  const gaps = briefGaps(p);
  const metric = metricLine(p);
  const openTasks = p.openTaskCount ?? 0;
  const tally = p.taskQuadrants;
  // The project's quadrant is a claim; this is what its open work actually says.
  const drift = tally ? projectDrift(p, tally) : null;
  const phase = currentPhaseFor(p, projectTasks);
  const stalled = p.status === "Active" && openTasks === 0;

  /**
   * Pausing opens the form instead of sending the status. This is the whole rule made mechanical:
   * a project cannot become Paused without a stated reason and a named decision, so the two are
   * collected BEFORE the status change is sent rather than requested afterwards and quietly never
   * given. Every other status goes straight through — none of them is a park.
   *
   * A project already carrying both answers passes through too: re-confirming a park that is
   * already properly stated is a question with a known answer.
   */
  function changeStatus(status: string) {
    if (status !== "Paused") {
      setParkOpen(false);
      void onPatch({ status });
      return;
    }
    if (!parkComplaint({ park_reason: p.park_reason, park_decision: p.park_decision })) {
      void onPatch({ status });
      return;
    }
    setComplaint(null);
    setParkOpen(true);
  }

  async function confirmPark() {
    const bad = parkComplaint({ park_reason: reason, park_decision: decision });
    if (bad) {
      setComplaint(bad);
      return;
    }
    setComplaint(null);
    const ok = await onPatch({
      status: "Paused",
      park_reason: reason.trim(),
      park_decision: decision.trim(),
    });
    if (ok) setParkOpen(false);
  }

  return (
    <div
      className={cn("card p-4 transition-all duration-200", active && "ring-2 ring-sprout-400/50")}
    >
      <div className="flex items-start justify-between gap-3">
        <button onClick={onSelect} className="text-left min-w-0 flex-1 group">
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
          onChange={(e) => changeStatus(e.target.value)}
          className="form-input w-auto py-1 text-xs shrink-0"
          aria-label={`${p.name} status`}
        >
          {["Active", "Paused", "Waiting", "Completed"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <QuadrantSelect
          value={p as Triage}
          onChange={(next) => void onPatch(next as Record<string, unknown>)}
          label={`Quadrant for ${p.name}`}
        />
        {quadrant && (
          <span className="text-[11px] text-neutral-400">{QUADRANT_META[quadrant].axis}</span>
        )}
      </div>

      {/* The two lines of the brief worth seeing without opening anything: who owns it, and what
          "done" is measured as. Everything else is one click away. */}
      {(p.owner || metric) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-neutral-500">
          {p.owner && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <User className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{p.owner}</span>
            </span>
          )}
          {metric && (
            <span className="inline-flex items-center gap-1 min-w-0" title={metric}>
              <Target className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{metric}</span>
            </span>
          )}
        </div>
      )}

      {/* The current phase and, more importantly, what has to be true to leave it. This is the
          line that turns the brief from a document into something today's work is measured
          against. */}
      {phase && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-neutral-500">
          <Flag className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="text-neutral-700">
              Phase {phase.index + 1}: {phase.phase.name}
            </span>
            {phase.phase.exit && (
              <span className="block text-neutral-400">Ends when: {phase.phase.exit}</span>
            )}
            <span className="block text-neutral-400">
              {phase.open} open{phase.done > 0 ? ` · ${phase.done} settled` : ""}
            </span>
          </span>
        </div>
      )}

      {/* The claim checked against the evidence. Only speaks when the two have genuinely come
          apart — see projectDrift, which needs a real majority before it says anything. */}
      {drift && (
        <p className="mt-2 text-[11px] text-amber-600 flex items-start gap-1.5">
          <TrendingDown className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <Copy serious={drift.text} playful={drift.playful} />
          </span>
        </p>
      )}

      {/* Active and nothing on any board. The quiet way a project with a good brief dies. */}
      {stalled && (
        <p className="mt-2 text-[11px] text-neutral-500 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <Copy
              serious="Active, with no task on any board. Nothing is happening to this."
              playful="Marked Active. Nothing on any board. Nothing is happening to this."
            />
          </span>
        </p>
      )}

      {/* Named, not counted, and shown on the card rather than only inside the form — a brief
          nobody is reminded of is a brief that stays half-written. */}
      {gaps.length > 0 && (
        <button
          onClick={onEdit}
          className="mt-2 text-[11px] text-amber-600 hover:text-amber-700 transition-colors inline-flex items-start gap-1.5 text-left"
        >
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Brief unanswered: {gaps.join(", ")}</span>
        </button>
      )}

      {p.currentFocus && (
        <p className="text-xs text-neutral-500 mt-2 truncate" title={p.currentFocus}>
          Next: {p.currentFocus}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2">
        {/* Only offered when there is something written to read. */}
        {(p.problem || p.outcome || p.phases.length > 0 || p.explicitly_out.length > 0) && (
          <button
            onClick={() => setBriefOpen((v) => !v)}
            aria-expanded={briefOpen}
            className="text-[11px] text-neutral-400 hover:text-sprout-700 transition-colors inline-flex items-center gap-1"
          >
            <ChevronDown
              className={cn("w-3 h-3 transition-transform duration-200", briefOpen && "rotate-180")}
              aria-hidden="true"
            />
            {briefOpen ? "Hide brief" : "Brief"}
          </button>
        )}
        <button
          onClick={onEdit}
          className="text-[11px] text-neutral-400 hover:text-sprout-700 transition-colors inline-flex items-center gap-1"
        >
          <Pencil className="w-3 h-3" aria-hidden="true" />
          Edit
        </button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2 text-[11px] ml-auto">
            <span className="text-neutral-500">
              {openTasks > 0
                ? `${openTasks} open task${openTasks === 1 ? "" : "s"} will stay, without a project.`
                : "Delete it?"}
            </span>
            <button
              onClick={onDelete}
              className="text-red-600 hover:text-red-700 font-medium transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-[11px] text-neutral-400 hover:text-red-600 transition-colors inline-flex items-center gap-1 ml-auto"
            aria-label={`Delete ${p.name}`}
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            Delete
          </button>
        )}
      </div>

      {briefOpen && <BriefSummary project={p} />}

      {p.status === "Paused" && !parkOpen && (
        <div className="mt-2 flex items-start justify-between gap-2">
          <ParkedNote reason={p.park_reason} decision={p.park_decision} className="min-w-0" />
          <button
            onClick={() => setParkOpen(true)}
            className="text-[11px] text-neutral-400 hover:text-sprout-700 transition-colors shrink-0"
          >
            Edit
          </button>
        </div>
      )}

      {parkOpen && (
        <div className="mt-3 flex flex-col gap-2">
          <ParkFields
            reason={reason}
            decision={decision}
            onReason={setReason}
            onDecision={setDecision}
          />
          {complaint && <p className="text-xs text-red-600">{complaint}</p>}
          <div className="flex items-center gap-2">
            <button onClick={confirmPark} className="btn-secondary py-1 px-3 text-xs">
              <PauseCircle className="w-3.5 h-3.5" />
              Park it
            </button>
            <button
              onClick={() => {
                setParkOpen(false);
                setComplaint(null);
                setReason(p.park_reason ?? "");
                setDecision(p.park_decision ?? "");
              }}
              className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
