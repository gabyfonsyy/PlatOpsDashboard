import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { recomputeAllTeamBaselines } from "@/lib/kpi-baselines";

/**
 * The ONLY path that recomputes kpi_baselines — an explicit action, never a side effect of loading
 * a team page (see [team]/page.tsx, which only ever reads the stored rows). Same auth posture as
 * site-monitoring/sync/route.ts.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const results = await recomputeAllTeamBaselines();
    return NextResponse.json({ ok: true, data: results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
