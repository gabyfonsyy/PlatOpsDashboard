import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/**
 * DELETE /api/gas/incidents/ticket — retracts an incident: clears the ticket's Report Tagging
 * field in Jira, then drops its row and any logs on it (IncidentsApi.removeTicket in GAS).
 *
 * Its own route rather than the CRUD handler for the same reason as ../validator: the target is an
 * incident TICKET, while DELETE on the CRUD handler removes a single incident LOG by id.
 *
 * The Jira write is the point, not a side effect. Report Tagging is the whole membership condition
 * for the incident list, so deleting only the local row would hand the ticket back on the next
 * sync. It is also the ONLY write this project makes to Jira — every other Jira call in the
 * codebase reads.
 *
 * Body: { issue_key }. Destructive of manager-written feedback when the ticket carries logs, which
 * is why the caller confirms with the log count in hand (RemoveIncidentTicketButton).
 */
/**
 * Raised off the 15s default for the same reason as the sync route: this is a Jira write plus two
 * sheet writes behind an Apps Script round-trip, and a 504 here would be the worst possible
 * outcome — the Jira field cleared, the caller told it failed.
 */
export const maxDuration = 60;

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const issueKey = String(body.issue_key ?? "").trim();
  if (!issueKey) {
    return NextResponse.json({ ok: false, error: "issue_key is required" }, { status: 400 });
  }

  try {
    const data = await fetchGas(
      "incidents",
      { action: "removeTicket" },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_key: issueKey }),
        cache: "no-store",
      }
    );
    revalidatePath("/incident-logs");
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    // Surfaced verbatim: the failure that actually happens here is Jira refusing the field edit
    // (no permission, or Report Tagging not on the issue's edit screen), and its own message is
    // the only thing that says which. GAS clears Jira before touching the sheet, so a failure
    // here means nothing was removed.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
