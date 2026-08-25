import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import {
  createSession,
  deleteSession,
  endWorkday,
  startWorkday,
  updateSession,
} from "@/lib/work-store";

/**
 * Timestamps arrive from `<input type="datetime-local">`, which yields a local wall-clock string
 * with no zone ("2026-08-24T09:14"). Interpreting that with `new Date()` on the SERVER would
 * resolve it in the server's zone, so a correction typed as 9:14am in Manila would land at 9:14am
 * UTC and move the session eight hours. The client sends a fully-qualified ISO string instead, and
 * this only checks that it is one — anything ambiguous is rejected rather than guessed at.
 */
function parseInstant(value: unknown, field: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${field} is required.`);
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new Error(`${field} isn't a valid date and time.`);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    throw new Error(`${field} must include a timezone offset.`);
  }
  return at.toISOString();
}

/**
 * POST /api/work/session
 *   { action: "start" | "end" }                    — the one-click path, unchanged.
 *   { started_at, ended_at }                       — backfills a day that was never started.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    if (body.started_at !== undefined || body.ended_at !== undefined) {
      const session = await createSession(email, {
        started_at: parseInstant(body.started_at, "Start time"),
        ended_at: parseInstant(body.ended_at, "End time"),
      });
      revalidatePath("/my-work");
      return { action: "create", session };
    }
    const action = body.action === "end" ? "end" : "start";
    const session = action === "end" ? await endWorkday(email) : await startWorkday(email);
    revalidatePath("/my-work");
    return { action, session };
  });
}

/**
 * PATCH /api/work/session — { session_id, started_at?, ended_at? }.
 *
 * `ended_at: null` is meaningful and distinct from omitting it: null re-opens a session, omitted
 * leaves it as it was. That is why the null check below is explicit rather than falsy.
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const sessionId = String(body.session_id ?? "").trim();
    if (!sessionId) throw new Error("session_id is required.");

    const patch: { started_at?: string; ended_at?: string | null } = {};
    if (body.started_at !== undefined) patch.started_at = parseInstant(body.started_at, "Start time");
    if (body.ended_at !== undefined) {
      patch.ended_at = body.ended_at === null ? null : parseInstant(body.ended_at, "End time");
    }
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");

    const session = await updateSession(email, sessionId, patch);
    revalidatePath("/my-work");
    return session;
  });
}

/** DELETE /api/work/session — { session_id }. For a session logged that never happened. */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const sessionId = String(body.session_id ?? "").trim();
    if (!sessionId) throw new Error("session_id is required.");
    await deleteSession(email, sessionId);
    revalidatePath("/my-work");
    return { session_id: sessionId, deleted: true };
  });
}
