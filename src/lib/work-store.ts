import { getSupabaseClient } from "@/lib/supabase";
import { toManilaDateString } from "@/lib/manila-date";
import {
  type MyWorkData,
  type WorkCheckin,
  type WorkDayStat,
  type WorkProject,
  type WorkRecurrence,
  type WorkSession,
  type WorkDayMark,
  type WorkTaskReschedule,
  type WorkdayRecap,
  workdayFlags,
  isWeekendIso,
  type DayType,
  type WorkTask,
  addIsoDays,
  isoDayOfWeek,
  moodByCode,
  nextOccurrence,
  occurrencesBetween,
  parkComplaint,
  tallyQuadrants,
  toPhaseList,
  toStringList,
} from "@/lib/work";

/**
 * Server-only data access for My Work. Every function takes the caller's email — the route
 * handlers get it from the NextAuth session and never accept it from the client, so one person's
 * board can't be read or written by passing someone else's address.
 */

/** How much history the page loads. Enough for Work Mirror to see a fortnight-plus of pattern. */
const HISTORY_DAYS = 30;

/**
 * How many days back the workday card offers for review and correction.
 *
 * Seven, not the "2-3" originally asked for, because the flag that matters most — a weekday with
 * nothing logged — only makes sense against a full week: on a Monday, three days back is Friday,
 * Saturday and Sunday, and two of those are weekends that can never be flagged. A week always
 * contains five weekdays no matter which day you look on.
 */
const REVIEW_DAYS = 7;

/**
 * How far ahead the Upcoming panel looks. Planning is for the next couple of weeks, not the next
 * quarter — and a bound keeps one over-enthusiastic planning session from making every page load
 * fetch a year of rows. Tasks dated beyond it still exist and still arrive as the date approaches.
 */
const PLANNING_DAYS = 60;

/**
 * How far ahead recurring instances are created. Two weeks: far enough that Ahead shows the shape
 * of the routine, short enough that editing a rule doesn't mean rewriting a month of rows.
 *
 * Materialising a bounded window rather than "everything up to end_date" is also what keeps a
 * daily open-ended rule from inserting ten thousand rows the first time it's saved.
 */
const MATERIALISE_DAYS = 14;

/**
 * A recurring instance older than this is swept to Deferred instead of being left open.
 *
 * Without it, every skipped daily habit accumulates in "Still open from earlier" forever, and the
 * one section on the page that is supposed to be a short actionable list becomes a monument to
 * every morning you didn't do your stretches. Yesterday is exempt — a routine missed yesterday is
 * genuinely worth seeing — so the sweep only touches instances older than that, and only ones
 * never opened (still To Do, never started). Deferred keeps the row, so the history stays true.
 */
const LAPSE_AFTER_DAYS = 1;

/** Today's Manila calendar date. Server-computed so the day boundary never depends on the client. */
export function manilaToday(): string {
  return toManilaDateString(new Date().toISOString())!;
}

function isoDaysAgo(days: number): string {
  return toManilaDateString(new Date(Date.now() - days * 86400000).toISOString())!;
}

function isoDaysAhead(days: number): string {
  return toManilaDateString(new Date(Date.now() + days * 86400000).toISOString())!;
}

/**
 * True when the failure is "the tables don't exist yet" rather than a real error. Detected
 * so the page can show a one-line setup instruction instead of a stack trace — the tables need a
 * manual SQL run (supabase/my-work.sql), and until then this is the expected state, not a bug.
 *
 * Two shapes, because the error can come from either layer and they look nothing alike:
 *   PGRST205 — PostgREST resolving the name against its schema cache. This is what the JS client
 *              actually returns ("Could not find the table 'public.work_tasks' in the schema
 *              cache"), and it's the one that matters in practice.
 *   42P01    — Postgres' own undefined_table, which surfaces through RPC or raw SQL paths.
 * Matching only the Postgres code (the obvious guess) silently never fires.
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = error.message ?? "";
  return (
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  );
}

/**
 * Same idea one level down: the recurring-tasks migration ADDS a column to an existing table, so
 * between deploying this code and running the SQL, `work_tasks.recurrence_id` doesn't exist yet.
 * Treated as "the feature isn't set up" rather than an error, so the board keeps working.
 */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const message = error.message ?? "";
  return /column .* does not exist/i.test(message) || /could not find the .* column/i.test(message);
}

function recurrenceUnavailable(error: { code?: string; message?: string } | null): boolean {
  return isMissingTable(error) || isMissingColumn(error);
}

// ---------------------------------------------------------------------------- read

