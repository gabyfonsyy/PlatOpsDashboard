import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { deleteLatestReschedule, setRescheduleReason } from "@/lib/work-store";
import { RESCHEDULE_REASONS } from "@/lib/work";

/**
 * Why a task was pushed. Separate from PATCH /api/work/tasks on purpose: the move and the reason
 * are two moments, not one. The move happens on a single click and must never wait for a form —
 * this is what the "why?" strip posts afterwards, and it addresses the newest slip of that task
 * (see setRescheduleReason).
 *
 * A reason is optional throughout. Nothing here ever runs if the strip is dismissed, and that has
 * to stay true: a mandatory field is how a one-click button turns back into a dialog.
 */

const REASON_CODES = RESCHEDULE_REASONS.map((r) => r.code) as readonly string[];

/** Long enough for a sentence of context, short enough that it can't become a journal entry. */
const NOTE_LIMIT = 400;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const taskId = String(body.task_id ?? "").trim();
    if (!taskId) throw new Error("task_id is required.");

    const reason = String(body.reason ?? "").trim();
    // Validated against the vocabulary rather than stored as free text: these codes are counted and
    // grouped by Work Mirror, and one stray label would quietly become its own category.
    if (!REASON_CODES.includes(reason)) throw new Error(`Invalid reason: ${reason}`);

    const rawNote = typeof body.note === "string" ? body.note.trim() : "";
    const note = rawNote ? rawNote.slice(0, NOTE_LIMIT) : null;

    const saved = await setRescheduleReason(email, taskId, reason, note);
    revalidatePath("/my-work");
    return saved;
  });
}

/**
 * Undo's other half: drop the slip that was just logged.
 *
 * The task is moved back by an ordinary PATCH, which is a backward move and so is never logged.
 * Without this the undone push would still be sitting in the log, and "how often does work slip"
 * would be counting misclicks.
 */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const taskId = String(body.task_id ?? "").trim();
    if (!taskId) throw new Error("task_id is required.");
    await deleteLatestReschedule(email, taskId);
    revalidatePath("/my-work");
    return { task_id: taskId, deleted: true };
  });
}
