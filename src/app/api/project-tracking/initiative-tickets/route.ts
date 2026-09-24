import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/** POST /api/project-tracking/initiative-tickets — triggers a manual Jira pull. GAS still owns
 * the Jira JQL/auth (gas/InitiativesSync.gs's syncInitiativeTickets), it just writes straight to
 * Supabase's initiative_tickets table now instead of a Sheets tab. Reuses the existing GAS route
 * name ("initiatives") since that side of the GAS deployment is unchanged. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await fetchGas("initiatives", { action: "sync" }, { method: "POST", cache: "no-store" });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