export async function getMyWork(email: string): Promise<MyWorkData> {
  const today = manilaToday();
  const since = isoDaysAgo(HISTORY_DAYS);
  const until = isoDaysAhead(PLANNING_DAYS);
  const supabase = getSupabaseClient();

  const [sessionsRes, tasksRes, projectsRes, checkinsRes, recurrencesRes, dayMarksRes, reschedulesRes] = await Promise.all([
    supabase
      .from("work_sessions")
      .select("session_id,started_at,ended_at,work_date")
      .eq("user_email", email)
      .gte("work_date", since)
      .order("started_at", { ascending: false }),
    // `*` rather than a column list, deliberately: recurrence_id arrives with a migration that
    // may not have been run yet, and a named column that doesn't exist fails the whole query,
    // taking the board down with it. A star select just doesn't include it.
    supabase
      .from("work_tasks")
      .select("*")
      .eq("user_email", email)
      .gte("work_date", since)
      .lte("work_date", until)
      .order("created_at", { ascending: true }),
    // `*` for the same reason as work_tasks above: urgent/important and the park columns arrive
    // with a migration that may not have been run yet, and naming a column that does not exist
    // fails the whole query and takes the Projects panel down with it.
    supabase
      .from("work_projects")
      .select("*")
      .eq("user_email", email)
      .order("created_at", { ascending: true }),
    supabase
      .from("work_checkins")
      .select("checkin_id,work_date,mood,factors_json,note,updated_at")
      .eq("user_email", email)
      .gte("work_date", since)
      .order("work_date", { ascending: false }),
    supabase
      .from("work_recurrences")
      .select("*")
      .eq("user_email", email)
      .order("created_at", { ascending: true }),
    // Last, and tolerated when absent: work_day_marks arrives with a migration that may not have
    // been run yet. Same reasoning as recurrences — a named table that doesn't exist fails only
    // its own query here, and the board still renders without the review flags.
    supabase
      .from("work_day_marks")
      .select("work_date,day_type,note")
      .eq("user_email", email)
      .gte("work_date", since),
    // Same tolerance again: work_task_reschedules is the newest migration of the lot. Its absence
    // costs the slip statistics and nothing else.
    supabase
      .from("work_task_reschedules")
      .select("reschedule_id,task_id,task_title,from_date,to_date,reason,note,created_at")
      .eq("user_email", email)
      .gte("from_date", since)
      .order("created_at", { ascending: false }),
  ]);

  // Any one of these failing with "no such table" means the migration hasn't been run.
  for (const res of [sessionsRes, tasksRes, projectsRes, checkinsRes]) {
    if (isMissingTable(res.error)) {
      return {
        today,
        openSession: null,
        todaySessions: [],
        tasks: [],
        projects: [],
        checkin: null,
        history: [],
        recentDays: [],
        upcoming: [],
        overdue: [],
        pastCompleted: [],
        recurrences: [],
        recurrencesReady: false,
        reschedules: [],
        needsSetup: true,
      };
    }
    if (res.error) throw new Error(`My Work query failed: ${res.error.message}`);
  }

  const sessions = (sessionsRes.data ?? []) as WorkSession[];
  // recurrence_id is normalised to null rather than left undefined: pre-migration rows don't carry
  // the column at all, and `undefined` would slip past every `x === null` check downstream.
  // urgent/important get the same treatment for the same reason, and the distinction matters more
  // here than it did for recurrence_id: null is a MEANING ("not sorted yet"), so a pre-migration
  // row has to arrive as null rather than as undefined, which quadrantOf would read identically
  // but every `x === null` check downstream would not.
  let allTasks = ((tasksRes.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => normaliseTask(row)
  );
  const checkins = ((checkinsRes.data ?? []) as Array<Record<string, unknown>>).map(toCheckin);

  // Recurrence is a later migration than the rest of this page, so its absence is a state, not a
  // failure: the rules list stays empty, nothing is materialised, and the UI says one line about it.
  const recurrencesReady = !recurrenceUnavailable(recurrencesRes.error);
  const rules = recurrencesReady ? ((recurrencesRes.data ?? []) as WorkRecurrence[]) : [];

  if (recurrencesReady && rules.length > 0) {
    // Both passes are independent, so they overlap rather than queue. Neither runs at all on a
    // page load where nothing is due, which is most of them.
    const [created, lapsed] = await Promise.all([
      materialiseRecurrences(email, today, rules, allTasks),
      sweepLapsedRecurring(email, today, allTasks),
    ]);
    if (created.length > 0) allTasks = allTasks.concat(created);
    if (lapsed.size > 0) {
      const now = new Date().toISOString();
      allTasks = allTasks.map((t) =>
        lapsed.has(t.task_id) ? { ...t, status: "Deferred" as const, deferred_at: now } : t
      );
    }
  }

  const projects = (projectsRes.data ?? []).map((p) => {
    const open = allTasks.filter(
      (t) => t.project_id === p.project_id && t.status !== "Done" && t.status !== "Deferred"
    );
    // "Current focus" = the most urgent thing still open, so a card answers "what's next here?"
    const focus =
      open.find((t) => t.lane === "Focus") ??
      open.find((t) => t.priority === "High") ??
      open[0] ??
      null;
    return {
      ...normaliseProject(p as Record<string, unknown>),
      openTaskCount: open.length,
      // The evidence against which the project's own quadrant is a claim. Open tasks only: a
      // project's finished work says what it WAS, and the question here is what it is now.
      taskQuadrants: tallyQuadrants(open),
      currentFocus: focus?.title ?? null,
    } as WorkProject;
  });

  // Three disjoint views of the same rows, split by date so each surface asks one question.
  // Settled tasks are excluded from upcoming/overdue: a task finished ahead of time or explicitly
  // parked is not outstanding work, and listing it would make both sections nag about nothing.
  const openOnly = (t: WorkTask) => t.status !== "Done" && t.status !== "Deferred";

  const dayMarks = isMissingTable(dayMarksRes.error)
    ? []
    : ((dayMarksRes.data ?? []) as WorkDayMark[]);

  const reschedules = isMissingTable(reschedulesRes.error)
    ? []
    : ((reschedulesRes.data ?? []) as WorkTaskReschedule[]);

  return {
    today,
    openSession: sessions.find((s) => !s.ended_at) ?? null,
    recentDays: buildRecentDays(sessions, dayMarks, today),
    todaySessions: sessions.filter((s) => s.work_date === today),
    tasks: allTasks.filter((t) => t.work_date === today),
    projects,
    checkin: checkins.find((c) => c.work_date === today) ?? null,
    // Future rows are withheld from history on purpose — buildHistory derives a day from the rows
    // that mention it, so planned work would materialise as "days" with tasksCreated > 0 and
    // hand Work Mirror a fortnight of imaginary future to find patterns in.
    history: buildHistory(sessions, allTasks.filter((t) => t.work_date <= today), checkins, reschedules, today),
    recurrences: rules.map((r) => ({ ...r, nextDate: nextOccurrence(r, today) })),
    recurrencesReady,
    reschedules,
    upcoming: allTasks
      .filter((t) => t.work_date > today && openOnly(t))
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.created_at.localeCompare(b.created_at)),
    overdue: allTasks
      .filter((t) => t.work_date < today && openOnly(t))
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.created_at.localeCompare(b.created_at)),
    // Newest first, mirroring `history` — the most recent day you actually worked is the one
    // you're most likely checking on.
    pastCompleted: allTasks
      .filter((t) => t.work_date < today && !openOnly(t))
      .sort((a, b) => b.work_date.localeCompare(a.work_date) || a.created_at.localeCompare(b.created_at)),
  };
}

/**
 * Every column added after the first release is optional in the row that comes back, because the
 * migration adding it is run by hand and may not have been. These two put the shape back: absent
 * becomes null, which is a value the rest of the app already understands, rather than undefined,
 * which quietly passes through `=== null` guards and JSON.stringify alike.
 */
function normaliseTask(row: Record<string, unknown>): WorkTask {
  return {
    ...row,
    recurrence_id: (row.recurrence_id as string | null) ?? null,
    urgent: typeof row.urgent === "boolean" ? row.urgent : null,
    important: typeof row.important === "boolean" ? row.important : null,
    park_reason: (row.park_reason as string | null) ?? null,
    park_decision: (row.park_decision as string | null) ?? null,
    parked_at: (row.parked_at as string | null) ?? null,
    phase_id: (row.phase_id as string | null) ?? null,
  } as WorkTask;
}

function normaliseProject(row: Record<string, unknown>): WorkProject {
  return {
    ...row,
    urgent: typeof row.urgent === "boolean" ? row.urgent : null,
    important: typeof row.important === "boolean" ? row.important : null,
    park_reason: (row.park_reason as string | null) ?? null,
    park_decision: (row.park_decision as string | null) ?? null,
    parked_at: (row.parked_at as string | null) ?? null,
    problem: (row.problem as string | null) ?? null,
    outcome: (row.outcome as string | null) ?? null,
    metric_baseline: (row.metric_baseline as string | null) ?? null,
    metric_target: (row.metric_target as string | null) ?? null,
    metric_by_when: (row.metric_by_when as string | null) ?? null,
    // jsonb round-trips as unknown, and a pre-migration row carries no column at all. Both have to
    // become an empty array here rather than reaching a `.map` somewhere in the UI as undefined.
    explicitly_out: toStringList(row.explicitly_out),
    phases: toPhaseList(row.phases),
    owner: (row.owner as string | null) ?? null,
  } as WorkProject;
}

