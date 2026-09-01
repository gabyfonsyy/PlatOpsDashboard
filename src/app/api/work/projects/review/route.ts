import { NextResponse } from "next/server";
import { handle } from "@/lib/work-route";
import { chatJson, getAiModel, isAiConfigured } from "@/lib/ai";
import { voicedSystemPrompt } from "@/lib/ai-voice";
import { getCachedInsight, saveInsight, sourceVersion } from "@/lib/work-store";
import {
  BRIEF_PROMPTS,
  inventsFigures,
  type BriefListReview,
  type BriefMetricReview,
  type BriefFieldReview,
  type BriefReview,
} from "@/lib/work";

/**
 * Reviews a project brief — Problem, Outcome, Success metric, Explicitly out — and returns a
 * clearer version of each, as a SUGGESTION she accepts or ignores field by field.
 *
 * ── The one rule everything else follows ──────────────────────────────────────────────────────
 * The model may make what she wrote clearer. It may not make it truer.
 *
 * A problem statement is required to carry evidence ("needs a number, or something someone else
 * can confirm"), and a model asked to improve a vague one will happily supply a beautifully
 * specific figure that came from nowhere. That is not merely a worse suggestion — it is a
 * categorically more dangerous one, because the result READS as rigorous and is fiction, and in
 * six weeks nobody can remember which numbers were measured and which were generated. So:
 *
 *   1. The prompt forbids new facts, figures, names and dates, and redirects the impulse into an
 *      `asks` list — "you haven't said how long the wait actually is" instead of "3.2 days".
 *   2. `stripInventedFigures` enforces it AFTERWARDS, mechanically. A prompt is a request; this
 *      one matters too much to be left as one. Same discipline as sanitizeRecommendations_ in
 *      gas/Insights.gs: the model owns the wording, never the evidence.
 *   3. Anything it discards is REPORTED (`discarded`), not swallowed. A field that silently loses
 *      its suggestion looks like a model with no opinion, rather than one that was disqualified.
 *
 * ── No voice layer ────────────────────────────────────────────────────────────────────────────
 * Passed through voicedSystemPrompt at "normal" deliberately, for the reason set out in
 * NOTE_ON_INCIDENT_FEEDBACK: everything else the AI writes here is addressed to Gaby about her
 * own work, but this output goes INTO a document with an audience — the brief names an owner,
 * states what is out of scope, and exists to be read by the people who will otherwise assume
 * otherwise. A playfully-worded scope boundary is a scope boundary that gets argued with.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────────────────────
 * Button-only, `fast` tier, cached against a hash of the exact four fields. Re-reviewing text that
 * has not changed costs nothing, which also makes "Review" safe to press twice.
 */

const FEATURE_INSTRUCTIONS = [
  "TASK: you are editing a project brief. Six questions, four of which you are reviewing.",
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
  "- Never state as fact anything you inferred. If the problem does not say who is affected, do not",
  "  decide who is affected.",
  "- An empty field stays empty. Return '' for 'revised' and put the question in 'asks'. Writing a",
  "  plausible problem statement for a blank box is the worst thing you can do here.",
  "",
  "WHAT EACH FIELD IS FOR:",
  `- Problem: ${BRIEF_PROMPTS.problem.ask} ${BRIEF_PROMPTS.problem.rule}`,
  `- Outcome: ${BRIEF_PROMPTS.outcome.ask} ${BRIEF_PROMPTS.outcome.rule}`,
  `- Success metric: ${BRIEF_PROMPTS.metric.ask} ${BRIEF_PROMPTS.metric.rule}`,
  `- Explicitly out: ${BRIEF_PROMPTS.explicitlyOut.ask} ${BRIEF_PROMPTS.explicitlyOut.rule}`,
  "",
  "SPECIFIC GUIDANCE:",
  "- Problem: strip the solution back out of it. A problem statement that names the fix has already",
  "  stopped being a problem statement. Keep the evidence exactly as written.",
  "- Outcome: rewrite from the point of view of whoever benefits, in the present tense, as something",
  "  they can notice. 'An SE knows the same day whether it passed', not 'improve review turnaround'.",
  "- Success metric: reword only. Baseline, target and by-when are measurements and commitments —",
  "  if one is empty it stays empty and you ask for it.",
  "- Explicitly out: sharpen her exclusions in 'items'. Put any exclusion you think people will",
  "  assume, that she has not written, in 'suggested' — never in 'items'. Scope is hers to decide.",
  "- 'why' is one short sentence about what you changed and what it buys. Not a compliment.",
  "- 'asks' is a list of short direct questions, only where something is genuinely missing. Empty",
  "  list when nothing is.",
  "",
  "Respond with a JSON object only.",
].join("\n");

