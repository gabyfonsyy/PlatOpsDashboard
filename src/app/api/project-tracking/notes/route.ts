import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { addNote, deleteNote, updateNote } from "@/lib/project-tracking-store";
import { ValidationError } from "@/lib/work-route";

/** PATCH only ever toggles `resolved` today (Phase 5's blocker-resolve affordance) — not
 * author-restricted, unlike delete: whoever fixes a blocker should be able to resolve it. Delete
 * is author-only, enforced in `deleteNote` itself, not just hidden client-side. */
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
    const data = await addNote(email, payload);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const { id, resolved } = await req.json();
    if (!id) throw new ValidationError("id is required.");
    // PATCH only ever toggles `resolved` (see the file-header comment) — whitelisted rather than
    // forwarding the whole body, so a client can't rewrite `author_email` to itself and then pass
    // deleteNote's author-only check, or silently overwrite `content`/`note_type` under someone
    // else's name.
    const data = await updateNote(id, { resolved }, email);
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
    await deleteNote(id, email);
    return NextResponse.json({ ok: true, data: { id, deleted: true } });
  } catch (err) {
    return fail(err);
  }
}
