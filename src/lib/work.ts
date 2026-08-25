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
export const LANE_META: Record<TaskLane, { label: string; hint: string }> = {
  Focus: { label: "Focus", hint: "The 1–2 things that actually deserve today" },
  Today: { label: "To Do", hint: "Also intending to work on these" },
  Waiting: { label: "Waiting", hint: "Blocked on someone or something else" },
  Incoming: { label: "Incoming", hint: "New requests, not yet triaged" },
};

/** The label to show for a lane. Use this anywhere a lane reaches the screen. */
export function laneLabel(lane: TaskLane): string {
  return LANE_META[lane].label;
}

/**
 * Focus is a commitment, not a bucket — the whole point is that it stays small enough to mean
 * something. Exceeded, the UI says so rather than silently letting it become a second Today list.
 */
export const FOCUS_SOFT_LIMIT = 3;

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
  created_at: string;
  updated_at: string;
};

export type WorkProject = {
  project_id: string;
  name: string;
  status: WorkProjectStatus;
  notes: string | null;
  last_activity_at: string | null;
  created_at: string;
  /** Joined in by the store, not a column. */
  openTaskCount?: number;
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
   * Open tasks dated BEFORE today, oldest first. Yesterday's unfinished work doesn't roll over on
   * its own — nothing should silently reassign itself to today — so it surfaces here to be pulled
   * forward or rescheduled on purpose.
   */
  overdue: WorkTask[];
  /** True when the Supabase tables haven't been created yet, so the page can explain rather than break. */
  needsSetup?: boolean;
};

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
