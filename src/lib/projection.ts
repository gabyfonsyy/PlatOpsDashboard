/**
 * Pure batch-projection math for the initiative/project tracker.
 *
 * Model (confirmed with user): an activity has a fixed total item count; each batch processes
 * a fixed number of items; batches run at a weekly cadence. Bidirectional:
 *   - cadence + batch size -> projected completion date
 *   - target date + batch size -> required weekly cadence
 * No side effects, so this is trivially unit-testable.
 */

/** One per-week override of planned items (e.g. "the week of 2026-07-21 we'll do 500"). */
export type WeeklyOverride = { weekStart: string; items: number };

export type ProjectionInputs = {
  totalItems?: number | string | null;
  batchSize?: number | string | null;
  batchesPerWeek?: number | string | null;
  /** yyyy-MM-dd; defaults to today when omitted. */
  startDate?: string | null;
  /** yyyy-MM-dd; enables the on-track check and required-cadence outputs. */
  targetDate?: string | null;
  /** Optional per-week overrides of planned items; weeks without one use the baseline rate. */
  weeklyPlan?: WeeklyOverride[] | null;
  /** Actual items processed so far (summed from the PROJECT_PROGRESS log). Drives % complete. */
  processedItems?: number | string | null;
  /** Observed actual throughput (items/week) — enables the actual-based completion re-forecast. */
  observedItemsPerWeek?: number | string | null;
};

