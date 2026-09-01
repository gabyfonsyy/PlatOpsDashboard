import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/**
 * POST /api/gas/incidents/sync — pulls every Jira ticket carrying the Report Tagging field
 * (customfield_10262) into INCIDENT_TICKETS, and sweeps out the ones whose tag has since been
 * CLEARED (IncidentsApi.sync in GAS). Read-only against Jira: the tag is the manager's own input,
 * and this route only ever reads it in either direction — the one path that writes to Jira is
 * ../ticket, which clears the field when an incident is retracted from the dashboard instead.
 *
 * A swept ticket that already has logs is flagged rather than deleted, so this route can never
 * destroy written feedback; see sweepUntaggedIncidentTickets_.
 *
 * Optional body { team } limits the run to one team_key, which is what the page sends when a
 * team filter is active — no reason to re-walk the other two projects' JQL for a DBA-only view.
 *
 * The GAS side can take a while (a JQL page per team, plus — only for a tagged ticket the RAW tabs
 * don't cover yet — a changelog fetch to attribute the validator). It self-limits to a wall-clock
 * budget and reports `capped` when it stops early, so the failure mode is "run it again", never a
 * half-finished write.
 *
 * maxDuration is raised from the 15s default because the default is what made the first sync
 * unusable: a full run overran it, the function returned 504 while Apps Script carried on working,
 * and the result was never reported — indistinguishable from the button doing nothing. 60s is the
 * ceiling on Vercel's Hobby plan, so it's the highest value that's safe on any plan; Pro allows up
 * to 300 if this ever needs more.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // A body is optional — `.catch` covers the button posting with no payload at all.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const team = typeof body.team === "string" && body.team ? body.team : undefined;
  // Re-derives fields on tickets already stored, instead of skipping them as unchanged. Needed
  // after a change to how a derived field is computed (e.g. the validator attribution fix) —
  // without it, a stored value is never revisited and the fix never reaches existing rows.
  const force = body.force === true ? "true" : undefined;

  try {
    const data = await fetchGas(
      "incidents",
      { action: "sync", team, force },
      { method: "POST", cache: "no-store" }
    );
    // The page reads incidents with cache: "no-store", but its team/roster fetches are cached and
    // the route segment itself can be served from the router cache — revalidate so the new rows
    // are on screen when the button's router.refresh() lands.
    revalidatePath("/incident-logs");
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
