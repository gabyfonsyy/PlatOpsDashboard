import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPhase, deletePhase, reorderPhases, updatePhase } from "@/lib/project-tracking-store";
import { ValidationError } from "@/lib/work-route";

/**
 * A custom route rather than `createSupabaseCrudRouteHandlers` — PATCH here does double duty:
 * a normal `{id, ...payload}` field update, or a bulk reorder (`{order: string[]}`) when a phase
 * moves, since the generic factory only knows how to touch one row per call.
 */
async function requireSessionEmail() {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

function fail(err: unknown) {
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : String(err) },
    { status: err instanceof ValidationError ? 400 : 502 }
  );
}

export async function POST(req: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const payload = await req.json();
    const data = await createPhase(email, payload);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (Array.isArray(body?.order)) {
      await reorderPhases(body.order);
      return NextResponse.json({ ok: true, data: { reordered: body.order.length } });
    }
    const { id, created_by: _createdBy, ...payload } = body;
    if (!id) throw new ValidationError("id is required.");
    // created_by is stamped once at creation and is not client-patchable — see supabase-crud-route.ts.
    const data = await updatePhase(id, payload, email);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) throw new ValidationError("id is required.");
    await deletePhase(id);
    return NextResponse.json({ ok: true, data: { id, deleted: true } });
  } catch (err) {
    return fail(err);
  }
}
