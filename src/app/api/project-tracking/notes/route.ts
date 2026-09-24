import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { addNote, deleteNote, updateNote } from "@/lib/project-tracking-store";

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
    { status: 502 }
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
    const { id, ...payload } = await req.json();
    if (!id) throw new Error("id is required.");
    const data = await updateNote(id, payload, email);
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
    if (!id) throw new Error("id is required.");
    await deleteNote(id, email);
    return NextResponse.json({ ok: true, data: { id, deleted: true } });
  } catch (err) {
    return fail(err);
  }
}
