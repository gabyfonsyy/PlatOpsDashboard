import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";
import { saveSiteMonitoringSnapshot } from "@/lib/site-monitoring-store";
import type { SiteMonitoringClient } from "@/lib/site-monitoring";

/**
 * The ONLY path that ever hits the Site Monitoring Google Sheet — an explicit action, never a
 * side effect of loading the page (see references/site-monitoring/page.tsx, which reads the
 * cached snapshot instead). Fetches the sheet fresh, sanity-checks the shape, and only then
 * overwrites the cache — a failed or malformed fetch leaves the previous snapshot (and its
 * "Last synced" timestamp) exactly as it was.
 */
function looksLikeClientList(data: unknown): data is SiteMonitoringClient[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((c) => c && typeof c === "object" && typeof (c as Record<string, unknown>).clientId === "string")
  );
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const fresh = await fetchGas<unknown>("site-monitoring", {}, { cache: "no-store" });
    if (!looksLikeClientList(fresh)) {
      throw new Error("Site Monitoring data from the sheet looks malformed (expected a non-empty list of clients).");
    }
    const snapshot = await saveSiteMonitoringSnapshot(fresh);
    return NextResponse.json({ ok: true, data: snapshot });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
