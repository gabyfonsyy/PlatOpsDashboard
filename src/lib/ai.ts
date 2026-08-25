/**
 * The frontend's AI transport: open-weight models on Groq, over the OpenAI-compatible
 * /chat/completions endpoint. Server-only — AI_API_KEY must never be prefixed NEXT_PUBLIC_
 * or referenced from a client component, so every caller is an /api route handler.
 *
 * Why this exists alongside gas/AiClient.gs rather than routing through the GAS backend:
 * the interactive calls (rephrasing a manager's incident feedback while they wait) are on the
 * critical path of a form submit, and Apps Script Web App round-trips run anywhere from ~2s to
 * 40s+ under its own load (see gas/README.md). Going browser -> Next route -> Groq is one hop;
 * going through GAS would be two, with the slow hop in the middle. GAS keeps the scheduled work
 * (daily narrative insights); this keeps the interactive work. Same provider, same key name.
 */

const AI_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Two tiers, kept in step with gas/AiClient.gs's AI_MODELS.
 *
 *   fast — Llama 3.1 8B. Rewriting a paragraph, classifying into a fixed list, writing prose
 *          around numbers that are already computed. Most of what this app asks for.
 *   deep — Llama 3.3 70B. Multi-variable reasoning where the answer depends on relating several
 *          independent signals — currently only Work Mirror.
 *
 * Defaulting to the big model is the expensive habit. On a free tier the tier choice is what
 * decides whether a feature is affordable, so it's explicit per call site rather than global.
 */
export const AI_MODELS = {
  // Repointed 2026-08-25: Groq retired both Llama ids and they 404 as model_not_found. See the
  // note in gas/AiClient.gs — these two must stay in step with it.
  fast: "openai/gpt-oss-20b",
  deep: "openai/gpt-oss-120b",
} as const;

export type AiTier = keyof typeof AI_MODELS;

const AI_DEFAULT_TIER: AiTier = "fast";

const AI_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const AI_MAX_RETRIES = 2;

export class AiConfigError extends Error {}
export class AiRequestError extends Error {}

/** An explicit AI_MODEL env var overrides every tier — escape hatch for a retired model id. */
export function getAiModel(tier: AiTier = AI_DEFAULT_TIER): string {
  return process.env.AI_MODEL || AI_MODELS[tier];
}

/**
 * Whether the AI features can run at all. Callers use this to degrade to a plain manual-entry
 * form rather than showing a broken "Rephrase" button — same posture the rest of the app takes
 * toward an unconfigured GAS backend.
 */
export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

type ChatOptions = {
  systemPrompt?: string;
  /** Defaults to 0.3 — these are evaluation surfaces, so repeatable phrasing beats variety. */
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** Which model tier to spend. Defaults to "fast" — opt in to "deep" deliberately. */
  tier?: AiTier;
};

async function chatRaw(prompt: string, options: ChatOptions = {}): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new AiConfigError("AI_API_KEY is not configured");

  const messages: { role: string; content: string }[] = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model: getAiModel(options.tier),
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1024,
  };
  if (options.json) body.response_format = { type: "json_object" };

  let lastError = "";

  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      return String(text ?? "").trim();
    }

    lastError = `AI request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`;
    if (AI_RETRYABLE_STATUS_CODES.includes(res.status) && attempt < AI_MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
      continue;
    }
    break;
  }

  throw new AiRequestError(lastError);
}

export async function chat(prompt: string, options: ChatOptions = {}): Promise<string> {
  return chatRaw(prompt, options);
}

/**
 * chat() with JSON mode, parsed. Open-weight models still occasionally wrap the object in a
 * ```json fence even with response_format set, so the fence is stripped before parsing — a
 * cosmetic wrapper shouldn't surface to the user as "the AI failed".
 */
export async function chatJson<T>(prompt: string, options: ChatOptions = {}): Promise<T> {
  const raw = await chatRaw(prompt, { ...options, json: true });
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    throw new AiRequestError(`AI returned unparseable JSON: ${unfenced.slice(0, 300)}`);
  }
}
