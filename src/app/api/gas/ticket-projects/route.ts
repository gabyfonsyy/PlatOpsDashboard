import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/** POST /api/gas/ticket-projects — bulk assign/unassign tickets to a project.
 * Body: { issue_keys: string[], project_id: string } ("" project_id = unassign). */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const payload = await req.json();
    const data = await fetchGas(
      "ticket-projects",
      { action: "assign" },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, assigned_by: email }),
        cache: "no-store",
      }
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
