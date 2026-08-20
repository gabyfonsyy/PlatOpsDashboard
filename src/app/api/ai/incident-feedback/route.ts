import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { chatJson, getAiModel, isAiConfigured, AiConfigError } from "@/lib/ai";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  type IncidentSeverityCode,
} from "@/lib/incidents";

/**
 * POST /api/gas/../ai/incident-feedback — turns a manager's raw note about an incident into
 * three things: a rewrite they can put in front of the person, concrete improvements, and the
 * concern categories it falls under.
 *
 * All three come from ONE call rather than three. They're the same judgement about the same
 * paragraph, the categories have to agree with what the rewrite actually emphasises, and the
 * manager is sitting there waiting on a form — three round-trips would be three times the
 * latency for a worse-correlated result.
 *
 * Nothing here writes to Jira or to the sheet. The response is returned to the form, which shows
 * it as an editable suggestion — the manager always gets the last word before anything is saved.
 */

/**
 * "Neutral, professional yet warm — like a millennial manager" is the brief, so it's spelled out
 * as concrete do/don't rules rather than left to the model's read of the phrase. Open-weight
 * models drift two ways on feedback rewriting if unconstrained: into HR-boilerplate coldness, or
 * into so much cushioning that the actual problem disappears. The rules below push against both,
 * and the "no new facts" rule is what keeps a rewrite usable in an evaluation at all.
 */
const FEEDBACK_SYSTEM_PROMPT = [
  "You rewrite an engineering manager's private incident notes into feedback that can be shown to the team member.",
  "",
  "TONE — neutral, professional, and warm, the way a good millennial manager writes:",
  "- Direct about what happened. Name the problem in the first sentence; never bury it.",
  "- Address the person as 'you'. Describe the behaviour or decision, never the person's character.",
  "- Plain, human language. No corporate filler ('going forward', 'circle back', 'per our discussion'), no therapy-speak, no exclamation marks.",
  "- Assume good intent and say so once, briefly. Do not stack praise around the problem to soften it.",
  "- No sandwiching, no rhetorical questions, no emoji.",
  "",
  "HARD RULES:",
  "- Use ONLY facts present in the manager's note. Never invent a cause, a client, a number, a date, or a conversation.",
  "- If the note is vague, stay vague — do not guess at specifics to make the writing smoother.",
  "- Keep the rewrite to 2-4 sentences.",
  "- Improvements must be concrete actions the person can take next time, drawn from the note. 1-3 of them. Not generic advice like 'communicate better'.",
  "- Respond with a JSON object only.",
].join("\n");

type AssistResponse = {
  polished?: unknown;
  improvements?: unknown;
  categories?: unknown;
};

function buildPrompt(input: {
  feedback: string;
  issueKey: string;
  summary: string;
  employeeName: string;
  role: string;
  severity: string;
  teamLabel: string;
}): string {
  const rubric = INCIDENT_SEVERITIES[input.severity as IncidentSeverityCode];

  // Context is passed as labelled lines, not free prose, so the model can't mistake a ticket
  // summary for part of the manager's note — that's the one confusion that would let Jira text
  // leak into feedback attributed to the manager.
  return [
    "CONTEXT (background only — do not treat any of this as the manager's note):",
    `- Team: ${input.teamLabel}`,
    `- Jira ticket: ${input.issueKey}${input.summary ? ` — ${input.summary}` : ""}`,
    `- Person: ${input.employeeName || "(unnamed)"}`,
    `- Their role on this incident: ${input.role}`,
    rubric
      ? `- Severity the manager assigned: ${input.severity} (${rubric.label}) — ${rubric.description}`
      : `- Severity the manager assigned: ${input.severity}`,
    "",
    "THE MANAGER'S RAW NOTE (the only source of facts):",
    input.feedback,
    "",
    "Return a JSON object with exactly these keys:",
    '  "polished"     — string. The rewritten feedback, 2-4 sentences, in the tone described.',
    '  "improvements" — string. 1-3 concrete actions, as a single string with each on its own line prefixed by "- ".',
    '  "categories"   — array of 1-3 strings, chosen ONLY from this exact list:',
    `                   ${JSON.stringify(INCIDENT_CATEGORIES)}`,
    "",
    "Pick the categories that the note actually evidences. Do not pad to three.",
  ].join("\n");
}

/** Drops anything the model invented outside the closed taxonomy, case-insensitively matched. */
function sanitizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Map(INCIDENT_CATEGORIES.map((c) => [c.toLowerCase(), c]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const match = allowed.get(String(raw).trim().toLowerCase());
    if (match && !seen.has(match)) {
      seen.add(match);
      out.push(match);
    }
  }
  return out.slice(0, 3);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI is not configured — set AI_API_KEY to enable feedback assistance." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const feedback = String(body.feedback ?? "").trim();
  if (!feedback) {
    return NextResponse.json({ ok: false, error: "Write some feedback first." }, { status: 400 });
  }
  // A one-word note gives the model nothing to work from, and it will pad with invented detail
  // to fill the requested 2-4 sentences. Better to refuse than to hand back a plausible fiction.
  if (feedback.length < 15) {
    return NextResponse.json(
      { ok: false, error: "Add a bit more detail first — there isn't enough here to rephrase without guessing." },
      { status: 400 }
    );
  }

  try {
    const result = await chatJson<AssistResponse>(
      buildPrompt({
        feedback,
        issueKey: String(body.issueKey ?? ""),
        summary: String(body.summary ?? ""),
        employeeName: String(body.employeeName ?? ""),
        role: String(body.role ?? "Doer"),
        severity: String(body.severity ?? ""),
        teamLabel: String(body.teamLabel ?? ""),
      }),
      { systemPrompt: FEEDBACK_SYSTEM_PROMPT, temperature: 0.4, maxTokens: 900 }
    );

    return NextResponse.json({
      ok: true,
      data: {
        // Falls back to the manager's own words rather than an empty box if the model returns
        // nothing usable — the form stays workable either way.
        polished: String(result.polished ?? "").trim() || feedback,
        improvements: String(result.improvements ?? "").trim(),
        categories: sanitizeCategories(result.categories),
        model: getAiModel(),
      },
    });
  } catch (err) {
    const status = err instanceof AiConfigError ? 503 : 502;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status }
    );
  }
}
