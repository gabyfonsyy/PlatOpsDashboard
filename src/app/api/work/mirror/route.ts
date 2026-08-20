import { NextResponse } from "next/server";
import { handle } from "@/lib/work-route";
import { chatJson, getAiModel, isAiConfigured } from "@/lib/ai";
import { isVoiceMode, voicedSystemPrompt, type VoiceMode } from "@/lib/ai-voice";
import { getCachedMirror, getMyWork, saveMirror, sourceVersion } from "@/lib/work-store";
import {
  factorLabel,
  moodByCode,
  type MirrorObservation,
  type WorkDayStat,
  type WorkMirrorResult,
} from "@/lib/work";

/**
 * Work Mirror — a quiet observer, not a coach and not a chatbot.
 *
 * Two rules shape the whole thing:
 *
 *  1. The MODEL NEVER COMPUTES. Every number it sees is calculated deterministically below and
 *     handed over as a labelled fact. The model's only job is to say which of those facts sit
 *     together often enough to be worth noticing. This is the same discipline gas/Insights.gs
 *     uses, and it's what makes an observation checkable rather than plausible-sounding.
 *  2. Pattern and interpretation are SEPARATE FIELDS. A correlation across a dozen days is not a
 *     cause, and the shape of the response makes it structurally hard to pretend otherwise — the
 *     UI renders the pattern as the claim and the interpretation as a hedge, visibly distinct.
 *
 * It also refuses to speak when there isn't enough history. Three days of data will produce
 * confident-sounding nonsense from any model, and this is data about someone's working life.
 */

/** Below this, there is no pattern to find — only noise to dress up. */
const MIN_DAYS = 5;

/**
 * What this feature does — the tone comes from lib/ai-voice.ts and is composed on top. Anything
 * about personality belongs there, not here; anything about Work Mirror's job belongs here.
 *
 * Of everything the AI writes, this is the most reflective surface: it's looking at weeks of
 * someone's own working life and saying what it notices. So the instruction is to sound like a
 * person who spotted something, not a report.
 */
const FEATURE_INSTRUCTIONS = [
  "TASK: you're looking at Gaby's own work-tracking data and telling her what you notice in it.",
  "",
  "This is the reflective surface of the dashboard. Sound like someone who spotted something and",
  "mentioned it — 'you've been touching a lot of projects this week, but you're not actually",
  "finishing more' — not like an analysis being delivered.",
  "",
  "SPECIFIC TO THIS FEATURE:",
  "- Use ONLY the numbers provided. They're already computed; your job is noticing which ones sit",
  "  together, not calculating anything.",
  "- Reference actual figures in the pattern so it can be checked against the data.",
  "- If a pattern rests on very few days, say so inside the pattern text rather than overstating it.",
  "- The interpretation field is where a cautious 'this might mean…' goes, or null when the pattern",
  "  speaks for itself. Never advice.",
  "- Her own end-of-day notes are in the data. They're the richest signal — if they contradict the",
  "  numbers, that contrast is usually the most interesting thing you can point out.",
  "",
  "Respond with a JSON object only.",
].join("\n");

type Aggregates = ReturnType<typeof aggregate>;

/**
 * Everything the model is allowed to know, computed here. Deliberately a small set of strong
 * signals rather than a dump of every row: a shorter, denser prompt produces observations about
 * the data rather than about the shape of the JSON.
 */
function aggregate(history: WorkDayStat[]) {
  const withMood = history.filter((d) => d.moodWeight !== null);
  const withDuration = history.filter((d) => d.durationMinutes !== null);

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

  // Split by mood so the model can compare the two groups directly instead of eyeballing 30 rows.
  const sortedByMood = [...withMood].sort((a, b) => (b.moodWeight ?? 0) - (a.moodWeight ?? 0));
  const third = Math.max(1, Math.floor(sortedByMood.length / 3));
  const best = sortedByMood.slice(0, third);
  const worst = sortedByMood.slice(-third);

  const profile = (days: WorkDayStat[]) => ({
    dayCount: days.length,
    avgTasksCompleted: round1(mean(days.map((d) => d.tasksCompleted))),
    avgTasksCreated: round1(mean(days.map((d) => d.tasksCreated))),
    avgIncoming: round1(mean(days.map((d) => d.incomingCount))),
    avgWaiting: round1(mean(days.map((d) => d.waitingCount))),
    avgProjectsTouched: round1(mean(days.map((d) => d.projectsTouched))),
    avgDurationMinutes: round1(mean(days.filter((d) => d.durationMinutes !== null).map((d) => d.durationMinutes as number))),
    commonFactors: topFactors(days, 3),
  });

  // Recent vs earlier half — the only way a "getting longer/shorter over time" observation can be
  // grounded in something rather than vibes.
  const chronological = [...history].reverse();
  const mid = Math.floor(chronological.length / 2);

  return {
    daysAnalysed: history.length,
    daysWithMood: withMood.length,
    daysWithDuration: withDuration.length,
    overall: profile(history),
    higherMoodDays: profile(best),
    lowerMoodDays: profile(worst),
    firstHalf: profile(chronological.slice(0, mid)),
    secondHalf: profile(chronological.slice(mid)),
    moodCounts: countBy(history.map((d) => d.mood).filter(Boolean) as string[], (m) => moodByCode(m)?.label ?? m),
    factorCounts: countBy(history.flatMap((d) => d.factors), factorLabel),
    // The reflections are the person's own words about their own days — the richest signal here,
    // and the only free text included.
    recentNotes: history
      .filter((d) => d.note)
      .slice(0, 8)
      .map((d) => ({ date: d.work_date, mood: moodByCode(d.mood ?? "")?.label ?? d.mood, note: d.note })),
  };
}

