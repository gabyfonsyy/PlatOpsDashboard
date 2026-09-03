/**
 * Mission Control domain module — types, vocabularies and pure helpers shared by the server page
 * and the client components. No server imports, so client components can pull from it directly.
 *
 * The vocabularies here are the authority for the UI; supabase/my-work.sql carries the matching
 * CHECK constraints, so an invalid value is rejected by the database rather than quietly stored.
 */

import { isoDateDiffDays } from "@/lib/manila-date";

// ---------------------------------------------------------------------------- lanes

/**
 * Where a task sits in today's view. This is about INTENT, not progress — see `status` for that.
 * Ordered as the page renders them: what deserves attention, then what's planned, then what's
 * out of my hands, then what hasn't been triaged.
 */
export const TASK_LANES = ["Focus", "Today", "Waiting", "Incoming"] as const;
export type TaskLane = (typeof TASK_LANES)[number];

/**
 * LABELS ARE NOT THE STORED VALUES. The `Today` lane displays as "To Do" everywhere (renamed at
 * Gaby's request 2026-08-25) but is still stored, validated and CHECK-constrained as 'Today' in
 * work_tasks and work_recurrences. Renaming the value would mean altering two CHECK constraints
 * and rewriting every existing row, on live data, to change a word on screen — not a trade worth
 * making. So: render `LANE_META[lane].label`, never the raw lane, and expect 'Today' in the
 * database and in the API.
 */
export const LANE_META: Record<
  TaskLane,
  { label: string; hint: string; playful: string; playfulHint: string }
> = {
  Focus: {
    label: "Focus",
    hint: "The 1–2 things that actually deserve today",
    playful: "Focus",
    playfulHint: "The 1–2 things that actually deserve today",
  },
  Today: {
    label: "To Do",
    hint: "Also intending to work on these",
    playful: "Mission Queue",
    playfulHint: "Also intending to work on these",
  },
  Waiting: {
    label: "Waiting",
    hint: "Blocked on someone or something else",
    playful: "Grounded",
    playfulHint: "Held down by someone or something else",
  },
  Incoming: {
    label: "Incoming",
    hint: "New requests, not yet triaged",
    playful: "Incoming",
    playfulHint: "New signals, not yet triaged",
  },
};

/**
 * The label to show for a lane.
 *
 * Returns the PLAIN name only. Anywhere the lane can be rendered as markup — a board heading —
 * use <Copy serious={meta.label} playful={meta.playful} /> instead, so the register follows the
 * theme with no client JS. This exists for the places that need a bare string: `<option>` text,
 * aria-labels, titles. Which is also the right call on the merits — a dropdown is where you go
 * when you need to be sure what you are picking, and "Grounded" in a select next to a task you
 * are trying to file is a riddle. Space vocabulary belongs on headings, not on controls.
 */
export function laneLabel(lane: TaskLane): string {
  return LANE_META[lane].label;
}

/**
 * Gaby View's names for the board's own sections — the ones that are not lanes.
 *
 * Applied where the metaphor genuinely describes the thing, and nowhere else. "Mission Complete"
 * for finished work earns its place; renaming the date picker would not. Both registers ship in
 * the markup and CSS picks one (see <Copy>).
 */
export const DECK_COPY = {
  today: { serious: "Today", playful: "Mission Queue" },
  settled: { serious: "Settled today", playful: "Mission Complete" },
  projects: { serious: "Projects", playful: "In Orbit" },
  repeating: { serious: "Repeating", playful: "Standing Orders" },
  ahead: { serious: "Ahead", playful: "On Approach" },
  notToday: { serious: "Not Today", playful: "Off Deck" },
  past: { serious: "Past", playful: "Flight Log" },
  debrief: { serious: "Work Mirror", playful: "Mission Debrief" },
} as const;

/**
 * Focus is a commitment, not a bucket — the whole point is that it stays small enough to mean
 * something. Exceeded, the UI says so rather than silently letting it become a second Today list.
 */
export const FOCUS_SOFT_LIMIT = 3;

// ---------------------------------------------------------------------------- eisenhower

/**
 * The Eisenhower matrix, as two independent axes rather than one four-valued field.
 *
 * `urgent` and `important` are stored separately (see supabase/my-work.sql) and the quadrant is
 * DERIVED here. That is deliberate: the value of the model is that the two questions get asked
 * one at a time, and a single enum makes it possible to pick a square without ever answering
 * either one. Two booleans also make the half-triaged state — "I know this matters, I haven't
 * decided whether it's urgent" — representable instead of forcing a guess.
 *
 * Both are nullable. NULL is "not sorted yet", NOT "neither": defaulting to false/false would file
 * everything typed in a hurry into Kill-or-park, and work that arrives pre-condemned is worse than
 * work that arrives unsorted.
 */