type RawReview = {
  problem?: unknown;
  outcome?: unknown;
  metric?: unknown;
  explicitly_out?: unknown;
};

type BriefInput = {
  name: string;
  problem: string;
  outcome: string;
  metric_baseline: string;
  metric_target: string;
  metric_by_when: string;
  explicitly_out: string[];
};

function buildPrompt(brief: BriefInput): string {
  return [
    "Review this project brief.",
    "",
    'Return JSON: { "problem": Field, "outcome": Field, "metric": Metric, "explicitly_out": List }',
    "",
    '  Field  = { "revised": string, "why": string, "asks": string[] }',
    '  Metric = { "baseline": string, "target": string, "by_when": string, "why": string, "asks": string[] }',
    '  List   = { "items": string[], "suggested": string[], "why": string, "asks": string[] }',
    "",
    "Every key must be present. Use \"\" and [] rather than null or omitting a key.",
    "",
    "THE BRIEF:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 6) : [];

/**
 * The guard, applied after the model has answered.
 *
 * Compares every figure in the suggestion against the text it was given. A figure that was not
 * already there is invented evidence, and the whole suggestion for that field is dropped — not
 * patched, because a sentence built around a fabricated number does not survive having the number
 * removed. The field name is returned so the panel can say what happened.
 */
function stripInventedFigures<T extends { why: string }>(
  field: string,
  source: string,
  suggestionText: string,
  suggestion: T | null,
  discarded: string[]
): T | null {
  if (!suggestion) return null;
  if (inventsFigures(source, suggestionText)) {
    discarded.push(field);
    return null;
  }
  return suggestion;
}

function normalise(raw: RawReview, brief: BriefInput): BriefReview {
  const discarded: string[] = [];

  const field = (v: unknown): BriefFieldReview | null => {
    const rec = (v ?? {}) as Record<string, unknown>;
    const revised = str(rec.revised);
    const asks = list(rec.asks);
    // A suggestion with neither a rewrite nor a question is nothing at all; dropping it stops the
    // panel rendering an empty box under a field the model had no view on.
    if (!revised && asks.length === 0) return null;
    return { revised, why: str(rec.why), asks };
  };

  const metricRaw = (raw.metric ?? {}) as Record<string, unknown>;
  const metricAsks = list(metricRaw.asks);
  const metric: BriefMetricReview | null =
    str(metricRaw.baseline) || str(metricRaw.target) || str(metricRaw.by_when) || metricAsks.length
      ? {
          baseline: str(metricRaw.baseline),
          target: str(metricRaw.target),
          by_when: str(metricRaw.by_when),
          why: str(metricRaw.why),
          asks: metricAsks,
        }
      : null;

  const outRaw = (raw.explicitly_out ?? {}) as Record<string, unknown>;
  const outItems = list(outRaw.items);
  const outSuggested = list(outRaw.suggested);
  const explicitlyOut: BriefListReview | null =
    outItems.length || outSuggested.length || list(outRaw.asks).length
      ? {
          items: outItems,
          suggested: outSuggested,
          why: str(outRaw.why),
          asks: list(outRaw.asks),
        }
      : null;

  const metricSource = [brief.metric_baseline, brief.metric_target, brief.metric_by_when].join(" ");

  return {
    problem: stripInventedFigures(
      BRIEF_PROMPTS.problem.label,
      brief.problem,
      str((raw.problem as Record<string, unknown>)?.revised),
      field(raw.problem),
      discarded
    ),
    outcome: stripInventedFigures(
      BRIEF_PROMPTS.outcome.label,
      brief.outcome,
      str((raw.outcome as Record<string, unknown>)?.revised),
      field(raw.outcome),
      discarded
    ),
    metric: stripInventedFigures(
      BRIEF_PROMPTS.metric.label,
      metricSource,
      metric ? [metric.baseline, metric.target, metric.by_when].join(" ") : "",
      metric,
      discarded
    ),
    // Suggested exclusions are checked against the whole brief, not just her exclusion list: a new
    // exclusion legitimately refers to things named in the problem or the outcome.
    explicitly_out: stripInventedFigures(
      BRIEF_PROMPTS.explicitlyOut.label,
      [brief.problem, brief.outcome, metricSource, brief.explicitly_out.join(" ")].join(" "),
      explicitlyOut ? [...explicitlyOut.items, ...explicitlyOut.suggested].join(" ") : "",
      explicitlyOut,
      discarded
    ),
    discarded,
    model: null,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const force = body.force === true;

  return handle(async (email): Promise<BriefReview> => {
    const brief: BriefInput = {
      name: str(body.name),
      problem: str(body.problem),
      outcome: str(body.outcome),
      metric_baseline: str(body.metric_baseline),
      metric_target: str(body.metric_target),
      metric_by_when: str(body.metric_by_when),
      explicitly_out: list(body.explicitly_out),
    };

    const empty: BriefReview = {
      problem: null,
      outcome: null,
      metric: null,
      explicitly_out: null,
      discarded: [],
      model: null,
    };

    // Nothing written is not a review request — it is a blank page, and the honest answer is to
    // say so rather than to spend a request having a model imagine a project.
    if (!brief.problem && !brief.outcome && !brief.metric_target && brief.explicitly_out.length === 0) {
      return {
        ...empty,
        unavailable: "Write something first — even a rough sentence. There is nothing here to make clearer yet.",
      };
    }

    if (!isAiConfigured()) {
      return { ...empty, unavailable: "Set AI_API_KEY to have the brief reviewed." };
    }

    // Keyed on the exact text. Pressing Review twice on unchanged wording costs no AI request,
    // which is what makes it safe to press while you think.
    const version = sourceVersion(brief);
    // A brief being written for a project that does not exist yet still gets a cache entry; it is
    // keyed by the text, so "draft" collides with nothing that matters.
    const entityId = str(body.project_id) || "draft";

    if (!force) {
      const cached = await getCachedInsight<BriefReview>(
        email,
        "project_brief_review",
        entityId,
        version
      );
      if (cached) {
        return { ...cached.content, model: cached.model, generatedAt: cached.generated_at, fromCache: true };
      }
    }

    const raw = await chatJson<RawReview>(buildPrompt(brief), {
      // "normal" register, always. See the note at the top of this file.
      systemPrompt: voicedSystemPrompt(FEATURE_INSTRUCTIONS, "normal"),
      // Editing, not writing. The same brief reviewed twice should come back with the same edit.
      temperature: 0.2,
      maxTokens: 1000,
      // Rewriting is the canonical `fast`-tier job, and the measured difference on this kind of
      // task is not worth the deep tier's rate-limit footprint.
      tier: "fast",
    });

    const review = normalise(raw, brief);
    const model = getAiModel("fast");
    // Cached AFTER sanitising, so a discarded suggestion stays discarded on the next press rather
    // than being re-derived from a stored raw response.
    await saveInsight(email, "project_brief_review", entityId, version, review, model);

    return { ...review, model, generatedAt: new Date().toISOString(), fromCache: false };
  });
}

export function GET() {
  // A review costs an AI call, so it is an explicit action rather than something a page load,
  // a prefetch or an autosave can trigger.
  return NextResponse.json({ ok: false, error: "Use POST to review a brief." }, { status: 405 });
}