export type Projection = {
  totalBatches?: number;
  itemsPerWeek?: number;
  /** cadence -> completion */
  weeksNeeded?: number;
  completionDate?: string;
  /** null when there is no target date to compare against. */
  onTrack: boolean | null;
  /** target -> required cadence */
  weeksAvailable?: number;
  requiredBatchesPerWeek?: number;
  requiredItemsPerWeek?: number;
  /** actuals (from processed log) */
  processedItems?: number;
  remainingItems?: number;
  /** 0..100, processed / total, capped. */
  percentComplete?: number;
  /** observed items/week, echoed back when supplied. */
  actualItemsPerWeek?: number;
  actualWeeksNeeded?: number;
  /** actual-throughput -> projected completion date (from today). */
  actualCompletionDate?: string;
  /** null when there is no target date; otherwise whether the actual forecast beats it. */
  actualOnTrack?: boolean | null;
};

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function positiveNumber(v: unknown): number | undefined {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Like positiveNumber but keeps 0 (a project can legitimately have 0 processed so far). */
function nonNegativeNumber(v: unknown): number | undefined {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeProjection(inputs: ProjectionInputs): Projection {
  const total = positiveNumber(inputs.totalItems);
  const batch = positiveNumber(inputs.batchSize);
  const rate = positiveNumber(inputs.batchesPerWeek);
  const start = parseDate(inputs.startDate) ?? startOfToday();
  const target = parseDate(inputs.targetDate);

  const out: Projection = { onTrack: null };

  if (total && batch) out.totalBatches = Math.ceil(total / batch);
  const baselineItemsPerWeek = batch && rate ? batch * rate : undefined;
  if (baselineItemsPerWeek) out.itemsPerWeek = baselineItemsPerWeek;

  // Per-week overrides, bucketed to a week index relative to start (week 0 = the start week).
  const overrideByWeek = new Map<number, number>();
  for (const ov of inputs.weeklyPlan ?? []) {
    const d = parseDate(ov?.weekStart);
    const items = positiveNumber(ov?.items);
    if (!d || items === undefined) continue;
    const wk = Math.floor((d.getTime() - start.getTime()) / MS_PER_WEEK);
    if (wk >= 0) overrideByWeek.set(wk, items);
  }

  // Cadence -> completion date. Walk weeks from the start, taking an override where one exists
  // and the baseline rate otherwise, accumulating until the total is met. Handles both a flat
  // cadence (no overrides) and a variable plan. Capped so a zero-throughput plan can't loop forever.
  if (total && (baselineItemsPerWeek || overrideByWeek.size)) {
    const MAX_WEEKS = 1040; // 20 years — a safety bound, not an expected value
    let cumulative = 0;
    let reachedWeek = -1;
    for (let i = 0; i < MAX_WEEKS; i++) {
      const planned = overrideByWeek.has(i) ? (overrideByWeek.get(i) as number) : (baselineItemsPerWeek ?? 0);
      cumulative += planned;
      if (cumulative >= total) { reachedWeek = i; break; }
    }
    if (reachedWeek >= 0) {
      out.weeksNeeded = reachedWeek + 1;
      const completion = addDays(start, out.weeksNeeded * 7);
      out.completionDate = toISODate(completion);
      if (target) out.onTrack = completion.getTime() <= target.getTime();
    }
  }

  // Target date -> required weekly cadence
  if (out.totalBatches && target) {
    const weeksAvailable = Math.max(1, Math.round((target.getTime() - start.getTime()) / MS_PER_WEEK));
    out.weeksAvailable = weeksAvailable;
    out.requiredBatchesPerWeek = Math.ceil(out.totalBatches / weeksAvailable);
    if (batch) out.requiredItemsPerWeek = out.requiredBatchesPerWeek * batch;
  }

  // Actuals: real progress from the processed log drives % complete and, given an observed
  // throughput, a completion re-forecast measured from today (not the planned cadence).
  const processed = nonNegativeNumber(inputs.processedItems);
  if (processed !== undefined) {
    out.processedItems = processed;
    if (total) {
      out.percentComplete = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
      out.remainingItems = Math.max(0, total - processed);
    }
  }

  const observed = positiveNumber(inputs.observedItemsPerWeek);
  if (observed && out.remainingItems !== undefined) {
    out.actualItemsPerWeek = observed;
    const today = startOfToday();
    if (out.remainingItems === 0) {
      out.actualWeeksNeeded = 0;
      out.actualCompletionDate = toISODate(today);
    } else {
      out.actualWeeksNeeded = Math.ceil(out.remainingItems / observed);
      const completion = addDays(today, out.actualWeeksNeeded * 7);
      out.actualCompletionDate = toISODate(completion);
    }
    if (target && out.actualCompletionDate) {
      out.actualOnTrack = parseDate(out.actualCompletionDate)!.getTime() <= target.getTime();
    }
  }

  return out;
}

/** True when the project carries enough inputs to compute anything at all. */
export function hasProjectionInputs(inputs: ProjectionInputs): boolean {
  return positiveNumber(inputs.totalItems) !== undefined && positiveNumber(inputs.batchSize) !== undefined;
}

export function parseWeeklyPlan(raw: string | null | undefined): WeeklyOverride[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Whole weeks elapsed from a yyyy-MM-dd start to today (0 if missing/invalid/future). */
export function weeksElapsedSince(start?: string | null): number {
  if (!start) return 0;
  const s = new Date(`${start}T00:00:00`).getTime();
  if (Number.isNaN(s)) return 0;
  const weeks = (Date.now() - s) / MS_PER_WEEK;
  return weeks > 0 ? weeks : 0;
}

export type PercentInputs = {
  tracking_mode?: string | null;
  start_date?: string | null;
  total_items?: number | string | null;
  batch_size?: number | string | null;
  batches_per_week?: number | string | null;
  target_date?: string | null;
  weekly_plan_json?: string | null;
  percent_complete?: number | string | null;
};

/** Done/total counts from a project's PROJECT_TASKS checklist. */
export type TaskStats = { total: number; done: number };

function clampPercent(n: number): number {
  return Math.min(Math.max(n, 0), 100);
}

function taskPercent(taskStats?: TaskStats): number {
  return taskStats && taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0;
}

function scheduledPercent(r: PercentInputs, processed?: number): number {
  const hasProcessed = processed !== undefined;
  const elapsed = weeksElapsedSince(r.start_date);
  const observedItemsPerWeek = hasProcessed && elapsed > 0 ? processed! / elapsed : null;
  const proj =
    hasProjectionInputs({ totalItems: r.total_items, batchSize: r.batch_size }) || hasProcessed
      ? computeProjection({
          totalItems: r.total_items,
          batchSize: r.batch_size,
          batchesPerWeek: r.batches_per_week,
          startDate: r.start_date || null,
          targetDate: r.target_date || null,
          weeklyPlan: parseWeeklyPlan(r.weekly_plan_json),
          processedItems: hasProcessed ? processed : null,
          observedItemsPerWeek,
        })
      : null;
  return proj?.percentComplete ?? (Number(r.percent_complete) || 0);
}

/**
 * The single source of truth for "what percent complete is this project" — driven by the
 * project's explicit `tracking_mode` (set on the project form): "tasks" uses the checklist's
 * done/total, "scheduled" uses the batch-throughput projection, "manual" uses the raw stored
 * percent_complete field. Legacy rows saved before tracking_mode existed have it blank, so they
 * fall back to the old auto-detect order (tasks > batch projection > raw field) until next saved
 * through the edit form, which stamps an explicit mode. Shared by ProjectsTable and
 * ProjectsGanttChart so the table and the timeline never disagree.
 */
export function resolveDisplayPercent(r: PercentInputs, processed?: number, taskStats?: TaskStats): number {
  switch (r.tracking_mode) {
    case "tasks":
      return clampPercent(taskPercent(taskStats));
    case "scheduled":
      return clampPercent(scheduledPercent(r, processed));
    case "manual":
      return clampPercent(Number(r.percent_complete) || 0);
    default:
      // Legacy blank tracking_mode — auto-detect like before this field existed.
      if (taskStats && taskStats.total > 0) return clampPercent(taskPercent(taskStats));
      return clampPercent(scheduledPercent(r, processed));
  }
}