function toCheckin(row: Record<string, unknown>): WorkCheckin {
  const raw = row.factors_json;
  return {
    checkin_id: String(row.checkin_id),
    work_date: String(row.work_date),
    mood: String(row.mood),
    factors: Array.isArray(raw) ? (raw as string[]) : [],
    note: (row.note as string | null) ?? null,
    updated_at: String(row.updated_at),
  };
}

/**
 * Rolls the raw rows into one record per day. Computed here, deterministically, rather than being
 * left to the model — Work Mirror's prompt receives these numbers and is only allowed to describe
 * them, which is what keeps its observations checkable instead of invented.
 *
 * Only days with some evidence (a session, a task, or a check-in) appear; padding out untouched
 * days with zeros would invent "you did nothing on Sunday" as a finding.
 */
function buildHistory(
  sessions: WorkSession[],
  tasks: WorkTask[],
  checkins: WorkCheckin[],
  reschedules: WorkTaskReschedule[],
  today: string
): WorkDayStat[] {
  // Future slips are excluded for the same reason future tasks are: a task moved from next Tuesday
  // to next Wednesday would otherwise mint a "day" out of a plan, and hand Work Mirror a fortnight
  // of imaginary history to find patterns in.
  const slips = reschedules.filter((r) => r.from_date <= today);

  const days = new Set<string>();
  sessions.forEach((s) => days.add(s.work_date));
  tasks.forEach((t) => days.add(t.work_date));
  checkins.forEach((c) => days.add(c.work_date));
  // A day whose tasks all slipped off it has no rows left pointing at it, and it is precisely the
  // day worth seeing. The slip IS the evidence that the day happened.
  slips.forEach((r) => days.add(r.from_date));

  const stats: WorkDayStat[] = [];

  // Array.from rather than iterating the Set directly: the project targets ES5 lib, where
  // for..of over a Set needs downlevelIteration. Not worth changing tsconfig for one loop.
  for (const date of Array.from(days)) {
    const daySessions = sessions.filter((s) => s.work_date === date);
    // Sum every session on the day — a lunch break that ends and restarts a session shouldn't
    // read as a 30-minute workday.
    const closed = daySessions.filter((s) => s.ended_at);
    const durationMinutes = closed.length
      ? closed.reduce(
          (sum, s) =>
            sum + (new Date(s.ended_at as string).getTime() - new Date(s.started_at).getTime()) / 60000,
          0
        )
      : null;

    const dayTasks = tasks.filter((t) => t.work_date === date);
    const completed = dayTasks.filter((t) => t.status === "Done");
    const checkin = checkins.find((c) => c.work_date === date) ?? null;
    const mood = checkin ? moodByCode(checkin.mood) : undefined;
    const daySlips = slips.filter((r) => r.from_date === date);

    stats.push({
      work_date: date,
      durationMinutes: durationMinutes === null ? null : Math.round(durationMinutes),
      tasksCreated: dayTasks.length,
      tasksCompleted: completed.length,
      tasksDeferred: dayTasks.filter((t) => t.status === "Deferred").length,
      incomingCount: dayTasks.filter((t) => t.lane === "Incoming").length,
      waitingCount: dayTasks.filter((t) => t.lane === "Waiting" || t.status === "Waiting").length,
      projectsTouched: new Set(dayTasks.map((t) => t.project_id).filter(Boolean)).size,
      tasksPushedOut: daySlips.length,
      pushReasons: daySlips.map((r) => r.reason).filter(Boolean) as string[],
      mood: checkin?.mood ?? null,
      moodWeight: mood ? mood.weight : null,
      factors: checkin?.factors ?? [],
      note: checkin?.note ?? null,
    });
  }

  return stats.sort((a, b) => b.work_date.localeCompare(a.work_date));
}

// ---------------------------------------------------------------------------- recurrence

/** The fields an instance inherits from its rule. */
function instanceFrom(rule: WorkRecurrence, email: string, work_date: string) {
  return {
    user_email: email,
    recurrence_id: rule.recurrence_id,
    title: rule.title,
    lane: rule.lane,
    priority: rule.priority,
    project_id: rule.project_id,
    notes: rule.notes,
    // The instance is born already sorted. A routine whose quadrant has to be re-picked every
    // morning is a routine whose quadrant never gets picked at all.
    urgent: rule.urgent ?? null,
    important: rule.important ?? null,
    work_date,
  };
}

/**
 * Creates any missing instances for the next MATERIALISE_DAYS days and returns the new rows.
 *
 * `known` is the task list already fetched by getMyWork, whose window is wider than the horizon —
 * so working out what's missing costs zero extra queries, and the whole function is a no-op with
 * no round trip at all on the (overwhelmingly common) load where everything already exists.
 *
 * The insert leans on the unique index over (recurrence_id, work_date): `ignoreDuplicates` makes it
 * `on conflict do nothing`, so two tabs opening the page at the same moment can't both create the
 * same morning's instance. That's the entire concurrency story, no transaction required.
 */
async function materialiseRecurrences(
  email: string,
  today: string,
  rules: WorkRecurrence[],
  known: WorkTask[]
): Promise<WorkTask[]> {
  const horizon = addIsoDays(today, MATERIALISE_DAYS - 1);
  const existing = new Set(
    known.filter((t) => t.recurrence_id).map((t) => `${t.recurrence_id}|${t.work_date}`)
  );

  const rows: ReturnType<typeof instanceFrom>[] = [];
  for (const rule of rules) {
    if (rule.paused) continue;
    for (const date of occurrencesBetween(rule, today, horizon)) {
      if (existing.has(`${rule.recurrence_id}|${date}`)) continue;
      rows.push(instanceFrom(rule, email, date));
    }
  }
  if (rows.length === 0) return [];

  try {
    const { data, error } = await getSupabaseClient()
      .from("work_tasks")
      .upsert(rows, { onConflict: "recurrence_id,work_date", ignoreDuplicates: true })
      .select("*");
    // A failure here must not take down the page: the rules are still listed, today's board is
    // still correct, and the next load tries again.
    if (error) return [];
    return ((data ?? []) as Array<Record<string, unknown>>).map(
      (row) => ({ ...row, recurrence_id: (row.recurrence_id as string | null) ?? null }) as WorkTask
    );
  } catch {
    return [];
  }
}