function topFactors(days: WorkDayStat[], n: number): string[] {
  const counts = countBy(days.flatMap((d) => d.factors), factorLabel);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => `${label} (${count})`);
}

function countBy(values: string[], label: (v: string) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = label(v);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function buildPrompt(agg: Aggregates): string {
  return [
    "This is one person's own work-tracking data for the recent period.",
    "",
    "Report 2-4 patterns you can actually see in these numbers. Prefer fewer, stronger observations",
    "over a full list of weak ones. If the data only supports one, return one.",
    "",
    "Return JSON: { \"observations\": [{ \"pattern\": string, \"interpretation\": string | null }] }",
    "",
    "  pattern        — what the data shows. Reference the actual figures. This must be verifiable",
    "                   against the numbers below.",
    "  interpretation — a cautious 'this might mean...' reading, or null if the pattern speaks for",
    "                   itself. Never advice.",
    "",
    "DATA:",
    JSON.stringify(agg),
  ].join("\n");
}

function sanitize(raw: unknown): MirrorObservation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      const rec = o as Record<string, unknown>;
      const pattern = String(rec?.pattern ?? "").trim();
      const interpretationRaw = String(rec?.interpretation ?? "").trim();
      return {
        pattern,
        // "null" arrives as a literal string from some models; treat it as absent.
        interpretation:
          !interpretationRaw || interpretationRaw.toLowerCase() === "null" ? null : interpretationRaw,
      };
    })
    .filter((o) => o.pattern.length > 0)
    .slice(0, 4);
}

export async function POST(req: Request) {
  // force=true is the explicit "I know it's cached, do it anyway" path, wired to a separate
  // control in the UI so the cheap action and the paying action are never the same button.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const force = body.force === true;
  // Sent by the client from the active theme (see voiceForTheme). Falls back to the plain register
  // rather than assuming personality is wanted.
  const voice: VoiceMode = isVoiceMode(body.voice) ? body.voice : "normal";

  return handle(async (email): Promise<WorkMirrorResult> => {
    const { history, needsSetup } = await getMyWork(email);

    if (needsSetup) {
      return {
        observations: [],
        daysAnalysed: 0,
        model: null,
        notEnoughData: "My Work isn't set up yet — run supabase/my-work.sql first.",
      };
    }

    if (history.length < MIN_DAYS) {
      return {
        observations: [],
        daysAnalysed: history.length,
        model: null,
        notEnoughData: `Needs about ${MIN_DAYS} tracked days before there's a pattern worth reporting — ${history.length} so far.`,
      };
    }

    if (!isAiConfigured()) {
      return {
        observations: [],
        daysAnalysed: history.length,
        model: null,
        notEnoughData: "Set AI_API_KEY to let Work Mirror read your history.",
      };
    }

    const aggregates = aggregate(history);
    // Voice is part of the key: the same numbers in a different register genuinely are a different
    // answer, and serving a plain-register insight to someone in Gaby's View (or vice versa) would
    // look like the mode had silently stopped working.
    const version = sourceVersion({ aggregates, voice });

    // The whole point: if the underlying numbers haven't moved, there is nothing new to observe,
    // so there is no reason to ask. A repeat click costs zero requests.
    if (!force) {
      const cached = await getCachedMirror(email, version);
      if (cached) {
        return {
          observations: cached.observations,
          daysAnalysed: history.length,
          model: cached.model,
          generatedAt: cached.generated_at,
          fromCache: true,
        };
      }
    }

    const result = await chatJson<{ observations?: unknown }>(buildPrompt(aggregates), {
      systemPrompt: voicedSystemPrompt(FEATURE_INSTRUCTIONS, voice),
      // Low: this is reporting, not writing. The same fortnight of data should produce the same
      // observations twice in a row, or they aren't observations.
      temperature: 0.2,
      maxTokens: 800,
      // The one genuinely "deep" task in the app: relating duration, throughput, deferrals,
      // project switching, mood and free-text reflections to each other. The small model produces
      // noticeably shallower correlations here, and this runs rarely enough to afford it.
      tier: "deep",
    });

    const observations = sanitize(result.observations);
    // Cached against a fingerprint of the aggregates, so pressing "Look again" on unchanged data
    // returns the stored answer instead of spending another request. See getCachedMirror.
    await saveMirror(email, version, observations, getAiModel("deep"));

    return {
      observations,
      daysAnalysed: history.length,
      model: getAiModel("deep"),
      generatedAt: new Date().toISOString(),
      fromCache: false,
    };
  });
}

export function GET() {
  // Analysis costs an AI call, so it's an explicit action rather than something a page load or a
  // prefetch can trigger.
  return NextResponse.json(
    { ok: false, error: "Use POST to run an analysis." },
    { status: 405 }
  );
}
