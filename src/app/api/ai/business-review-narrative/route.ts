import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { chatJson, getAiModel, isAiConfigured, AiConfigError } from "@/lib/ai";
import { getCachedInsight, saveInsight } from "@/lib/work-store";
import { buildNarrativePrompt, NARRATIVE_SYSTEM_PROMPT, NARRATIVE_CACHE_CONTEXT, narrativeCacheKey, type NarrativeFacts } from "@/lib/business-review-ai";
import { voiceForTheme } from "@/lib/ai-voice";

/**
 * POST /api/ai/business-review-narrative — the ONLY place that calls the model for Business
 * Review Prep, and only when she explicitly clicks "Get AI take" on a card (never on page load —
 * lib/business-review.ts's own render path only ever READS this same cache, never writes to it).
 *
 * Turns Business Review Prep's already-computed driver facts (lib/business-review-drivers.ts)
 * into 1-3 sentences of business-review-ready prose. The deterministic engine has already decided
 * WHAT happened and WHY (or that it can't tell); this route only asks a model to phrase that
 * decision, never to make it — see lib/business-review-ai.ts's system prompt for the hard rule
 * against inventing facts.
 *
 * Cached in the generic ai_insight_cache table (see narrativeCacheKey's doc comment) so asking
 * twice for the same (metric, period, driver verdict) never spends a second AI call — the whole
 * point of "only once" here.
 */

type NarrativeResponse = { narrative?: unknown };

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ ok: false, error: "AI is not configured — set AI_API_KEY." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const facts = body.facts as NarrativeFacts | undefined;
  if (!facts?.metricLabel || !Array.isArray(facts.driverRows)) {
    return NextResponse.json({ ok: false, error: "Missing or malformed facts." }, { status: 400 });
  }

  const { entityId, version } = narrativeCacheKey(facts);

  const cached = await getCachedInsight<{ narrative: string }>(email, NARRATIVE_CACHE_CONTEXT, entityId, version);
  if (cached?.content.narrative) {
    return NextResponse.json({ ok: true, data: { narrative: cached.content.narrative, model: cached.model, fromCache: true } });
  }

  try {
    const voice = voiceForTheme(facts.theme);
    const result = await chatJson<NarrativeResponse>(
      buildNarrativePrompt(facts),
      {
        systemPrompt: `${NARRATIVE_SYSTEM_PROMPT}\n\nVoice: ${voice === "gaby" ? "warm, a bit playful, space-themed — but still fit for presenting to leadership." : "neutral, professional, executive-facing."}`,
        temperature: 0.3,
        maxTokens: 300,
        tier: "fast",
      }
    );

    const narrative = String(result.narrative ?? "").trim();
    if (!narrative) throw new Error("AI returned an empty narrative.");

    const model = getAiModel("fast");
    await saveInsight(email, NARRATIVE_CACHE_CONTEXT, entityId, version, { narrative }, model);
    return NextResponse.json({ ok: true, data: { narrative, model, fromCache: false } });
  } catch (err) {
    const status = err instanceof AiConfigError ? 503 : 502;
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
