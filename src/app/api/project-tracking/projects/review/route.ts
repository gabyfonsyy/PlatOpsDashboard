import { NextResponse } from "next/server";
import { handle } from "@/lib/work-route";
import { chatJson, getAiModel, isAiConfigured } from "@/lib/ai";
import { voicedSystemPrompt } from "@/lib/ai-voice";
import { getCachedInsight, saveInsight, sourceVersion } from "@/lib/work-store";
import { inventsFigures, type BriefFieldReview } from "@/lib/work";
import { ONE_PAGER_FIELDS, type OnePagerFieldKey, type ProjectOnePagerReview } from "@/lib/project-tracking";

/**
 * Reviews a project one-pager — Problem/Context, Objective, Expected Outcome, Scope, Out of
 * Scope, Success Metrics — and returns a clearer version of each field, as a suggestion accepted
 * or ignored field by field. Modeled directly on `/api/work/projects/review`; see that file for
 * the full reasoning (editor-not-author, the invented-figure guard, "normal" register always).
 * The one real difference: every field here is a single paragraph, so there's no metric
 * baseline/target/by-when split and no items/suggested list split to normalise — one shape
 * (`BriefFieldReview`) covers all six.
 */

const FEATURE_INSTRUCTIONS = [
  "TASK: you are editing a project one-pager. Six fields, all of which you are reviewing.",
  "",
  "You are an editor, not an author. Every suggestion must be the SAME CLAIM said better — tighter,",
  "more concrete in its wording, and unambiguous about who benefits. You are improving how it is",
  "said, never what it says.",
  "",
  "ABSOLUTE RULE — DO NOT INVENT:",
  "- Never add a number, percentage, duration, date, deadline, name, team or system that does not",
  "  already appear in the text you were given. Not as an example, not as a placeholder, not in",
  "  brackets. If a figure would make the sentence stronger and there isn't one, that belongs in",
  "  'asks', not in 'revised'.",
  "- Never state as fact anything you inferred. If the text does not say who is affected, do not",
  "  decide who is affected.",
  "- An empty field stays empty. Return '' for 'revised' and put the question in 'asks'. Writing a",
  "  plausible answer for a blank box is the worst thing you can do here.",
  "",
  "WHAT EACH FIELD IS FOR:",
  "- Problem/Context: why this project exists — the situation today and what's wrong with it. Keep",
  "  the evidence exactly as written; strip the solution back out if it's crept in.",
  "- Objective: what this project sets out to do, stated as an action, not an aspiration.",
  "- Expected Outcome: rewrite from the point of view of whoever benefits, in the present tense, as",
  "  something they can notice. 'An SE knows the same day whether it passed', not 'improve turnaround'.",
  "- Scope: what's actually being built or changed. Reword only — do not add or drop items.",
  "- Out of Scope: sharpen her exclusions. Do not add a new exclusion she hasn't written — if you",
  "  think people will wrongly assume something is included, put that in 'asks' as a question.",
  "- Success Metrics: reword only. A measurement or commitment that is empty stays empty and you ask",
  "  for it, rather than inventing a number that would make it look answered.",
  "",
  "- 'why' is one short sentence about what you changed and what it buys. Not a compliment.",
  "- 'asks' is a list of short direct questions, only where something is genuinely missing. Empty",
  "  list when nothing is.",
  "",
  "Respond with a JSON object only.",
].join("\n");

type RawReview = Partial<Record<OnePagerFieldKey, unknown>>;

type OnePagerInput = {
  project_name: string;
  problem_context: string;
  objective: string;
  expected_outcome: string;
  scope: string;
  out_of_scope: string;
  success_metrics: string;
};

