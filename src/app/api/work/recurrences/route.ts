import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createRecurrence, deleteRecurrence, updateRecurrence } from "@/lib/work-store";
import { RECUR_FREQS, TASK_LANES, TASK_PRIORITIES } from "@/lib/work";

/**
 * Recurrence rules. The instances they produce are ordinary tasks and are edited through
 * /api/work/tasks — this endpoint only ever touches the schedule.
 *
 * Note there's no GET: the page reads its rules server-side in getMyWork, so an authenticated
 * read endpoint here would be a second way to reach the same data with its own auth surface and
 * no caller.
 */

const PATCHABLE = new Set([
  "title",
  "lane",
  "priority",
  "project_id",
  "notes",
  "freq",
  "byweekday",
  "bymonthday",
  "start_date",
  "end_date",
  "paused",
  // Inherited by future untouched instances, so re-triaging the rule re-triages the routine.
  "urgent",
  "important",
]);

function invalid(field: string, value: unknown, allowed: readonly string[]): string | null {
  if (value === undefined) return null;
  return allowed.includes(String(value)) ? null : `Invalid ${field}: ${String(value)}`;
}

function invalidDate(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `Invalid ${field}: ${raw}`;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const ok = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  return ok ? null : `Invalid ${field}: ${raw}`;
}

/** Bounds-checked here as well as by the CHECK constraints, so the error is a sentence. */
function invalidNumber(field: string, value: unknown, min: number, max: number): string | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return `Invalid ${field}: ${String(value)}`;
  return null;
}

function validate(body: Record<string, unknown>): string | null {
  return (
    invalid("freq", body.freq, RECUR_FREQS) ??
    invalid("lane", body.lane, TASK_LANES) ??
    invalid("priority", body.priority, TASK_PRIORITIES) ??
    invalidDate("start_date", body.start_date) ??
    invalidDate("end_date", body.end_date) ??
    invalidNumber("byweekday", body.byweekday, 0, 6) ??
    invalidNumber("bymonthday", body.bymonthday, 1, 31)
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const title = String(body.title ?? "").trim();
    if (!title) throw new Error("A repeating task needs a title.");
    if (!body.freq) throw new Error("Pick how often it repeats.");
    const bad = validate(body);
    if (bad) throw new Error(bad);
    const rule = await createRecurrence(email, {
      title,
      freq: String(body.freq),
      lane: body.lane as string | undefined,
      priority: body.priority as string | undefined,
      project_id: (body.project_id as string | null) || null,
      notes: (body.notes as string) || undefined,
      start_date: (body.start_date as string) || undefined,
      end_date: (body.end_date as string) || null,
      byweekday: body.byweekday === undefined ? undefined : Number(body.byweekday),
      bymonthday: body.bymonthday === undefined ? undefined : Number(body.bymonthday),
      urgent: (body.urgent as boolean | null) ?? null,
      important: (body.important as boolean | null) ?? null,
    });
    revalidatePath("/my-work");
    return rule;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.recurrence_id ?? "").trim();
    if (!id) throw new Error("recurrence_id is required.");
    const bad = validate(body);
    if (bad) throw new Error(bad);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) if (PATCHABLE.has(k)) patch[k] = v;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
    const rule = await updateRecurrence(email, id, patch);
    revalidatePath("/my-work");
    return rule;
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.recurrence_id ?? "").trim();
    if (!id) throw new Error("recurrence_id is required.");
    await deleteRecurrence(email, id);
    revalidatePath("/my-work");
    return { recurrence_id: id, deleted: true };
  });
}