export const QUADRANTS = ["drive", "protect", "delegate", "park"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

/** The two axes, as they are stored. Either may be null while a triage is half-answered. */
export type Triage = { urgent: boolean | null; important: boolean | null };

/**
 * What each square means and what it asks of you. The `note` is the failure mode of that square —
 * the thing that goes wrong when the quadrant is used badly — and it is shown next to the work,
 * not filed in documentation, because a matrix with no warnings attached degrades into four
 * prettier priority levels within a fortnight.
 */
export const QUADRANT_META: Record<
  Quadrant,
  {
    key: Quadrant;
    /** The verb. What you DO with the square — the label everywhere on screen. */
    verb: string;
    /** The definition, for anyone reading the board for the first time. */
    axis: string;
    /** The instruction. */
    line: string;
    /** The warning: what this square does to you when it is used wrong. */
    note: string;
    /**
     * The same two sentences in Gaby's View. Rendered through <Copy>, so BOTH strings are always
     * in the markup and CSS picks one — which is what lets a server component switch register
     * without a hydration flash.
     *
     * The rule from ai-voice.ts applies here too: the register may change, the CONTENT may not.
     * Each playful line has to make exactly the same claim as its serious twin, because these are
     * the sentences that stop the matrix decaying into four prettier priority levels. A joke that
     * drops the warning is not a different register, it is a missing warning.
     */
    playful: { line: string; note: string };
    urgent: boolean;
    important: boolean;
    tone: "danger" | "success" | "warning" | "neutral";
    /** Left border on the cell, and the dot on a row's chip. */
    accent: string;
    dot: string;
    text: string;
  }
> = {
  drive: {
    key: "drive",
    verb: "Drive",
    axis: "Urgent + Important",
    line: "You personally steer.",
    note: "If everything is here, nothing is.",
    playful: {
      line: "You, personally, at the wheel. No delegating this one.",
      note: "If everything is in here, nothing is. That is the trap.",
    },
    urgent: true,
    important: true,
    tone: "danger",
    accent: "border-l-red-400",
    dot: "bg-red-500",
    text: "text-red-700",
  },
  protect: {
    key: "protect",
    verb: "Protect",
    axis: "Important, not urgent",
    line: "The thing that stops next quarter's fire.",
    note: "Gets eaten first — it needs a calendar block.",
    playful: {
      line: "The stuff that means next quarter is not on fire.",
      note: "Always the first thing eaten. Block the time or lose it.",
    },
    urgent: false,
    important: true,
    tone: "success",
    accent: "border-l-sprout-400",
    dot: "bg-sprout-500",
    text: "text-sprout-700",
  },
  delegate: {
    key: "delegate",
    verb: "Delegate",
    axis: "Urgent, not important",
    line: "As an IC, this was “do it fast”.",
    note: "As a lead, this is your biggest time leak.",
    playful: {
      line: "IC you said “do it fast”. Lead you shouldn’t be doing it at all.",
      note: "Your biggest time leak, wearing a helpful little hat.",
    },
    urgent: true,
    important: false,
    tone: "warning",
    accent: "border-l-amber-400",
    dot: "bg-amber-500",
    text: "text-amber-700",
  },
  park: {
    key: "park",
    verb: "Kill or park",
    axis: "Neither",
    line: "Kill it, or park it on purpose.",
    note: "A parked project needs a stated reason and a named decision, not a slipped date.",
    playful: {
      line: "Kill it, or park it like you mean it.",
      note: "A park needs a reason and a named decision — not a date you’ll quietly move again.",
    },
    urgent: false,
    important: false,
    tone: "neutral",
    accent: "border-l-neutral-300",
    dot: "bg-neutral-400",
    text: "text-neutral-600",
  },
};

/**
 * Reading order of the cells: Drive, Protect, Delegate, Kill-or-park — the 2x2 read left to right,
 * top to bottom, with urgency on the horizontal. Protect sits top-right rather than bottom-left on
 * purpose: it is the square this whole feature exists to defend, and putting it below the fold
 * would be an odd way to defend it.
 */
export const QUADRANT_ORDER: Quadrant[] = ["drive", "protect", "delegate", "park"];

/** Where a thing sits, or null when it has not been triaged. Both axes have to be answered. */
export function quadrantOf(item: Partial<Triage> | null | undefined): Quadrant | null {
  if (!item) return null;
  const { urgent, important } = item;
  if (typeof urgent !== "boolean" || typeof important !== "boolean") return null;
  if (urgent && important) return "drive";
  if (!urgent && important) return "protect";
  if (urgent && !important) return "delegate";
  return "park";
}

/** The stored pair for a square. `null` clears the triage back to unsorted. */
export function triageFor(quadrant: Quadrant | null): Triage {
  if (!quadrant) return { urgent: null, important: null };
  const meta = QUADRANT_META[quadrant];
  return { urgent: meta.urgent, important: meta.important };
}

/** Short label for a chip: the verb, or "Unsorted". */
export function quadrantLabel(quadrant: Quadrant | null): string {
  return quadrant ? QUADRANT_META[quadrant].verb : "Unsorted";
}

/**
 * The same soft-limit idea as FOCUS_SOFT_LIMIT, applied to the square that always overflows.
 * "If everything is here, nothing is" stays a slogan until something counts.
 */
export const DRIVE_SOFT_LIMIT = 3;

/** Buckets by quadrant, keeping everything untriaged separate rather than lumping it into park. */
export function groupByQuadrant<T extends Partial<Triage>>(
  items: T[]
): { cells: Record<Quadrant, T[]>; unsorted: T[] } {
  const cells = Object.fromEntries(QUADRANTS.map((q) => [q, [] as T[]])) as Record<Quadrant, T[]>;
  const unsorted: T[] = [];
  for (const item of items) {
    const q = quadrantOf(item);
    if (q) cells[q].push(item);
    else unsorted.push(item);
  }
  return { cells, unsorted };
}

export type MatrixReadout = {
  counts: Record<Quadrant, number>;
  unsorted: number;
  triaged: number;
  /**
   * Deterministic observations about the shape of the day. Never more than a few.
   *
   * Each carries both registers, and the FIGURES ARE IDENTICAL in the two — only the framing words
   * differ. Copy's own rule is never to use it on operational values, and a number that changed
   * between registers would be exactly that: the same board reporting two different days.
   */
  notes: Array<{ quadrant: Quadrant | null; text: string; playful: string }>;
};

/**
 * What the day's shape actually says, computed from the rows — never written by a model, never
 * guessed. Each note restates the failure mode of a square together with the number that triggered
 * it, so the warning is checkable rather than decorative.
 *
 * `slipCounts` maps task_id to how many times that task has been pushed to a later day, and it is
 * what makes the Protect warning evidence rather than a proverb: "gets eaten first" is a claim,
 * and the reschedule log is the only thing on this page that can support it.
 */
export function matrixReadout(tasks: WorkTask[], slipCounts?: Map<string, number>): MatrixReadout {
  const open = tasks.filter(isOpen);
  const { cells, unsorted } = groupByQuadrant(open);
  const counts = Object.fromEntries(QUADRANTS.map((q) => [q, cells[q].length])) as Record<
    Quadrant,
    number
  >;
  const triaged = QUADRANTS.reduce((n, q) => n + counts[q], 0);
  const notes: MatrixReadout["notes"] = [];

  // Drive overflowing is the classic failure and the only one worth raising a voice about.
  if (counts.drive > DRIVE_SOFT_LIMIT) {
    notes.push({
      quadrant: "drive",
      text: `${counts.drive} of ${triaged} sorted tasks are in Drive. If everything is here, nothing is.`,
      playful: `${counts.drive} of ${triaged} are in Drive. If it's all urgent and important, none of it is — pick.`,
    });
  }

  // Only said once there is a day to describe. "Nothing in Protect" on an almost-empty board is a
  // statement about an almost-empty board, not about how the day is being spent.
  if (triaged >= 3 && counts.protect === 0) {
    notes.push({
      quadrant: "protect",
      text: "Nothing in Protect. That is the square that stops next quarter's fire.",
      playful: "Protect is empty. That's the one that keeps next quarter off fire, so.",
    });
  }

  if (slipCounts && counts.protect > 0) {
    const eaten = cells.protect.filter((t) => (slipCounts.get(t.task_id) ?? 0) > 0);
    const moves = eaten.reduce((n, t) => n + (slipCounts.get(t.task_id) ?? 0), 0);
    if (eaten.length > 0) {
      const subject = eaten.length === 1 ? "One Protect task has" : `${eaten.length} Protect tasks have`;
      const times = `${moves} ${moves === 1 ? "time" : "times"}`;
      notes.push({
        quadrant: "protect",
        text: `${subject} been pushed ${times}. It gets eaten first — block the time.`,
        playful: `${subject} been pushed ${times}. Told you it gets eaten first. Put it in the calendar.`,
      });
    }
  }

  // Stated as a share rather than a count: four delegate tasks out of twenty is a Tuesday, four
  // out of six is a job description.
  if (counts.delegate > 0 && triaged >= 3 && counts.delegate * 2 >= triaged) {
    notes.push({
      quadrant: "delegate",
      text: `${counts.delegate} of ${triaged} are urgent but not important — the time leak. Hand it over or make it smaller.`,
      playful: `${counts.delegate} of ${triaged} are other people's urgent. That's the leak — hand it over or shrink it.`,
    });
  }

  if (counts.park > 0) {
    notes.push({
      quadrant: "park",
      text: `${counts.park} in Kill or park. Each needs a stated reason and a named decision, or it should be deleted.`,
      playful: `${counts.park} sitting in Kill or park. Reason and a named decision each, or bin them.`,
    });
  }

  if (unsorted.length > 0) {
    notes.push({
      quadrant: null,
      text: `${unsorted.length} not sorted yet — the matrix can only describe what has been triaged.`,
      playful: `${unsorted.length} still unsorted. The matrix can only tell you about what you've actually triaged.`,
    });
  }

  return { counts, unsorted: unsorted.length, triaged, notes };
}

/**
 * How many times each task has been pushed to a later day, from the reschedule log. Grouped by
 * task_id so a renamed task keeps one tally; slips whose task has since been deleted carry a null
 * id and are dropped rather than collapsed together under a single key.
 */
export function slipCountsByTask(slips: Array<{ task_id: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slip of slips) {
    if (!slip.task_id) continue;
    counts.set(slip.task_id, (counts.get(slip.task_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * A park is only a park when both answers are present, and this is enforced rather than suggested
 * (see assertParkable in work-store.ts). The whole difference between parking something and
 * letting it rot is that one of them was decided out loud. Returns the complaint, or null when it
 * is properly parked.
 */
export function parkComplaint(item: {
  park_reason?: string | null;
  park_decision?: string | null;
}): string | null {
  if (!(item.park_reason ?? "").trim()) return "Parking this needs a stated reason.";
  if (!(item.park_decision ?? "").trim()) {
    return "Parking this needs a named decision — not a date to revisit.";
  }
  return null;
}

// ---------------------------------------------------------------------------- status

export const TASK_STATUSES = ["To Do", "In Progress", "Done", "Waiting", "Deferred"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["High", "Normal", "Low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function statusTone(status: TaskStatus): "neutral" | "warning" | "success" | "danger" {
  if (status === "Done") return "success";
  if (status === "Waiting") return "warning";
  if (status === "Deferred") return "neutral";
  return "neutral";
}

// ---------------------------------------------------------------------------- workday review

/**
 * Why a weekday has no work session. Both mean "do not count this day against me" — they are
 * kept apart because a public holiday and personal leave are different facts about the same
 * empty square, and any later analytics that wants to separate them cannot recover the
 * distinction once it has been collapsed.
 */
export const DAY_TYPES = ["Holiday", "Leave"] as const;
export type DayType = (typeof DAY_TYPES)[number];

export type WorkDayMark = {
  work_date: string;
  day_type: DayType;
  note: string | null;
};

/**
 * What is wrong with a day, if anything. Deterministic — computed from the rows, never guessed.
 *
 *   open        — a session with no end on a day that is no longer today. This is the one that
 *                 prompted the whole feature: an End Work never pressed turns into a session that
 *                 keeps accruing, and yesterday reads 26 hours.
 *   long        — a CLOSED session longer than LONG_SESSION_HOURS. Possible, but far more often
 *                 an end pressed the next morning.
 *   missing     — a past weekday with no session at all and no Holiday/Leave mark. Unknown, not
 *                 zero: it is exactly the day that should be marked one way or the other.
 *
 * A day marked Holiday or Leave is never flagged — marking it IS the answer to the question the
 * flag asks.
 */
export const LONG_SESSION_HOURS = 12;

export type WorkdayFlag = "open" | "long" | "missing";

export type WorkdayRecap = {
  work_date: string;
  sessions: WorkSession[];
  /** Minutes across closed sessions. An open session contributes nothing — its end is unknown. */
  closedMinutes: number;
  /** True when a session on this day has no ended_at. */
  hasOpenSession: boolean;
  mark: WorkDayMark | null;
  flags: WorkdayFlag[];
  isWeekend: boolean;
};

/** Monday-Friday, read off the stored Manila calendar date rather than a Date in local time. */
export function isWeekendIso(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Flags for one day. `today` is passed rather than read from the clock so this stays pure and the
 * server and client cannot disagree about which day is still in progress — an open session TODAY
 * is just work happening, and flagging it would mean the card nags all day, every day.
 */
export function workdayFlags(
  workDate: string,
  sessions: WorkSession[],
  mark: WorkDayMark | null,
  today: string
): WorkdayFlag[] {
  if (mark) return [];
  const flags: WorkdayFlag[] = [];
  const isToday = workDate === today;

  if (!isToday && sessions.some((s) => !s.ended_at)) flags.push("open");

  const tooLong = sessions.some(
    (s) =>
      s.ended_at &&
      (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000 >
        LONG_SESSION_HOURS
  );
  if (tooLong) flags.push("long");

  if (!isToday && sessions.length === 0 && !isWeekendIso(workDate)) flags.push("missing");

  return flags;
}

export const FLAG_MESSAGES: Record<WorkdayFlag, string> = {
  open: "Never ended — this session is still running",
  long: `Longer than ${LONG_SESSION_HOURS} hours — End Work may have been pressed the next day`,
  missing: "Weekday with nothing logged",
};

// ---------------------------------------------------------------------------- projects

export const PROJECT_STATUSES = ["Active", "Paused", "Waiting", "Completed"] as const;
export type WorkProjectStatus = (typeof PROJECT_STATUSES)[number];

// ---------------------------------------------------------------------------- project brief

/**
 * One phase of a project, named by the STATE it ends in rather than by the activity that fills it.
 *
 * "Migration verified on staging" is a state; "do the migration" is a to-do list item with a
 * fortnight of ambiguity inside it. The exit criterion is the second half of the same discipline:
 * one sentence that is either true or not true on a given morning, so a phase can be finished by
 * observation instead of by agreement.
 */
export type ProjectPhase = {
  /**
   * Stable id, minted when the phase is created and stored inside the jsonb alongside it.
   *
   * Tasks point at this rather than at a position, because the ORDER IS THE PLAN and the brief
   * panel lets you reorder it — an index would silently re-file every task the first time a phase
   * moved up. See work_tasks.phase_id.
   */
  id: string;
  /** The state this phase ends in. */
  name: string;
  /** The one thing that has to be true for the phase to be over. */
  exit: string;
};

/** A new phase id. Short, dependency-free, and only ever generated once per phase. */
export function newPhaseId(): string {
  return `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The questions the one-pager asks, in the order it asks them. Kept as data rather than as JSX so
 * the prompts, the helper text and the gap messages all read from one place and cannot drift apart
 * — the rule under each field is the whole value of the form, and a rule that only exists in the
 * markup gets quietly reworded the first time the layout changes.
 */
export const BRIEF_PROMPTS = {
  problem: {
    label: "Problem",
    ask: "What is broken today, with evidence.",
    rule: "Needs a number, or something someone else can confirm.",
  },
  outcome: {
    label: "Outcome",
    ask: "What is true when this is done.",
    rule: "Written from the point of view of whoever benefits.",
  },
  metric: {
    label: "Success metric",
    ask: "Baseline → target → by when.",
    rule: "No baseline? Then measuring it is Phase 1.",
  },
  explicitlyOut: {
    label: "Explicitly out",
    ask: "Two or three things people will assume are included and are not.",
    rule: "The ones that would otherwise be argued about in week three.",
  },
  phases: {
    label: "Phases",
    ask: "Named by the state each one ends in.",
    rule: "One exit criterion apiece.",
  },
  owner: {
    label: "Owner",
    ask: "One name.",
    rule: "Not a team.",
  },
} as const;

/** The minimum that makes "explicitly out" mean anything. One exclusion is an afterthought. */
export const MIN_EXPLICITLY_OUT = 2;

/** The phase the app offers to add for you when a project has no baseline to improve on. */
export const MEASURE_PHASE: Omit<ProjectPhase, "id"> = {
  name: "Baseline measured",
  exit: "A number exists for where this stands today, and someone else can reproduce it.",
};

/**
 * What the brief is still missing, in the order the form asks for it.
 *
 * Returns the gaps rather than a boolean, because "incomplete" on its own is the least useful
 * thing this could say: the card shows exactly which questions have not been answered, and a
 * project you cannot yet answer them for is a finding about the project, not a form error.
 *
 * The baseline is deliberately NOT a gap — a missing baseline is legitimate, and the form turns it
 * into a phase instead of a complaint.
 */
export function briefGaps(project: {
  problem?: string | null;
  outcome?: string | null;
  metric_target?: string | null;
  metric_by_when?: string | null;
  explicitly_out?: string[] | null;
  phases?: ProjectPhase[] | null;
  owner?: string | null;
}): string[] {
  const gaps: string[] = [];
  const filled = (v: string | null | undefined) => Boolean((v ?? "").trim());

  if (!filled(project.problem)) gaps.push("Problem");
  if (!filled(project.outcome)) gaps.push("Outcome");
  if (!filled(project.metric_target) || !filled(project.metric_by_when)) {
    gaps.push("Success metric");
  }
  const out = (project.explicitly_out ?? []).filter((v) => v.trim());
  if (out.length < MIN_EXPLICITLY_OUT) gaps.push("Explicitly out");
  const phases = (project.phases ?? []).filter((p) => p.name.trim() && p.exit.trim());
  if (phases.length === 0) gaps.push("Phases");
  if (!filled(project.owner)) gaps.push("Owner");

  return gaps;
}

/** "12 → 3 by end of Q4", or null when there is not yet a metric to state. */
export function metricLine(project: {
  metric_baseline?: string | null;
  metric_target?: string | null;
  metric_by_when?: string | null;
}): string | null {
  const target = (project.metric_target ?? "").trim();
  if (!target) return null;
  const baseline = (project.metric_baseline ?? "").trim();
  const byWhen = (project.metric_by_when ?? "").trim();
  const head = baseline ? `${baseline} → ${target}` : target;
  return byWhen ? `${head} by ${byWhen}` : head;
}

/**
 * Coerces whatever came back from a jsonb column into the shape the UI expects. jsonb round-trips
 * as `unknown`, and a row written before this column existed arrives as undefined — both have to
 * become an empty array rather than reaching a `.map` as null.
 */
export function toStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((v) => String(v)).filter((v) => v.trim()) : [];
}

export function toPhaseList(raw: unknown): ProjectPhase[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v, i) => {
      const row = (v ?? {}) as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      return {
        // A phase written before ids existed gets a DETERMINISTIC one derived from its position
        // and name — never a fresh random id, which would be minted again on the very next read
        // and break the link to every task pointing at it.
        id: String(row.id ?? "").trim() || `ph-${i}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        name,
        exit: String(row.exit ?? "").trim(),
      };
    })
    .filter((p) => p.name || p.exit);
}

// ---------------------------------------------------------------------------- brief review (AI)

/**
 * An AI pass over one field of the brief.
 *
 * The single rule that shapes this whole feature: the model may make what she wrote CLEARER, and
 * it may not make it TRUER. A problem statement is required to carry evidence — "needs a number,
 * or something someone else can confirm" — and a model asked to improve one will supply a
 * beautifully specific number that came from nowhere. That is not a worse suggestion than a vague
 * one; it is a different and much more dangerous artefact, because the result reads as rigorous
 * and is fiction, and six weeks later nobody remembers which figures were measured.
 *
 * So the shape has three parts, and the third is the important one:
 *
 *   revised — the same claim, said better. No new facts, no new numbers, no new names.
 *   why     — one line on what changed, so a suggestion can be judged rather than just accepted.
 *   asks    — what is MISSING that only she can answer. This is where "you haven't said how long
 *             the wait actually is" goes, instead of the model inventing three days.
 *
 * The prompt states the rule and `stripInventedFigures` enforces it mechanically afterwards —
 * prompts are a request, and this one matters too much to be left as a request.
 */
export type BriefFieldReview = {
  revised: string;
  why: string;
  asks: string[];
};

/** The metric, revised field by field. Same rule: rewording only, never a fabricated figure. */
export type BriefMetricReview = {
  baseline: string;
  target: string;
  by_when: string;
  why: string;
  asks: string[];
};

/**
 * The exclusions. `items` are her own, said more sharply; `suggested` are ones the model thinks
 * people will assume — kept in a SEPARATE field and never merged into `items`, because an
 * exclusion is a scope decision and a scope decision she did not make must not arrive looking
 * like one she did.
 */
export type BriefListReview = {
  items: string[];
  suggested: string[];
  why: string;
  asks: string[];
};

export type BriefReview = {
  problem: BriefFieldReview | null;
  outcome: BriefFieldReview | null;
  metric: BriefMetricReview | null;
  explicitly_out: BriefListReview | null;
  /**
   * Fields whose suggestion was DISCARDED because it introduced a figure that was not in the
   * source. Surfaced rather than swallowed: silently dropping it would leave a field looking as
   * though the model had no opinion, when in fact it had one and it was disqualified.
   */
  discarded: string[];
  model: string | null;
  generatedAt?: string;
  /** True when served from ai_insight_cache — i.e. this answer cost no AI request. */
  fromCache?: boolean;
  /** Set when the review could not run at all. The panel shows this instead of empty suggestions. */
  unavailable?: string;
};

/**
 * Every numeric token in a string: 3, 3.2, 40%, 1,200. Deliberately crude — it only has to be a
 * superset of "things that look like evidence".
 */
function figuresIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\s*%?/g) ?? []).map((f) => f.replace(/[\s,]/g, "").replace(/\.$/, ""));
}

/**
 * True when `revised` contains a figure that `original` does not — i.e. the model invented
 * evidence.
 *
 * Strict on purpose, and the asymmetry is deliberate. A false positive costs one discarded
 * suggestion and says so on screen. A false negative puts a made-up number into a document that
 * exists precisely to hold real ones. Word-to-digit rewrites ("two" -> "2") will trip this; that
 * is the correct side to fail on.
 */
export function inventsFigures(original: string, revised: string): boolean {
  const before = new Set(figuresIn(original));
  return figuresIn(revised).some((f) => !before.has(f));
}

// ---------------------------------------------------------------------------- recurrence

/**
 * Four frequencies, chosen to cover actual personal routines with one line of arithmetic each.
 * A general RRULE engine (BYSETPOS, intervals, exception dates) is a library, and every hour
 * spent on one here is an hour not spent on the board people use every morning.
 */
export const RECUR_FREQS = ["daily", "weekdays", "weekly", "monthly"] as const;
export type RecurFreq = (typeof RECUR_FREQS)[number];

export const RECUR_LABELS: Record<RecurFreq, string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Weekly",
  monthly: "Monthly",
};

export type WorkRecurrence = {
  recurrence_id: string;
  title: string;
  lane: TaskLane;
  priority: TaskPriority;
  project_id: string | null;
  notes: string | null;
  /** Carried onto every instance, so a routine is not re-triaged every single morning. */
  urgent: boolean | null;
  important: boolean | null;
  freq: RecurFreq;
  /** weekly only. 0 = Sunday, matching Date#getUTCDay. */
  byweekday: number | null;
  /** monthly only, 1-31. */
  bymonthday: number | null;
  start_date: string;
  end_date: string | null;
  paused: boolean;
  created_at: string;
  /** Computed by the store, not a column: the next date this rule fires on, or null. */
  nextDate?: string | null;
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Ordinal suffix for a day-of-month, so "Monthly on the 3rd" reads like English. */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** One line describing the rule, e.g. "Every Tuesday" or "Monthly on the 15th". */
export function recurrenceLabel(rule: Pick<WorkRecurrence, "freq" | "byweekday" | "bymonthday">): string {
  switch (rule.freq) {
    case "weekly":
      return rule.byweekday === null || rule.byweekday === undefined
        ? "Weekly"
        : `Every ${WEEKDAY_NAMES[rule.byweekday]}`;
    case "monthly":
      return rule.bymonthday ? `Monthly on the ${ordinal(rule.bymonthday)}` : "Monthly";
    default:
      return RECUR_LABELS[rule.freq];
  }
}

/** Does this rule fire on this specific day? The one place the frequency semantics live. */
export function firesOn(
  rule: Pick<WorkRecurrence, "freq" | "byweekday" | "bymonthday" | "start_date" | "end_date">,
  iso: string
): boolean {
  if (iso < rule.start_date) return false;
  if (rule.end_date && iso > rule.end_date) return false;
  switch (rule.freq) {
    case "daily":
      return true;
    case "weekdays": {
      const dow = isoDayOfWeek(iso);
      return dow >= 1 && dow <= 5;
    }
    case "weekly":
      // Falls back to the start date's weekday, so a rule stored without byweekday still behaves.
      return isoDayOfWeek(iso) === (rule.byweekday ?? isoDayOfWeek(rule.start_date));
    case "monthly": {
      const day = Number(iso.slice(8, 10));
      // No clamping: a month with no 31st simply doesn't fire. See the note in my-work.sql.
      return day === (rule.bymonthday ?? Number(rule.start_date.slice(8, 10)));
    }
    default:
      return false;
  }
}

/**
 * Every date in [from, to] (inclusive) the rule fires on. Bounded by construction — callers pass a
 * horizon of days, not "forever" — so a daily rule can't be asked to enumerate a decade.
 */
export function occurrencesBetween(
  rule: Pick<WorkRecurrence, "freq" | "byweekday" | "bymonthday" | "start_date" | "end_date">,
  from: string,
  to: string
): string[] {
  const dates: string[] = [];
  let cursor = from < rule.start_date ? rule.start_date : from;
  // Guard rather than trust: a malformed range must return nothing, not spin.
  for (let i = 0; i < 400 && cursor <= to; i++) {
    if (firesOn(rule, cursor)) dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return dates;
}

/** The first day on or after `from` that the rule fires, within a year. Null if it never does. */
export function nextOccurrence(
  rule: Pick<WorkRecurrence, "freq" | "byweekday" | "bymonthday" | "start_date" | "end_date">,
  from: string
): string | null {
  let cursor = from < rule.start_date ? rule.start_date : from;
  for (let i = 0; i < 400; i++) {
    if (rule.end_date && cursor > rule.end_date) return null;
    if (firesOn(rule, cursor)) return cursor;
    cursor = addIsoDays(cursor, 1);
  }
  return null;
}

// ---------------------------------------------------------------------------- check-in

/**
 * Mood options. `code` is what's stored — never the label or the emoji, so the wording can be
 * retuned later without orphaning historical data.
 *
 * `weight` is a rough ordering (5 = best) used only for trend arithmetic in Work Mirror. It is
 * NOT shown to the user; presenting a mood as a score invites optimising the number instead of
 * answering honestly.
 */
export const MOODS = [
  { code: "good", label: "Good", emoji: "😌", weight: 5 },
  { code: "fine", label: "Fine", emoji: "🙂", weight: 4 },
  { code: "meh", label: "Meh", emoji: "😐", weight: 3 },
  { code: "overwhelmed", label: "Overwhelmed", emoji: "😵‍💫", weight: 2 },
  { code: "done_with_today", label: "Done with today", emoji: "😡", weight: 1 },
  { code: "perished", label: "I have perished", emoji: "😭", weight: 0 },
] as const;

export type MoodCode = (typeof MOODS)[number]["code"];

export function moodByCode(code: string) {
  return MOODS.find((m) => m.code === code);
}

/** What shaped the day. Quick-select, multi-select, all optional. */
export const DAY_FACTORS = [
  { code: "interruptions", label: "Too many interruptions" },
  { code: "new_requests", label: "Too many new requests" },
  { code: "meetings", label: "Too many meetings" },
  { code: "incidents", label: "Incidents" },
  { code: "project_work", label: "Project work" },
  { code: "team_issues", label: "Team issues" },
  { code: "couldnt_focus", label: "Couldn't focus" },
  { code: "got_a_lot_done", label: "Got a lot done" },
  { code: "felt_productive", label: "Felt productive" },
  { code: "waiting_on_others", label: "Waiting on others" },
  { code: "other", label: "Other" },
] as const;

export type DayFactorCode = (typeof DAY_FACTORS)[number]["code"];

export function factorLabel(code: string): string {
  return DAY_FACTORS.find((f) => f.code === code)?.label ?? code;
}

// ---------------------------------------------------------------------------- rescheduling

/**
 * Why a task slipped to a later day. Codes are stored, labels are not — same rule as MOODS and
 * DAY_FACTORS, so the wording can be retuned without orphaning history.
 *
 * The list is deliberately short and deliberately blame-free. "Ran out of time" and "meetings ate
 * the day" are facts about a day; a vocabulary that only offered variations of "didn't get to it"
 * would collect nothing but self-criticism, and Work Mirror's whole premise is that the system is
 * what's being examined, not the person. These are the reasons a day actually goes sideways.
 */
export const RESCHEDULE_REASONS = [
  { code: "ran_out_of_time", label: "Ran out of time" },
  { code: "urgent_came_up", label: "Something urgent came up" },
  { code: "meetings", label: "Meetings ate the day" },
  { code: "blocked", label: "Blocked on someone else" },
  { code: "not_ready", label: "Not ready to start yet" },
  { code: "no_energy", label: "Didn't have the energy" },
  { code: "can_wait", label: "Decided it can wait" },
  { code: "other", label: "Other" },
] as const;

export type RescheduleReasonCode = (typeof RESCHEDULE_REASONS)[number]["code"];

export function rescheduleReasonLabel(code: string): string {
  return RESCHEDULE_REASONS.find((r) => r.code === code)?.label ?? code;
}

/**
 * One logged slip. `reason` is null between the move and the moment a reason is (optionally)
 * given — see the note in my-work.sql on why the two are separate steps.
 */
export type WorkTaskReschedule = {
  reschedule_id: string;
  task_id: string | null;
  task_title: string;
  from_date: string;
  to_date: string;
  reason: string | null;
  note: string | null;
  created_at: string;
};

/**
 * The first Monday-Friday strictly after `iso`.
 *
 * Weekends only. Public holidays are NOT skipped: the marks that would answer that
 * (work_day_marks) are recorded for days that have already happened, so there is nothing to read
 * for a day in the future, and guessing at a holiday calendar would move tasks to days the person
 * never chose. A holiday landing on the target day is one visible click to move again.
 */
export function nextWorkingDay(iso: string): string {
  let cursor = addIsoDays(iso, 1);
  // Bounded rather than `while (true)` — at most two weekend days can ever be in the way.
  for (let i = 0; i < 7 && isWeekendIso(cursor); i++) cursor = addIsoDays(cursor, 1);
  return cursor;
}

/**
 * Where the one-click push sends a task.
 *
 * Anchored to today when the task is already overdue. Pushing Friday-last-week's unfinished task
 * "to the next working day" and landing it on Monday-last-week would be arithmetically correct and
 * completely useless — the task would still be overdue, and the button would look broken.
 */
export function pushTargetDate(workDate: string, today: string): string {
  return nextWorkingDay(workDate < today ? today : workDate);
}

// ---------------------------------------------------------------------------- records

export type WorkSession = {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  work_date: string;
};

export type WorkTask = {
  task_id: string;
  /** Set when this task was materialised from a recurrence rule. Null for one-offs. */
  recurrence_id: string | null;
  title: string;
  lane: TaskLane;
  status: TaskStatus;
  priority: TaskPriority;
  project_id: string | null;
  notes: string | null;
  work_date: string;
  started_at: string | null;
  completed_at: string | null;
  deferred_at: string | null;
  /**
   * The two Eisenhower axes. Null means UNSORTED, not "neither" — see the eisenhower section
   * above. Rows written before the migration carry no column at all, so the store normalises
   * them to null rather than leaving undefined to slip past every `=== null` check.
   */
  urgent: boolean | null;
  important: boolean | null;
  /** Why it is parked, and the decision that ends the park. Both set together, or neither. */
  park_reason: string | null;
  park_decision: string | null;
  parked_at: string | null;
  /**
   * Which phase of its project this advances, or null. Points at ProjectPhase.id, never at a
   * position — see the note there. An id that no longer resolves (its phase was deleted from the
   * brief) reads as unphased, which loses the label and keeps the day's work.
   */
  phase_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkProject = {
  project_id: string;
  name: string;
  status: WorkProjectStatus;
  notes: string | null;
  last_activity_at: string | null;
  /** Same two axes as a task. A personal project sitting in Kill-or-park is the costlier finding. */
  urgent: boolean | null;
  important: boolean | null;
  /**
   * The one-pager. Every field nullable — a project can be captured before it can be articulated —
   * but the card names what is still missing (briefGaps) rather than letting the gap be invisible.
   */
  problem: string | null;
  outcome: string | null;
  metric_baseline: string | null;
  metric_target: string | null;
  metric_by_when: string | null;
  explicitly_out: string[];
  phases: ProjectPhase[];
  /** One name. The column is a single text field so the schema itself refuses the committee. */
  owner: string | null;
  /**
   * What a Paused project is required to state. The API refuses to pause without both — a park
   * with no decision attached is not a park, it is a project quietly rotting.
   */
  park_reason: string | null;
  park_decision: string | null;
  parked_at: string | null;
  created_at: string;
  /** Joined in by the store, not a column. */
  openTaskCount?: number;
  /**
   * How this project's OPEN tasks sit across the matrix. Computed by the store, not stored.
   * Exists so the project's own quadrant can be checked against the work rather than trusted —
   * see projectDrift.
   */
  taskQuadrants?: QuadrantTally;
  /** Highest-priority open task, for the "current focus" line on the card. */
  currentFocus?: string | null;
};

export type WorkCheckin = {
  checkin_id: string;
  work_date: string;
  mood: string;
  factors: string[];
  note: string | null;
  updated_at: string;
};

/** One day's rolled-up facts. The unit Work Mirror reasons over. */
export type WorkDayStat = {
  work_date: string;
  /** Minutes between session start and end. Null while a session is still open. */
  durationMinutes: number | null;
  tasksCreated: number;
  tasksCompleted: number;
  tasksDeferred: number;
  incomingCount: number;
  waitingCount: number;
  /** Distinct projects touched — the context-switching proxy. */
  projectsTouched: number;
  /**
   * Tasks that slipped OFF this day to a later one. Counted against the day the work was supposed
   * to happen, not the day it was moved to — "Tuesday sheds four tasks every week" is a fact about
   * Tuesday.
   */
  tasksPushedOut: number;
  /** Reason codes given for those slips, in no particular order. May be shorter than the count. */
  pushReasons: string[];
  mood: string | null;
  moodWeight: number | null;
  factors: string[];
  note: string | null;
};

export type MirrorObservation = {
  /** What the data says. Must be checkable against the numbers. */
  pattern: string;
  /** What it MIGHT mean. Explicitly separated so a correlation isn't dressed up as a cause. */
  interpretation: string | null;
};

export type WorkMirrorResult = {
  observations: MirrorObservation[];
  /** Days of history the observations were drawn from. */
  daysAnalysed: number;
  model: string | null;
  /** Set when there isn't enough history yet — the page shows this instead of empty prose. */
  notEnoughData?: string;
  generatedAt?: string;
  /** True when served from ai_insight_cache — i.e. this answer cost no AI request. */
  fromCache?: boolean;
};

export type MyWorkData = {
  today: string;
  openSession: WorkSession | null;
  todaySessions: WorkSession[];
  tasks: WorkTask[];
  projects: WorkProject[];
  checkin: WorkCheckin | null;
  /** Recent history, newest first — powers the trend strip and Work Mirror. */
  history: WorkDayStat[];
  /**
   * The last few days as editable recaps, newest first — what the workday card reviews and fixes.
   * Separate from `history`, which is a rolled-up statistic per day for Work Mirror; this carries
   * the raw sessions because correcting one means editing the actual row.
   */
  recentDays: WorkdayRecap[];
  /**
   * Open tasks dated AFTER today, oldest date first. Planned work — deliberately kept out of
   * `tasks` so the board still answers exactly one question ("what needs me today?") and a week
   * of planning can't quietly become today's list.
   */
  upcoming: WorkTask[];
  /**
   * The recurrence rules themselves, for the Repeating list. Their materialised instances arrive
   * as ordinary tasks in the collections above — this is only the schedule.
   */
  recurrences: WorkRecurrence[];
  /** False when work_recurrences hasn't been created yet, so the UI can explain instead of break. */
  recurrencesReady: boolean;
  /**
   * Logged slips within the history window, newest first. Feeds the day rollups above and, through
   * them, Work Mirror. Empty (not an error) when the migration hasn't been run.
   */
  reschedules: WorkTaskReschedule[];
  /**
   * Open tasks dated BEFORE today, oldest first. Yesterday's unfinished work doesn't roll over on
   * its own — nothing should silently reassign itself to today — so it surfaces here to be pulled
   * forward or rescheduled on purpose.
   */
  overdue: WorkTask[];
  /**
   * Done or deferred tasks dated BEFORE today, within the history window — the ones a finished or
   * parked task quietly falls out of everywhere else on the page (the board only keeps a day's
   * settled work for the day it happened, and `overdue` is open-only by definition). Newest first,
   * the same convention as `history`. This is the only source for "what did I actually do" once
   * the day it happened has passed.
   */
  pastCompleted: WorkTask[];
  /** True when the Supabase tables haven't been created yet, so the page can explain rather than break. */
  needsSetup?: boolean;
};

// ---------------------------------------------------------------------------- project ↔ task

/**
 * How a project's open tasks actually sit across the matrix.
 *
 * The point of counting them is the comparison, not the count: a project's own quadrant is a
 * CLAIM about what kind of work it is, and its tasks are the EVIDENCE. Nothing else on this page
 * can tell you the two have come apart.
 */
export type QuadrantTally = Record<Quadrant, number> & { unsorted: number; total: number };

export function tallyQuadrants(items: Array<Partial<Triage>>): QuadrantTally {
  const { cells, unsorted } = groupByQuadrant(items);
  const tally = Object.fromEntries(QUADRANTS.map((q) => [q, cells[q].length])) as Record<
    Quadrant,
    number
  >;
  return { ...tally, unsorted: unsorted.length, total: items.length };
}

/**
 * The finding this whole pairing exists for: the project says one thing and the work says another.
 *
 * Only raised when the evidence is strong enough to mean something — at least two triaged tasks,
 * and a clear majority of them in a square that is not the project's own. One Drive task on a
 * Protect project is a Tuesday; four of five is a project that has quietly become firefighting and
 * nobody announced it.
 *
 * Returns both registers, same rule as matrixReadout: identical figures, different framing.
 */
export function projectDrift(
  project: Partial<Triage>,
  tally: QuadrantTally
): { quadrant: Quadrant; text: string; playful: string } | null {
  const claimed = quadrantOf(project);
  if (!claimed) return null;
  const triaged = tally.total - tally.unsorted;
  if (triaged < 2) return null;

  // The square the work is actually in, if one dominates.
  const dominant = QUADRANT_ORDER.reduce((best, q) => (tally[q] > tally[best] ? q : best), QUADRANT_ORDER[0]);
  if (dominant === claimed) return null;
  if (tally[dominant] * 2 <= triaged) return null;

  const claim = QUADRANT_META[claimed].verb;
  const actual = QUADRANT_META[dominant].verb;
  const share = `${tally[dominant]} of ${triaged}`;

  // Protect -> Drive is the one worth naming outright; it is the specific failure the Protect
  // square exists to prevent, and "drifted" undersells it.
  if (claimed === "protect" && dominant === "drive") {
    return {
      quadrant: "drive",
      text: `Classed Protect, but ${share} open tasks are Drive. This has become firefighting.`,
      playful: `You called this Protect. ${share} of its tasks are Drive. It's firefighting now.`,
    };
  }

  return {
    quadrant: dominant,
    text: `Classed ${claim}, but ${share} open tasks are ${actual}.`,
    playful: `Says ${claim} on the tin. ${share} of the actual work is ${actual}.`,
  };
}

/**
 * Which phase a project is in, judged by its tasks rather than declared.
 *
 * A phase you have to mark as finished is a phase that stays open forever, so this is derived:
 * the first phase with open work is the current one; failing that, the first phase nothing has
 * been done against yet. It is a reading of the board, and it is wrong in exactly the way the
 * board is wrong, which is the honest failure mode.
 */
export function currentPhaseFor(
  project: { phases: ProjectPhase[] },
  tasks: WorkTask[]
): { phase: ProjectPhase; index: number; open: number; done: number } | null {
  if (project.phases.length === 0) return null;

  const counts = project.phases.map((phase) => {
    const mine = tasks.filter((t) => t.phase_id === phase.id);
    return { open: mine.filter(isOpen).length, done: mine.length - mine.filter(isOpen).length };
  });

  let index = counts.findIndex((c) => c.open > 0);
  if (index === -1) index = counts.findIndex((c) => c.open === 0 && c.done === 0);
  if (index === -1) index = project.phases.length - 1;

  return { phase: project.phases[index], index, open: counts[index].open, done: counts[index].done };
}

/**
 * Projects that are nominally Active and have no open task anywhere — today, ahead or overdue.
 *
 * This is the specific way a personal project dies: not abandoned, not parked, just never on a
 * board. It keeps a status of Active and a well-written brief and nothing happens to it for a
 * quarter. Parked projects are excluded — a park is a decision, and nagging about one is nagging
 * about a choice already made out loud.
 */
export function stalledProjects(projects: WorkProject[]): WorkProject[] {
  return projects.filter((p) => p.status === "Active" && (p.openTaskCount ?? 0) === 0);
}

/** The readout lines about projects, to sit alongside the task ones. Same two-register shape. */
export function projectReadout(
  projects: WorkProject[]
): Array<{ quadrant: Quadrant | null; text: string; playful: string }> {
  const notes: Array<{ quadrant: Quadrant | null; text: string; playful: string }> = [];

  const stalled = stalledProjects(projects);
  if (stalled.length > 0) {
    const names = stalled.slice(0, 3).map((p) => p.name).join(", ");
    const more = stalled.length > 3 ? ` and ${stalled.length - 3} more` : "";
    notes.push({
      quadrant: null,
      text: `${stalled.length === 1 ? "One active project has" : `${stalled.length} active projects have`} no task anywhere: ${names}${more}. Active with nothing on a board is how a project quietly stops.`,
      playful: `Nothing on any board for: ${names}${more}. Still marked Active, though. That's how they die.`,
    });
  }

  for (const project of projects) {
    if (!project.taskQuadrants) continue;
    const drift = projectDrift(project, project.taskQuadrants);
    if (drift) {
      notes.push({
        quadrant: drift.quadrant,
        text: `${project.name}: ${drift.text}`,
        playful: `${project.name}: ${drift.playful}`,
      });
    }
  }

  // Bounded: this strip is a glance, and six lines of it is a report nobody reads.
  return notes.slice(0, 4);
}

// ---------------------------------------------------------------------------- dates

/**
 * `work_date` is a plain 'yyyy-MM-dd' Manila calendar day, so all the date arithmetic below is
 * string-in/string-out and anchored to UTC midnight. Never `new Date("2026-08-21")` + local
 * getters: on a machine west of UTC that reads back as the 20th, which would put a task on the
 * wrong day for the one user in Manila who is the entire audience for this page.
 */
export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

/** 0 = Sunday, matching Date#getUTCDay. */
export function isoDayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday strictly after `today` — the "deal with it next week" shortcut in the date picker. */
export function nextMondayIso(today: string): string {
  return addIsoDays(today, ((8 - isoDayOfWeek(today)) % 7) || 7);
}

/** "Fri 22 Aug", or "Fri 22 Aug 2027" once the year stops being obvious. */
export function formatIsoDay(iso: string, today?: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const showYear = today ? today.slice(0, 4) !== iso.slice(0, 4) : false;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(showYear ? { year: "numeric" } : {}),
  });
}

/** Human label for a day heading: the three days either side get names, the rest get dates. */
export function dayLabel(iso: string, today: string): string {
  const diff = isoDateDiffDays(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return formatIsoDay(iso, today);
}

/** "in 4 days" / "3 days ago" — the secondary half of a day heading. Empty for today. */
export function dayDistance(iso: string, today: string): string {
  const diff = isoDateDiffDays(today, iso);
  if (diff === 0) return "";
  const n = Math.abs(diff);
  const unit = n === 1 ? "day" : "days";
  return diff > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** Buckets tasks by `work_date`, ascending — the shape the Upcoming panel renders. */
export function groupTasksByDay(tasks: WorkTask[]): Array<{ date: string; tasks: WorkTask[] }> {
  const byDate = new Map<string, WorkTask[]>();
  for (const task of tasks) {
    const bucket = byDate.get(task.work_date);
    if (bucket) bucket.push(task);
    else byDate.set(task.work_date, [task]);
  }
  const byPriority = { High: 0, Normal: 1, Low: 2 } as const;
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, group]) => ({
      date,
      tasks: group.sort(
        (a, b) =>
          byPriority[a.priority] - byPriority[b.priority] || a.created_at.localeCompare(b.created_at)
      ),
    }));
}

// ---------------------------------------------------------------------------- helpers

/** "8:47 AM" in Manila, for the workday banner. */
export function formatManilaTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "6h 12m" — elapsed/duration for the workday banner and history rows. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** A task counts as open unless it's finished or explicitly parked. */
export function isOpen(task: WorkTask): boolean {
  return task.status !== "Done" && task.status !== "Deferred";
}

/**
 * Grouping for the board. Done and Deferred tasks leave their lane entirely and collect at the
 * bottom — a completed item sitting in Focus is visual debt, and the point of the page is to
 * answer "what needs me now" at a glance.
 */
export function groupTasks(tasks: WorkTask[]) {
  const lanes = Object.fromEntries(TASK_LANES.map((l) => [l, [] as WorkTask[]])) as Record<
    TaskLane,
    WorkTask[]
  >;
  const settled: WorkTask[] = [];

  for (const task of tasks) {
    if (task.status === "Done" || task.status === "Deferred") settled.push(task);
    else lanes[task.lane].push(task);
  }

  const byPriority = { High: 0, Normal: 1, Low: 2 } as const;
  for (const lane of TASK_LANES) {
    lanes[lane].sort(
      (a, b) =>
        byPriority[a.priority] - byPriority[b.priority] ||
        a.created_at.localeCompare(b.created_at)
    );
  }
  // Most recently settled first — the day's progress reads top-down.
  settled.sort((a, b) =>
    String(b.completed_at ?? b.deferred_at ?? b.updated_at).localeCompare(
      String(a.completed_at ?? a.deferred_at ?? a.updated_at)
    )
  );

  return { lanes, settled };
}