/** Defers stale untouched instances. Returns the ids it changed, for the in-memory reflection. */
async function sweepLapsedRecurring(
  email: string,
  today: string,
  known: WorkTask[]
): Promise<Set<string>> {
  const cutoff = addIsoDays(today, -LAPSE_AFTER_DAYS);
  const ids = known
    .filter(
      (t) =>
        t.recurrence_id &&
        t.work_date < cutoff &&
        t.status === "To Do" &&
        !t.started_at
    )
    .map((t) => t.task_id);
  if (ids.length === 0) return new Set();

  try {
    const now = new Date().toISOString();
    const { error } = await getSupabaseClient()
      .from("work_tasks")
      .update({ status: "Deferred", deferred_at: now, updated_at: now })
      .in("task_id", ids)
      .eq("user_email", email);
    if (error) return new Set();
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/**
 * Removes instances a rule shouldn't have produced any more — used when a rule is paused, deleted,
 * or rescheduled.
 *
 * Only from today onward, and only ones never opened. A recurring task that was started, finished
 * or deferred is a record of a day, not a pending suggestion, and deleting those to tidy up a
 * schedule change would quietly rewrite history.
 */
async function dropUntouchedInstances(email: string, recurrenceId: string, from: string): Promise<void> {
  try {
    await getSupabaseClient()
      .from("work_tasks")
      .delete()
      .eq("user_email", email)
      .eq("recurrence_id", recurrenceId)
      .gte("work_date", from)
      .eq("status", "To Do")
      .is("started_at", null);
  } catch {
    // Best effort: the rule change itself has already been applied.
  }
}

export async function createRecurrence(
  email: string,
  input: {
    title: string;
    freq: string;
    lane?: string;
    priority?: string;
    project_id?: string | null;
    notes?: string;
    start_date?: string;
    end_date?: string | null;
    byweekday?: number | null;
    bymonthday?: number | null;
    urgent?: boolean | null;
    important?: boolean | null;
  }
): Promise<WorkRecurrence> {
  const supabase = getSupabaseClient();
  const today = manilaToday();
  const start = input.start_date ?? today;

  // Weekly and monthly take their day FROM the start date unless told otherwise. "Weekly, starting
  // Tuesday" means every Tuesday — asking for the weekday a second time in its own control is a
  // question with only one sensible answer.
  const byweekday =
    input.freq === "weekly"
      ? input.byweekday ?? isoDayOfWeek(start)
      : null;
  const bymonthday =
    input.freq === "monthly" ? input.bymonthday ?? Number(start.slice(8, 10)) : null;

  const { data, error } = await supabase
    .from("work_recurrences")
    .insert({
      user_email: email,
      title: input.title.trim(),
      lane: input.lane ?? "Today",
      priority: input.priority ?? "Normal",
      project_id: input.project_id ?? null,
      notes: input.notes ?? null,
      freq: input.freq,
      urgent: input.urgent ?? null,
      important: input.important ?? null,
      byweekday,
      bymonthday,
      start_date: start,
      end_date: input.end_date ?? null,
    })
    .select("*")
    .single();
  if (recurrenceUnavailable(error)) {
    throw new Error("Recurring tasks aren't set up yet — re-run supabase/my-work.sql in the Supabase SQL editor.");
  }
  if (error) throw new Error(`Could not save the repeat: ${error.message}`);

  const rule = data as WorkRecurrence;
  // Materialised immediately so the first instance appears on this same page load rather than on
  // the next one — saving a repeat that visibly does nothing reads as a failure.
  await materialiseRecurrences(email, today, [rule], []);
  return rule;
}

/** Fields a rule change propagates to its future untouched instances. */
const INHERITED = ["title", "lane", "priority", "project_id", "notes", "urgent", "important"] as const;
/** Fields that change WHICH days fire, so existing future instances have to be rebuilt. */
const RESCHEDULING = ["freq", "byweekday", "bymonthday", "start_date", "end_date", "paused"] as const;

export async function updateRecurrence(
  email: string,
  recurrenceId: string,
  patch: Record<string, unknown>
): Promise<WorkRecurrence> {
  const supabase = getSupabaseClient();
  const today = manilaToday();
  const { data, error } = await supabase
    .from("work_recurrences")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("recurrence_id", recurrenceId)
    .eq("user_email", email)
    .select("*")
    .single();
  if (recurrenceUnavailable(error)) {
    throw new Error("Recurring tasks aren't set up yet — re-run supabase/my-work.sql in the Supabase SQL editor.");
  }
  if (error) throw new Error(`Could not update the repeat: ${error.message}`);
  const rule = data as WorkRecurrence;

  const rescheduled = RESCHEDULING.some((k) => k in patch);
  if (rescheduled) {
    // Rebuild rather than reconcile: work out which days differ between two rules and you have
    // written a diffing engine. Dropping the untouched future and re-materialising is the same
    // answer in two lines, and pausing gets its effect immediately instead of in a fortnight.
    await dropUntouchedInstances(email, recurrenceId, today);
    if (!rule.paused) await materialiseRecurrences(email, today, [rule], []);
  } else if (INHERITED.some((k) => k in patch)) {
    const inherited: Record<string, unknown> = {};
    for (const k of INHERITED) if (k in patch) inherited[k] = patch[k];
    try {
      await supabase
        .from("work_tasks")
        .update({ ...inherited, updated_at: new Date().toISOString() })
        .eq("user_email", email)
        .eq("recurrence_id", recurrenceId)
        .gte("work_date", today)
        .eq("status", "To Do")
        .is("started_at", null);
    } catch {
      // The rule is updated; the instances catch up on the next change.
    }
  }
  return rule;
}

/**
 * Deletes a rule. Its future untouched instances go with it; everything it already produced stays
 * as ordinary tasks (the FK is `on delete set null`), because those days actually happened.
 */
export async function deleteRecurrence(email: string, recurrenceId: string): Promise<void> {
  const today = manilaToday();
  await dropUntouchedInstances(email, recurrenceId, today);
  const { error } = await getSupabaseClient()
    .from("work_recurrences")
    .delete()
    .eq("recurrence_id", recurrenceId)
    .eq("user_email", email);
  if (error) throw new Error(`Could not delete the repeat: ${error.message}`);
}

// ---------------------------------------------------------------------------- AI insight cache

/**
 * Stable fingerprint of whatever will be sent to a model. Two identical payloads must produce the
 * same string, so object keys are sorted — otherwise JSON.stringify's insertion order would make
 * unchanged data look "changed" and quietly defeat the cache this exists to drive.
 *
 * Not cryptographic; it only has to detect change. FNV-1a is a few lines and needs no dependency.
 */
export function sourceVersion(payload: unknown): string {
  const canonical = JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k];
          return acc;
        }, {});
    }
    return value;
  });

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${canonical.length.toString(16)}`;
}

type MirrorObservationRow = { pattern: string; interpretation: string | null };

export type CachedMirror = {
  observations: MirrorObservationRow[];
  model: string | null;
  generated_at: string;
};

/**
 * A previously generated insight for this EXACT source version, or null.
 *
 * Swallows its own errors on purpose: a cache miss and a broken cache should behave identically
 * (generate fresh). The one thing this must never do is fail the request.
 */
export async function getCachedMirror(email: string, version: string): Promise<CachedMirror | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("ai_insight_cache")
      .select("content_json,model_used,generated_at")
      .eq("user_email", email)
      .eq("context", "work_mirror")
      .eq("entity_id", "")
      .eq("source_version", version)
      .maybeSingle();
    if (error || !data) return null;
    const content = data.content_json as MirrorObservationRow[] | null;
    if (!Array.isArray(content)) return null;
    return {
      observations: content,
      model: (data.model_used as string | null) ?? null,
      generated_at: String(data.generated_at),
    };
  } catch {
    return null;
  }
}

/**
 * The generic pair, for any context other than Work Mirror.
 *
 * ai_insight_cache was built generic (context + entity_id) precisely so the next AI feature would
 * reuse it instead of adding another cache with its own invalidation bugs — but the only helpers
 * on it were mirror-shaped. These two are the generic ones the table was designed for; the mirror
 * pair stays as it is because it carries a typed row shape of its own.
 *
 * Both swallow their errors, for the same reasons as the mirror pair: a broken cache must behave
 * exactly like a cache miss, and a failed write must not fail the request that already paid for
 * the answer.
 */
export async function getCachedInsight<T>(
  email: string,
  context: string,
  entityId: string,
  version: string
): Promise<{ content: T; model: string | null; generated_at: string } | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("ai_insight_cache")
      .select("content_json,model_used,generated_at")
      .eq("user_email", email)
      .eq("context", context)
      .eq("entity_id", entityId)
      .eq("source_version", version)
      .maybeSingle();
    if (error || !data || data.content_json === null) return null;
    return {
      content: data.content_json as T,
      model: (data.model_used as string | null) ?? null,
      generated_at: String(data.generated_at),
    };
  } catch {
    return null;
  }
}

export async function saveInsight(
  email: string,
  context: string,
  entityId: string,
  version: string,
  content: unknown,
  model: string
): Promise<void> {
  try {
    await getSupabaseClient()
      .from("ai_insight_cache")
      .upsert(
        {
          user_email: email,
          context,
          entity_id: entityId,
          source_version: version,
          content_json: content,
          model_used: model,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_email,context,entity_id,source_version" }
      );
  } catch {
    // Intentionally swallowed — see above.
  }
}

/** Best-effort write — a failed cache write must not fail the analysis just paid for. */
export async function saveMirror(
  email: string,
  version: string,
  observations: MirrorObservationRow[],
  model: string
): Promise<void> {
  try {
    await getSupabaseClient()
      .from("ai_insight_cache")
      .upsert(
        {
          user_email: email,
          context: "work_mirror",
          entity_id: "",
          source_version: version,
          content_json: observations,
          model_used: model,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_email,context,entity_id,source_version" }
      );
  } catch {
    // Intentionally swallowed.
  }
}

// ---------------------------------------------------------------------------- write

/** Shared by every write path so a pre-migration click gets the instruction, not a cache error. */
function assertSetup(error: { code?: string; message?: string } | null): void {
  if (isMissingTable(error)) {
    throw new Error("My Work isn't set up yet — run supabase/my-work.sql in the Supabase SQL editor.");
  }
}

/**
 * The last REVIEW_DAYS calendar days, newest first, whether or not anything was logged on them.
 *
 * Every day is emitted — including the empty ones — which is the opposite of buildHistory, and
 * deliberately so: buildHistory answers "what happened", and padding it with zeros would invent
 * findings for Work Mirror. This answers "what needs fixing", and there the empty weekday IS the
 * finding. A day with no row is the single most likely thing to be wrong.
 */
function buildRecentDays(
  sessions: WorkSession[],
  marks: WorkDayMark[],
  today: string
): WorkdayRecap[] {
  const markByDate = new Map(marks.map((m) => [m.work_date, m]));
  const days: WorkdayRecap[] = [];

  for (let back = 0; back < REVIEW_DAYS; back++) {
    const workDate = isoDaysAgo(back);
    const onDay = sessions
      .filter((s) => s.work_date === workDate)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    const mark = markByDate.get(workDate) ?? null;

    days.push({
      work_date: workDate,
      sessions: onDay,
      // Open sessions contribute zero rather than counting up to now. A forgotten End Work is
      // exactly the case this card exists to fix, and letting it accrue is what produced the
      // 26-hour yesterday in the first place.
      closedMinutes: onDay.reduce(
        (sum, x) =>
          x.ended_at
            ? sum + (new Date(x.ended_at).getTime() - new Date(x.started_at).getTime()) / 60000
            : sum,
        0
      ),
      hasOpenSession: onDay.some((x) => !x.ended_at),
      mark,
      flags: workdayFlags(workDate, onDay, mark, today),
      isWeekend: isWeekendIso(workDate),
    });
  }

  return days;
}

/**
 * Manila calendar day for a timestamp. A session edited to start at 00:30 belongs to that Manila
 * day, not to whatever day it is in UTC — work_date is the grouping key for every duration
 * statistic on this page, so letting it drift by a timezone would silently move hours between days.
 */
function manilaDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/**
 * Edits one session's start and/or end.
 *
 * Rejects an end before its start rather than storing it: every duration downstream is
 * `ended_at - started_at`, and a negative one does not surface as an error, it surfaces as a
 * quietly wrong average weeks later. Passing ended_at: null deliberately re-opens a session.
 */
export async function updateSession(
  email: string,
  sessionId: string,
  patch: { started_at?: string; ended_at?: string | null }
): Promise<WorkSession> {
  const supabase = getSupabaseClient();
  const current = await supabase
    .from("work_sessions")
    .select("session_id,started_at,ended_at,work_date")
    .eq("session_id", sessionId)
    .eq("user_email", email)
    .maybeSingle();
  if (!current.data) throw new Error("That work session no longer exists.");

  const startedAt = patch.started_at ?? (current.data.started_at as string);
  const endedAt = patch.ended_at === undefined ? (current.data.ended_at as string | null) : patch.ended_at;
  if (endedAt && new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
    throw new Error("A workday can't end before it starts.");
  }

  const { data, error } = await supabase
    .from("work_sessions")
    .update({
      started_at: startedAt,
      ended_at: endedAt,
      // Moving the start across midnight moves the day the session belongs to.
      work_date: manilaDateOf(startedAt),
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("user_email", email)
    .select("session_id,started_at,ended_at,work_date")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not update that session: ${error.message}`);
  return data as WorkSession;
}

