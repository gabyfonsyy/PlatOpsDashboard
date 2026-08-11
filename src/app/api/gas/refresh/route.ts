import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";

/**
 * POST /api/gas/refresh — the dashboard's "Refresh Data" button. Busts both cache layers that
 * make a fix look like it "didn't take" for a few minutes: the GAS backend's own 10-minute
 * sheetToObjectsCached_ TTL (METRICS_DAILY, METRICS_BY_ASSIGNEE_MONTHLY, every RAW_<team>_<year>
 * tab), and Next.js's 5-minute fetch cache on every `next: { revalidate }` call in lib/*.ts.
 * revalidatePath("/", "layout") clears the latter for the whole app, not just the current route,
 * since the button lives in the global TopNav rather than one page.
 */
export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    await fetchGas("refresh-cache", {}, { method: "POST", cache: "no-store" });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
