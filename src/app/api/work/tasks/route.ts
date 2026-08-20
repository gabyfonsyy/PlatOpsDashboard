import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createTask, deleteTask, updateTask, updateTasks } from "@/lib/work-store";
import { TASK_LANES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/work";

/**
 * Whitelisted patch fields. Anything else in the body is dropped rather than forwarded, so a
 * client can't write user_email or the derived lifecycle stamps — those are the server's to set
 * (see updateTask).
 *
 * work_date IS patchable: moving a task to another day is the whole of scheduling. It's validated
 * as a real calendar date below, so the CHECK-free `date` column can't be handed "tomorrow".
 */
const PATCHABLE = new Set(["title", "lane", "status", "priority", "project_id", "notes", "work_date"]);

function invalid(field: string, value: unknown, allowed: readonly string[]): string | null {
  if (value === undefined) return null;
  return allowed.includes(String(value)) ? null : `Invalid ${field}: ${String(value)}`;
}

/**
 * Strict 'yyyy-MM-dd', round-tripped through Date to reject the ones that pass the regex but
 * aren't days (2026-02-30, 2026-13-01). Postgres would refuse those too, but a 502 from the
 * database reads as "the app is broken" rather than "that isn't a date".
 */
function invalidDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `Invalid date: ${raw}`;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const ok =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  return ok ? null : `Invalid date: ${raw}`;
}

function validate(body: Record<string, unknown>): string | null {
  return (
    invalid("lane", body.lane, TASK_LANES) ??
    invalid("status", body.status, TASK_STATUSES) ??
    invalid("priority", body.priority, TASK_PRIORITIES) ??
    invalidDate(body.work_date)
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const title = String(body.title ?? "").trim();
    if (!title) throw new Error("A task needs a title.");
    const bad = validate(body);
    if (bad) throw new Error(bad);
    const task = await createTask(email, {
      title,
      lane: body.lane as string | undefined,
      priority: body.priority as string | undefined,
      project_id: (body.project_id as string | null) || null,
      notes: (body.notes as string) || undefined,
      work_date: (body.work_date as string) || undefined,
    });
    revalidatePath("/my-work");
    return task;
  });
}

/**
 * Accepts either `task_id` (one task, with the status-transition stamping in updateTask) or
 * `task_ids` (a batch, for the bulk reschedules the planning UI offers). One handler rather than
 * two endpoints because the validation and the whitelist are identical either way.
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const ids = Array.isArray(body.task_ids)
      ? body.task_ids.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const id = String(body.task_id ?? "").trim();
    if (!id && ids.length === 0) throw new Error("task_id or task_ids is required.");
    const bad = validate(body);
    if (bad) throw new Error(bad);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) if (PATCHABLE.has(k)) patch[k] = v;
    const result = ids.length > 0 ? await updateTasks(email, ids, patch) : await updateTask(email, id, patch);
    revalidatePath("/my-work");
    return result;
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.task_id ?? "").trim();
    if (!id) throw new Error("task_id is required.");
    await deleteTask(email, id);
    revalidatePath("/my-work");
    return { task_id: id, deleted: true };
  });
}
