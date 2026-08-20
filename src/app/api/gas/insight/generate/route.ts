import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { fetchGas } from "@/lib/gas-client";
import { isVoiceMode } from "@/lib/ai-voice";

/**
 * POST /api/gas/insight/generate — the ONLY path that can spend an AI request on a narrative
 * insight. Exists because the daily 06:00 trigger was removed: insights are now generated when
 * somebody asks for one, and served from cache on every page view after that.
 *
 * Body: { scope: "ROLLUP:ALL" | "TEAM:<key>", force?: boolean }
 *
 * Without `force`, GAS compares a fingerprint of the metrics it's about to send against the one
 * stored with the cached insight, and skips the model call entirely if nothing moved. So this
 * route being hit twice on unchanged data costs one request, not two — the response reports
 * `aiCalls` so the UI can say which happened rather than implying a fresh generation.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = String(body.scope ?? "ALL").trim() || "ALL";
  const force = body.force === true ? "true" : undefined;
  // Register follows the caller's theme (see voiceForTheme); GAS normalises anything unexpected
  // back to the plain voice rather than trusting it.
  const voice = isVoiceMode(body.voice) ? body.voice : "normal";

  try {
    const data = await fetchGas(
      "generate-insight",
      { scope, force, voice },
      { method: "POST", cache: "no-store" }
    );
    // The insight is read through a cached fetch on every page, so the new one only appears
    // after that cache is dropped.
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    // AI failure must never look like app failure — the caller renders this inline and the
    // existing cached insight stays on screen.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
