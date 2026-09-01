import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createProject, deleteProject, updateProject } from "@/lib/work-store";
import { PROJECT_STATUSES, toPhaseList, toStringList } from "@/lib/work";

/** Tri-state, same contract as the task route: true, false, or null for "not sorted yet". */
function invalidTriState(field: string, value: unknown): boolean {
  return !(value === undefined || value === null || typeof value === "boolean");
}

/**
 * The one-pager's columns. Whitelisted the same way task patches are — the client sends a brief,
 * not a row, so user_email, the park stamps and last_activity_at stay the server's.
 *
 * Nothing here is required. The brief is enforced by being VISIBLE (briefGaps names the missing
 * answers on the card), not by refusing to save: a project that cannot yet answer "what is the
 * evidence" is a real state to be in, and a form that refuses it just means the project gets
 * tracked somewhere the app cannot see.
 */
const BRIEF_TEXT = ["problem", "outcome", "metric_baseline", "metric_target", "metric_by_when", "owner"];

/**
 * Normalises the brief off a request body. The two list columns are jsonb and are rebuilt rather
 * than forwarded, so a client cannot write `phases: "everything"` into a column the UI will later
 * call `.map` on. Blank entries are dropped here rather than stored and filtered on every read.
 */
function briefFrom(body: Record<string, unknown>): Record<string, unknown> {
  const brief: Record<string, unknown> = {};
  for (const key of BRIEF_TEXT) {
    if (body[key] !== undefined) {
      const value = String(body[key] ?? "").trim();
      brief[key] = value || null;
    }
  }
  if (body.explicitly_out !== undefined) brief.explicitly_out = toStringList(body.explicitly_out);
  if (body.phases !== undefined) {
    // Both halves of a phase are required for it to be one: a name with no exit criterion is a
    // heading, and an exit criterion with no name has nothing to end.
    brief.phases = toPhaseList(body.phases).filter((p) => p.name && p.exit);
  }
  return brief;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("A project needs a name.");
    if (invalidTriState("urgent", body.urgent) || invalidTriState("important", body.important)) {
      throw new Error("urgent and important must be true, false or null.");
    }
    const project = await createProject(email, {
      name,
      status: body.status as string | undefined,
      urgent: (body.urgent as boolean | null) ?? null,
      important: (body.important as boolean | null) ?? null,
      brief: briefFrom(body),
    });
    revalidatePath("/my-work");
    return project;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.project_id ?? "").trim();
    if (!id) throw new Error("project_id is required.");
    if (body.status !== undefined && !PROJECT_STATUSES.includes(String(body.status) as never)) {
      throw new Error(`Invalid status: ${String(body.status)}`);
    }
    if (invalidTriState("urgent", body.urgent) || invalidTriState("important", body.important)) {
      throw new Error("urgent and important must be true, false or null.");
    }
    if (body.name !== undefined && !String(body.name).trim()) {
      throw new Error("A project needs a name.");
    }
    const patch: Record<string, unknown> = { ...briefFrom(body) };
    // parked_at is deliberately absent: the stamp is the server's (see resolveParkFields), and so
    // is CLEARING these two when a project leaves Paused.
    for (const k of ["name", "status", "notes", "urgent", "important", "park_reason", "park_decision"]) {
      if (body[k] !== undefined) patch[k] = k === "name" ? String(body[k]).trim() : body[k];
    }
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
    const project = await updateProject(email, id, patch);
    revalidatePath("/my-work");
    return project;
  });
}

/**
 * Deletes a project. Its tasks survive as ungrouped tasks — see deleteProject — because they are a
 * record of days that happened and do not belong to the label that was on them.
 */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.project_id ?? "").trim();
    if (!id) throw new Error("project_id is required.");
    await deleteProject(email, id);
    revalidatePath("/my-work");
    return { project_id: id, deleted: true };
  });
}
