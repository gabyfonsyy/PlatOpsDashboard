import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { chatJson, getAiModel, isAiConfigured, AiConfigError } from "@/lib/ai";
import { buildNarrativePrompt, NARRATIVE_SYSTEM_PROMPT, type NarrativeFacts } from "@/lib/business-review-ai";
import { voiceForTheme } from "@/lib/ai-voice";

/**
 * POST /api/ai/business-review-narrative — turns Business Review Prep's already-computed driver
 * facts (lib/business-review-drivers.ts) into 1-3 sentences of business-review-ready prose.
 *
 * The deterministic engine has already decided WHAT happened and WHY (or that it can't tell);
 * this route only asks a model to phrase that decision, never to make it — see
 * lib/business-review-ai.ts's system prompt for the hard rule against inventing facts. The
 * deterministic sentence (lib/business-review-view.ts's buildInsightSentence) is what renders
 * immediately and what stays on screen if this call is unavailable or fails; callers should treat
 * this as a progressive enhancement, never a blocking dependency.
 */

type NarrativeResponse = { narrative?: unknown };

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
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

    return NextResponse.json({ ok: true, data: { narrative, model: getAiModel("fast") } });
  } catch (err) {
    const status = err instanceof AiConfigError ? 503 : 502;
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