export async function deleteSession(email: string, sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("work_sessions")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_email", email);
  assertSetup(error);
  if (error) throw new Error(`Could not delete that session: ${error.message}`);
}

/**
 * Adds a session after the fact — the fix for a day that was worked but never started.
 *
 * Always closed: an open session is a live state ("I am working now"), and the partial unique
 * index allows only one of those per person. Backfilling an open one would collide with a genuine
 * in-progress day, so this requires both ends.
 */
export async function createSession(
  email: string,
  input: { started_at: string; ended_at: string }
): Promise<WorkSession> {
  if (new Date(input.ended_at).getTime() < new Date(input.started_at).getTime()) {
    throw new Error("A workday can't end before it starts.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("work_sessions")
    .insert({
      user_email: email,
      started_at: input.started_at,
      ended_at: input.ended_at,
      work_date: manilaDateOf(input.started_at),
    })
    .select("session_id,started_at,ended_at,work_date")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not add that session: ${error.message}`);
  return data as WorkSession;
}

/**
 * Marks a day Holiday or Leave, or clears the mark when dayType is null.
 *
 * Upsert on (user_email, work_date) so re-marking a day corrects it instead of stacking a second
 * row — the unique index would reject the insert anyway, and "you already marked that" is not a
 * useful thing to tell someone who is fixing their own calendar.
 */
export async function setDayMark(
  email: string,
  workDate: string,
  dayType: DayType | null,
  note?: string | null
): Promise<WorkDayMark | null> {
  const supabase = getSupabaseClient();

  if (!dayType) {
    const { error } = await supabase
      .from("work_day_marks")
      .delete()
      .eq("user_email", email)
      .eq("work_date", workDate);
    assertDayMarks(error);
    if (error) throw new Error(`Could not clear that day: ${error.message}`);
    return null;
  }

  const { data, error } = await supabase
    .from("work_day_marks")
    .upsert(
      {
        user_email: email,
        work_date: workDate,
        day_type: dayType,
        note: note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_email,work_date" }
    )
    .select("work_date,day_type,note")
    .single();
  assertDayMarks(error);
  if (error) throw new Error(`Could not mark that day: ${error.message}`);
  return data as WorkDayMark;
}

/** work_day_marks ships after the original my-work.sql, so its absence gets its own instruction. */
function assertDayMarks(error: { code?: string; message?: string } | null): void {
  if (isMissingTable(error)) {
    throw new Error(
      "Marking days as Holiday/Leave needs one more table — re-run supabase/my-work.sql in the Supabase SQL editor. It's idempotent."
    );
  }
}

export async function startWorkday(email: string): Promise<WorkSession> {
  const supabase = getSupabaseClient();
  const today = manilaToday();

  // The partial unique index in my-work.sql is the real guard against double-start; this check
  // just turns the resulting constraint violation into the sensible answer — hand back the
  // session that's already open instead of erroring at someone who clicked twice.
  const existing = await supabase
    .from("work_sessions")
    .select("session_id,started_at,ended_at,work_date")
    .eq("user_email", email)
    .is("ended_at", null)
    .maybeSingle();
  if (existing.data) return existing.data as WorkSession;

  const { data, error } = await supabase
    .from("work_sessions")
    .insert({ user_email: email, work_date: today })
    .select("session_id,started_at,ended_at,work_date")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not start workday: ${error.message}`);
  return data as WorkSession;
}

export async function endWorkday(email: string): Promise<WorkSession | null> {
  const supabase = getSupabaseClient();
  const open = await supabase
    .from("work_sessions")
    .select("session_id")
    .eq("user_email", email)
    .is("ended_at", null)
    .maybeSingle();
  if (!open.data) return null;

  const { data, error } = await supabase
    .from("work_sessions")
    .update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("session_id", open.data.session_id)
    .eq("user_email", email)
    .select("session_id,started_at,ended_at,work_date")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not end workday: ${error.message}`);
  return data as WorkSession;
}

export async function createTask(
  email: string,
  input: {
    title: string;
    lane?: string;
    priority?: string;
    project_id?: string | null;
    notes?: string;
    /** 'yyyy-MM-dd'. Defaults to today; a future date plans the task instead of adding it now. */
    work_date?: string;
    /** Eisenhower axes. Omitted means unsorted, which is a legitimate way to capture something fast. */
    urgent?: boolean | null;
    important?: boolean | null;
    /** Which phase of its project this advances. Points at ProjectPhase.id. */
    phase_id?: string | null;
  }
): Promise<WorkTask> {
  const supabase = getSupabaseClient();

  /**
   * A task on a project starts in the project's square unless it says otherwise.
   *
   * Not a convenience — it is what makes the drift finding mean anything. If every task has to be
   * triaged from scratch, the quadrants scatter for no reason and "this Protect project is being
   * worked in Drive" stops being a signal and becomes an artefact of not bothering. Inheriting
   * makes the DEFAULT agree with the claim, so a divergence is something you actually did.
   *
   * Only when the caller left both axes unset. An explicit answer — including a deliberate
   * "Unsorted" — is never overwritten, and one axis answered alone is left half-answered rather
   * than completed on her behalf.
   */
  let { urgent, important } = { urgent: input.urgent ?? null, important: input.important ?? null };
  if (input.project_id && urgent === null && important === null) {
    const parent = await supabase
      .from("work_projects")
      .select("urgent,important")
      .eq("project_id", input.project_id)
      .eq("user_email", email)
      .maybeSingle();
    const row = parent.data as { urgent?: unknown; important?: unknown } | null;
    if (typeof row?.urgent === "boolean" && typeof row?.important === "boolean") {
      urgent = row.urgent;
      important = row.important;
    }
  }
  const { data, error } = await supabase
    .from("work_tasks")
    .insert({
      user_email: email,
      title: input.title.trim(),
      lane: input.lane ?? "Today",
      priority: input.priority ?? "Normal",
      project_id: input.project_id ?? null,
      notes: input.notes ?? null,
      urgent,
      important,
      phase_id: input.phase_id ?? null,
      work_date: input.work_date ?? manilaToday(),
    })
    .select("*")
    .single();
  assertSetup(error);
  assertTriageColumns(error);
  if (error) throw new Error(`Could not add task: ${error.message}`);
  if (input.project_id) await touchProject(email, input.project_id);
  return normaliseTask(data as Record<string, unknown>);
}

/**
 * Patches a task, deriving the lifecycle stamps from the status transition so callers never have
 * to set them by hand (and so they can't be forgotten, which would silently break the history).
 */
export async function updateTask(
  email: string,
  taskId: string,
  patch: Record<string, unknown>
): Promise<WorkTask> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { ...patch, updated_at: now };

  if (typeof patch.status === "string") {
    // Set on entering the state, cleared on leaving it — so "completed_at" always means "is
    // currently done, since then", and un-ticking a task doesn't leave a false completion stamp
    // behind for the throughput stats to count.
    update.completed_at = patch.status === "Done" ? now : null;
    update.deferred_at = patch.status === "Deferred" ? now : null;
    if (patch.status === "In Progress") update.started_at = now;

    /**
     * Deferred IS parked, at the task level, so the park stamp follows the status rather than
     * being a separate thing to remember. Leaving the state clears the reason and the decision
     * too: a stale "why this was parked" attached to work that is now live reads as current and
     * is the exact kind of half-true record this page is supposed not to keep.
     */
    if (patch.status === "Deferred") {
      update.parked_at = now;
    } else {
      update.parked_at = null;
      update.park_reason = null;
      update.park_decision = null;
    }
  }

  /**
   * The day a task is moving FROM is only knowable before the update — `.select()` returns the new
   * row. One extra read, and only on the one patch shape that needs it: every other field change
   * (status, lane, a note) still costs a single round trip.
   */
  const before =
    typeof patch.work_date === "string"
      ? (
          await supabase
            .from("work_tasks")
            .select("work_date")
            .eq("task_id", taskId)
            .eq("user_email", email)
            .maybeSingle()
        ).data
      : null;

  const { data, error } = await supabase
    .from("work_tasks")
    .update(update)
    .eq("task_id", taskId)
    .eq("user_email", email)
    .select("*")
    .single();
  assertSetup(error);
  assertTriageColumns(error);
  if (error) throw new Error(`Could not update task: ${error.message}`);

  const task = normaliseTask(data as Record<string, unknown>);

  /**
   * Logged here rather than at each call site, so every path that moves a day — the push button,
   * the row's date field, anything added later — records the slip without having to remember to.
   *
   * Strictly LATER only. Pulling a task forward is the opposite act, and counting it among the
   * slips would leave the reason tallies describing two different things at once.
   */
  if (before && typeof patch.work_date === "string" && patch.work_date > String(before.work_date)) {
    await logReschedule(email, taskId, task.title, String(before.work_date), patch.work_date);
  }

  if (task.project_id) await touchProject(email, task.project_id);
  return task;
}

/**
 * Records one slip. Best effort, and silent on failure by design: the move the person asked for
 * has already happened, and failing their click because the analytics write missed would be
 * strictly worse than losing one row of a statistic. The reason strip surfaces the real
 * instruction if the table genuinely isn't there.
 */
async function logReschedule(
  email: string,
  taskId: string,
  title: string,
  fromDate: string,
  toDate: string
): Promise<void> {
  try {
    await getSupabaseClient().from("work_task_reschedules").insert({
      user_email: email,
      task_id: taskId,
      task_title: title,
      from_date: fromDate,
      to_date: toDate,
    });
  } catch {
    // Intentionally swallowed — see above.
  }
}

/**
 * The Eisenhower columns are the newest migration of the lot, and unlike the tables above they are
 * added to tables that already exist — so a page against an un-migrated database READS fine (the
 * star selects simply do not include them) and only fails on the first WRITE. Which makes a bare
 * PostgREST "could not find the column" the single most likely error anyone sees here, and the
 * one least likely to suggest its own fix. This turns it into the instruction.
 */
function assertTriageColumns(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  const message = error.message ?? "";
  if (isMissingColumn(error) && /urgent|important|park_reason|park_decision|parked_at/i.test(message)) {
    throw new Error(
      "The Eisenhower columns aren't there yet — re-run supabase/my-work.sql in the Supabase SQL editor. It's idempotent."
    );
  }
}

/** The brief columns arrive with the same hand-run migration, and fail the same way. */
function assertBriefColumns(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  const message = error.message ?? "";
  const named = /problem|outcome|metric_baseline|metric_target|metric_by_when|explicitly_out|phases|owner/i;
  if (isMissingColumn(error) && named.test(message)) {
    throw new Error(
      "The project brief columns aren't there yet — re-run supabase/my-work.sql in the Supabase SQL editor. It's idempotent."
    );
  }
}

/** work_task_reschedules ships after the rest of my-work.sql, so its absence gets its own line. */
function assertReschedules(error: { code?: string; message?: string } | null): void {
  if (isMissingTable(error)) {
    throw new Error(
      "Reschedule reasons need one more table — re-run supabase/my-work.sql in the Supabase SQL editor. It's idempotent."
    );
  }
}

/**
 * Attaches a reason to the most recent slip of one task.
 *
 * Addressed by task rather than by reschedule id because of when it is called: the strip that asks
 * "why?" is describing the move the person just made, and "the newest one" is exactly what they
 * mean. Threading an id from the PATCH response through the optimistic store to the strip and back
 * would buy nothing but the ability to answer a question nobody is being asked.
 */
export async function setRescheduleReason(
  email: string,
  taskId: string,
  reason: string,
  note?: string | null
): Promise<WorkTaskReschedule> {
  const supabase = getSupabaseClient();
  const latest = await supabase
    .from("work_task_reschedules")
    .select("reschedule_id")
    .eq("user_email", email)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertReschedules(latest.error);
  if (latest.error) throw new Error(`Could not find that move: ${latest.error.message}`);
  if (!latest.data) throw new Error("That move is no longer on record.");

  const { data, error } = await supabase
    .from("work_task_reschedules")
    .update({ reason, note: note ?? null })
    .eq("reschedule_id", latest.data.reschedule_id)
    .eq("user_email", email)
    .select("reschedule_id,task_id,task_title,from_date,to_date,reason,note,created_at")
    .single();
  assertReschedules(error);
  if (error) throw new Error(`Could not save that reason: ${error.message}`);
  return data as WorkTaskReschedule;
}

/**
 * Removes the most recent logged slip for one task — what Undo calls.
 *
 * Undo moves the task back, and that backward move is (correctly) not logged as a slip. If the
 * forward row survived, an undone misclick would still be counted as a day the work slipped, and
 * the reason tallies Work Mirror reads would drift away from what actually happened. Best effort
 * for the same reason logging is: the task is already back where it belongs.
 */
export async function deleteLatestReschedule(email: string, taskId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const latest = await supabase
      .from("work_task_reschedules")
      .select("reschedule_id")
      .eq("user_email", email)
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest.data) return;
    await supabase
      .from("work_task_reschedules")
      .delete()
      .eq("reschedule_id", latest.data.reschedule_id)
      .eq("user_email", email);
  } catch {
    // Intentionally swallowed — see above.
  }
}

/**
 * Duplicates a task onto another day. The original is untouched — that is the whole difference
 * between this and a reschedule, and the reason both exist.
 *
 * The copy starts fresh: status, and every lifecycle stamp with it, comes from the column defaults
 * rather than from the source, so copying a finished task forward gives you the task to do again
 * and not a second record of having done it.
 *
 * recurrence_id is deliberately NOT copied. A copy is a one-off, not another instance of the
 * schedule — and the unique index over (recurrence_id, work_date) would reject a copy onto a day
 * the rule had already fired on, which is exactly the day someone would try to copy it to.
 */
export async function copyTask(email: string, taskId: string, workDate: string): Promise<WorkTask> {
  const supabase = getSupabaseClient();
  const source = await supabase
    .from("work_tasks")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_email", email)
    .maybeSingle();
  assertSetup(source.error);
  if (source.error) throw new Error(`Could not read that task: ${source.error.message}`);
  if (!source.data) throw new Error("That task no longer exists.");

  const row = source.data as Record<string, unknown>;
  const { data, error } = await supabase
    .from("work_tasks")
    .insert({
      user_email: email,
      title: String(row.title),
      lane: String(row.lane),
      priority: String(row.priority),
      project_id: (row.project_id as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      // The triage travels with the copy — it is the same kind of work on another day. The PARK
      // does not: a copy is something you intend to do, and inheriting "parked, because X" would
      // put a fresh task on the board already carrying somebody else's excuse.
      urgent: typeof row.urgent === "boolean" ? row.urgent : null,
      important: typeof row.important === "boolean" ? row.important : null,
      // Same reasoning as the triage: a copy is the same work on another day, so it belongs to
      // the same phase of the same plan.
      phase_id: (row.phase_id as string | null) ?? null,
      work_date: workDate,
    })
    .select("*")
    .single();
  assertSetup(error);
  assertTriageColumns(error);
  if (error) throw new Error(`Could not copy that task: ${error.message}`);

  const task = normaliseTask(data as Record<string, unknown>);
  if (task.project_id) await touchProject(email, task.project_id);
  return task;
}

/**
 * Same patch applied to several tasks in one round trip. Exists for the two bulk moves the
 * planning UI offers — "bring everything overdue to today" and "push this whole day forward" —
 * which as N sequential PATCHes would be N page refreshes and a visibly stuttering list.
 *
 * Deliberately narrower than updateTask: no status-transition stamping, because every caller is
 * rescheduling rather than changing lifecycle state, and quietly stamping completed_at across a
 * batch is the kind of thing that corrupts history without anyone noticing.
 */
export async function updateTasks(
  email: string,
  taskIds: string[],
  patch: Record<string, unknown>
): Promise<WorkTask[]> {
  if (taskIds.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("work_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .in("task_id", taskIds)
    .eq("user_email", email)
    .select("*");
  assertSetup(error);
  if (error) throw new Error(`Could not move tasks: ${error.message}`);
  return (data ?? []).map((row) => normaliseTask(row as Record<string, unknown>));
}

export async function deleteTask(email: string, taskId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("work_tasks")
    .delete()
    .eq("task_id", taskId)
    .eq("user_email", email);
  if (error) throw new Error(`Could not delete task: ${error.message}`);
}

export async function createProject(
  email: string,
  input: {
    name: string;
    status?: string;
    notes?: string;
    urgent?: boolean | null;
    important?: boolean | null;
    /** The one-pager. Every field optional — see BRIEF_COLUMNS. */
    brief?: Record<string, unknown>;
  }
): Promise<WorkProject> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("work_projects")
    .insert({
      user_email: email,
      name: input.name.trim(),
      status: input.status ?? "Active",
      notes: input.notes ?? null,
      urgent: input.urgent ?? null,
      important: input.important ?? null,
      ...(input.brief ?? {}),
      last_activity_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  assertSetup(error);
  assertTriageColumns(error);
  assertBriefColumns(error);
  if (error) throw new Error(`Could not add project: ${error.message}`);
  return normaliseProject(data as Record<string, unknown>);
}

/**
 * A project may only enter Paused with a stated reason AND a named decision — the rule that
 * separates parking something from letting it rot.
 *
 * Enforced in the store rather than in the route so it holds for every caller, and checked against
 * the MERGED row (what is already stored plus what is being written) so re-pausing a project that
 * already carries both does not demand them again. Leaving Paused clears all three columns, for
 * the same reason updateTask clears them: a reason that describes a state you are no longer in is
 * worse than no reason at all.
 *
 * "Not a slipped date" is the part that cannot be enforced by a NOT NULL — a decision is named or
 * it is not, and only a person can tell. What the check does buy is that the question gets asked
 * at the moment of parking, which is the only moment anyone has an honest answer to it.
 */
async function resolveParkFields(
  email: string,
  projectId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const leavingOrStaying = patch.status;
  if (leavingOrStaying === undefined && !("park_reason" in patch) && !("park_decision" in patch)) {
    return;
  }

  const current = await getSupabaseClient()
    .from("work_projects")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_email", email)
    .maybeSingle();
  const row = (current.data ?? {}) as Record<string, unknown>;
  const status = leavingOrStaying === undefined ? String(row.status ?? "") : String(leavingOrStaying);

  if (status !== "Paused") {
    if (String(row.status ?? "") === "Paused") {
      patch.park_reason = null;
      patch.park_decision = null;
      patch.parked_at = null;
    }
    return;
  }

  const merged = {
    park_reason: "park_reason" in patch ? (patch.park_reason as string | null) : (row.park_reason as string | null),
    park_decision:
      "park_decision" in patch ? (patch.park_decision as string | null) : (row.park_decision as string | null),
  };
  const complaint = parkComplaint(merged);
  if (complaint) throw new Error(complaint);
  patch.parked_at = (row.parked_at as string | null) ?? new Date().toISOString();
}

export async function updateProject(
  email: string,
  projectId: string,
  patch: Record<string, unknown>
): Promise<WorkProject> {
  const supabase = getSupabaseClient();
  await resolveParkFields(email, projectId, patch);
  const { data, error } = await supabase
    .from("work_projects")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("user_email", email)
    .select("*")
    .single();
  assertTriageColumns(error);
  assertBriefColumns(error);
  if (error) throw new Error(`Could not update project: ${error.message}`);
  return normaliseProject(data as Record<string, unknown>);
}

/**
 * Deletes a project. Its tasks are NOT deleted with it — work_tasks.project_id is
 * `on delete set null`, so they survive as ungrouped tasks.
 *
 * That is the right behaviour and it is worth being explicit about: the tasks record days that
 * actually happened, and cascading would mean tidying up a project silently rewrote the history of
 * every day it touched. The UI says how many tasks are about to be let loose before it asks.
 */
export async function deleteProject(email: string, projectId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("work_projects")
    .delete()
    .eq("project_id", projectId)
    .eq("user_email", email);
  if (error) throw new Error(`Could not delete project: ${error.message}`);
}

/** Best-effort: a failed activity stamp must never fail the task write that triggered it. */
async function touchProject(email: string, projectId: string): Promise<void> {
  try {
    await getSupabaseClient()
      .from("work_projects")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .eq("user_email", email);
  } catch {
    // Intentionally swallowed.
  }
}

/** Upsert on (user_email, work_date): one mood per day, edited rather than appended. */
export async function saveCheckin(
  email: string,
  input: { mood: string; factors?: string[]; note?: string }
): Promise<WorkCheckin> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("work_checkins")
    .upsert(
      {
        user_email: email,
        work_date: manilaToday(),
        mood: input.mood,
        factors_json: input.factors ?? [],
        note: input.note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_email,work_date" }
    )
    .select("checkin_id,work_date,mood,factors_json,note,updated_at")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not save check-in: ${error.message}`);
  return toCheckin(data as Record<string, unknown>);
}
