import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/**
 * PATCH /api/gas/incidents/validator — manually set or clear a ticket's validator.
 *
 * Its own route rather than the CRUD handler, because the target is an incident TICKET (synced
 * from Jira) and not an incident LOG. The override is stored in a separate column so a re-sync
 * can't clobber it, and GAS rejects any name outside the designated reviewers rather than
 * accepting a typo that would attribute reviews to someone who doesn't exist.
 *
 * Body: { issue_key, validator }. An empty `validator` clears the override and hands the field
 * back to the automatic derivation.
 */
export async function PATCH(req: NextRequest) {
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
      { action: "setValidator" },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_key: issueKey, validator: String(body.validator ?? "") }),
        cache: "no-store",
      }
    );
    revalidatePath("/incident-logs");
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