function buildPrompt(input: OnePagerInput): string {
  const shape = ONE_PAGER_FIELDS.map((f) => `"${f.key}": Field`).join(", ");
  return [
    "Review this project one-pager.",
    "",
    `Return JSON: { ${shape} }`,
    "",
    '  Field = { "revised": string, "why": string, "asks": string[] }',
    "",
    "Every key must be present. Use \"\" and [] rather than null or omitting a key.",
    "",
    "THE ONE-PAGER:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The guard, applied after the model has answered — see FEATURE_INSTRUCTIONS' "DO NOT INVENT"
 * rule. A figure that wasn't already in the source text is invented evidence, and the whole
 * suggestion for that field is dropped, not patched, since a sentence built around a fabricated
 * number doesn't survive having the number removed.
 */
function reviewField(
  label: string,
  source: string,
  raw: unknown,
  discarded: string[]
): BriefFieldReview | null {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const revised = str(rec.revised);
  const asks = Array.isArray(rec.asks) ? rec.asks.map(str).filter(Boolean).slice(0, 6) : [];
  if (!revised && asks.length === 0) return null;
  if (inventsFigures(source, revised)) {
    discarded.push(label);
    return null;
  }
  return { revised, why: str(rec.why), asks };
}

function normalise(raw: RawReview, input: OnePagerInput): ProjectOnePagerReview {
  const discarded: string[] = [];
  const byKey = Object.fromEntries(
    ONE_PAGER_FIELDS.map((f) => [f.key, reviewField(f.label, input[f.key], raw[f.key], discarded)])
  ) as Record<OnePagerFieldKey, BriefFieldReview | null>;

  return {
    ...byKey,
    discarded,
    model: null,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const force = body.force === true;

  return handle(async (email): Promise<ProjectOnePagerReview> => {
    const input: OnePagerInput = {
      project_name: str(body.project_name),
      problem_context: str(body.problem_context),
      objective: str(body.objective),
      expected_outcome: str(body.expected_outcome),
      scope: str(body.scope),
      out_of_scope: str(body.out_of_scope),
      success_metrics: str(body.success_metrics),
    };

    const empty: ProjectOnePagerReview = {
      problem_context: null,
      objective: null,
      expected_outcome: null,
      scope: null,
      out_of_scope: null,
      success_metrics: null,
      discarded: [],
      model: null,
    };

    // Nothing written is not a review request — it is a blank page, and the honest answer is to
    // say so rather than to spend a request having a model imagine a project.
    const hasContent = ONE_PAGER_FIELDS.some((f) => input[f.key]);
    if (!hasContent) {
      return {
        ...empty,
        unavailable: "Write something first — even a rough sentence. There is nothing here to make clearer yet.",
      };
    }

    if (!isAiConfigured()) {
      return { ...empty, unavailable: "Set AI_API_KEY to have the one-pager reviewed." };
    }

    // Keyed on the exact text. Pressing Review twice on unchanged wording costs no AI request,
    // which is what makes it safe to press while you think.
    const version = sourceVersion(input);
    // A one-pager being written for a project that does not exist yet still gets a cache entry;
    // it is keyed by the text, so "draft" collides with nothing that matters.
    const entityId = str(body.project_id) || "draft";

    if (!force) {
      const cached = await getCachedInsight<ProjectOnePagerReview>(
        email,
        "project_tracking_one_pager_review",
        entityId,
        version
      );
      if (cached) {
        return { ...cached.content, model: cached.model, generatedAt: cached.generated_at, fromCache: true };
      }
    }

    const raw = await chatJson<RawReview>(buildPrompt(input), {
      // "normal" register, always — this output goes into a document other people read to
      // understand scope, not a message addressed to her. See work/projects/review's own note.
      systemPrompt: voicedSystemPrompt(FEATURE_INSTRUCTIONS, "normal"),
      // Editing, not writing. The same text reviewed twice should come back with the same edit.
      temperature: 0.2,
      maxTokens: 1200,
      // Rewriting is the canonical `fast`-tier job.
      tier: "fast",
    });

    const review = normalise(raw, input);
    const model = getAiModel("fast");
    // Cached AFTER sanitising, so a discarded suggestion stays discarded on the next press rather
    // than being re-derived from a stored raw response.
    await saveInsight(email, "project_tracking_one_pager_review", entityId, version, review, model);

    return { ...review, model, generatedAt: new Date().toISOString(), fromCache: false };
  });
}

export function GET() {
  // A review costs an AI call, so it is an explicit action rather than something a page load,
  // a prefetch or an autosave can trigger.
  return NextResponse.json({ ok: false, error: "Use POST to review a one-pager." }, { status: 405 });
}
