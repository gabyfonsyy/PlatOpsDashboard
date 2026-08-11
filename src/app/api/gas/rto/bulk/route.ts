import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/** POST /api/gas/rto/bulk — log a whole team's attendance for one date in a single call.
 * Body: { date: string, entries: { employee_name, team_key, attendance_type, notes? }[] }. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const payload = await req.json();
    const data = await fetchGas(
      "rto",
      { action: "bulkUpsert" },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, created_by: email }),
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
