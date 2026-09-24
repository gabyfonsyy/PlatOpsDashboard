import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { linkPhaseTicket, unlinkPhaseTicket } from "@/lib/project-tracking-store";

/** POST links a ticket to a phase, DELETE unlinks — no PATCH, there's nothing on the row to edit
 * once it exists. Same bespoke-route shape as ticket-map/route.ts (a bulk/simple action the
 * generic CRUD factory doesn't fit). */
async function requireSessionEmail() {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

export async function POST(req: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const payload = await req.json();
    const data = await linkPhaseTicket(email, payload);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const email = await requireSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) throw new Error("id is required.");
    await unlinkPhaseTicket(id);
    return NextResponse.json({ ok: true, data: { id, deleted: true } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
