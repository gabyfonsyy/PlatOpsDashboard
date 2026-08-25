import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { getOverview } from "@/lib/overview";
import { generateBriefing, getBriefing } from "@/lib/overview-ai";
import { isVoiceMode } from "@/lib/ai-voice";

/**
 * POST /api/overview/snapshot — body { force?: boolean, voice?: VoiceMode }
 *
 * The ONLY path that can spend an AI request on the Overview briefing.
 *
 * ── The one deliberate exception to "no AI on page load" ───────────────────────────────────────
 * Everything else on this dashboard generates only on an explicit button press. The briefing is
 * meant to be a once-a-day snapshot that is simply THERE when the page is opened in the morning,
 * so the Overview asks for one automatically the first time it is opened on a given day.
 *
 * What makes that safe is this route, not the caller: without `force`, it checks for a snapshot
 * dated today IN THIS REGISTER before doing any work and returns the cached one if it exists. So
 * the ceiling is one request per person per calendar day per register — two, if both Professional
 * and Gaby View are opened — no matter how many times the page is loaded or how many tabs are
 * left open overnight. `aiCalls` in the response reports which
 * happened, so the UI can say "already up to date" rather than implying a fresh generation.
 *
 * If this ever needs to become strictly button-only, delete the auto-request in the client
 * component — nothing here changes.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const force = body.force === true;
  const voice = isVoiceMode(body.voice) ? body.voice : "normal";

  return handle(async (email) => {
    // Cheap guard first: a same-day snapshot means there is nothing to do, and checking costs one
    // indexed lookup against the aggregation of every module.
    if (!force) {
      const existing = await getBriefing(email, manilaDate(), voice);
      if (existing) return { briefing: existing, aiCalls: 0, cached: true };
    }

    const data = await getOverview(email);
    const briefing = await generateBriefing(email, data, voice);
    revalidatePath("/");
    return { briefing, aiCalls: 1, cached: false };
  });
}

/** Same Manila day the aggregation layer uses, without pulling the whole module in to ask. */
function manilaDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
