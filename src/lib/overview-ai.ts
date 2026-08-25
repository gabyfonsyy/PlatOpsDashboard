import { chatJson, getAiModel } from "@/lib/ai";
import { voicedSystemPrompt, type VoiceMode } from "@/lib/ai-voice";
import { getSupabaseClient } from "@/lib/supabase";
import type { ModuleKey, OverviewData } from "@/lib/overview";

/**
 * The Overview's daily management briefing — the one place on this dashboard where a model is
 * asked to look ACROSS modules rather than at one metric.
 *
 * ── Why cross-module matters more than the prose ───────────────────────────────────────────────
 * Every other AI surface here reads one module and describes it. That is why they are safe, and
 * also why they cannot answer the question this page exists for. A team's throughput dropping is
 * not a finding on its own: it is a finding if nobody was on leave, and it is an explanation if
 * three people were. Handed only the throughput number, a model states the wrong one confidently.
 * So the payload deliberately carries the coverage facts NEXT TO the delivery facts, and the
 * instructions make correlating them the job.
 *
 * ── Two registers, one analysis ────────────────────────────────────────────────────────────────
 * Professional and Gaby mode share BRIEFING_INSTRUCTIONS byte for byte. The only thing that
 * differs is the voice layer composed on top by voicedSystemPrompt — which is the whole point of
 * lib/ai-voice.ts: feature prompts say what to analyse and never how to talk. That is what makes
 * "same conclusions, different presentation" structural rather than a hope.
 *
 * It is not a guarantee, though, and it should not be sold as one: the two registers are two
 * separate generations, so wording can differ and a borderline judgement could land differently.
 * The alternative — one generation restyled by a second call — costs the same and adds a way for
 * the restyle to quietly drop a finding. Snapshots are therefore cached per (date, voice), so a
 * given day in a given mode is generated once and then fixed.
 *
 * ── Spend ──────────────────────────────────────────────────────────────────────────────────────
 * Once per calendar day per person per register, keyed in ai_insight_cache. The generate route
 * refuses to spend a request when a snapshot already exists unless forced, so the ceiling is two
 * requests a day even if the page is opened a hundred times.
 *
 * 'deep' tier, and the only feature besides Work Mirror that gets it: separating a people problem
 * from a process problem from a system problem, while holding coverage, delivery and personal
 * workload in mind at once, is exactly the multi-variable reasoning the small model is bad at.
 */

export const BRIEFING_CONTEXT = "overview_briefing";

export type BriefingUrgency = "urgent" | "monitor";

export type PriorityItem = {
  title: string;
  /** What is happening. */
  what: string;
  /** Why it matters. */
  why: string;
  urgency: BriefingUrgency;
  action: string;
  module?: ModuleKey;
};

export type BriefingNote = {
  /** May be empty — some responses carry only a sentence, and the UI renders detail alone. */
  title: string;
  detail: string;
  module?: ModuleKey;
};

/**
 * Every prose section is allowed to be an empty string and every list an empty array. That is not
 * a degraded result — "there is not enough evidence to say" is a required answer here, and the UI
 * omits an empty section rather than rendering a heading over nothing.
 */
export type BriefingContent = {
  headline: string;
  priorityAttention: PriorityItem[];
  myDay: string;
  teamPulse: string;
  systemPulse: string;
  sustainableMomentum: string;
  keepAnEyeOn: BriefingNote[];
  noIntervention: string[];
  recommendedFocus: string[];
};

export type OverviewBriefing = BriefingContent & {
  generatedAt: string;
  model: string | null;
  /** The Manila date this snapshot describes. */
  date: string;
  voice: VoiceMode;
};

/**
 * The analysis brief. Identical in both registers — see the note at the top of this file.
 *
 * The management philosophy in here is not decoration and is not meant to be quoted back at the
 * reader. It is a diagnostic instruction: without it, a model handed "escalations are up" reliably
 * concludes that someone should be more careful, which is both the least useful answer available
 * and the one most likely to damage a real person.
 */
const BRIEFING_INSTRUCTIONS = [
  "TASK: write the daily management briefing for an Engineering Lead who runs Platform Operations",
  "and Support Engineering. They will spend about 60 seconds on it and then go and do something.",
  "",
  "HOW TO THINK ABOUT PROBLEMS — this governs the whole analysis:",
  "  Optimise the SYSTEM, not the person. Work has to get done, but the system should not depend",
  "  on unsustainable effort. Passion and determination keep a team going; the leadership question",
  "  is how to help them sustain that without individual heroics.",
  "",
  "  So before calling anything an execution problem, work through: is this a process problem? a",
  "  capacity constraint? unevenly distributed work? unclear ownership or a messy handoff?",
  "  inadequate tooling? recurring manual work that could be automated? a dependency bottleneck?",
  "  missing documentation or training? the same issue recurring despite real individual effort?",
  "  someone quietly compensating for a weakness in the system?",
  "",
  "  Individual accountability still exists. But distinguish SOMEONE FAILING WITHIN A HEALTHY",
  "  SYSTEM from SOMEONE COMPENSATING FOR AN UNHEALTHY ONE — they look identical in the numbers",
  "  and need opposite responses. When an issue recurs, fix the system, not the person.",
  "  Never recommend 'work harder', 'be more careful', 'remind the team' or any other",
  "  individual-effort fix where a systemic one is available. Always ask: how do we make this",
  "  easier, more reliable, or more sustainable next time?",
  "",
  "RESPOND WITH A JSON OBJECT ONLY:",
  "{",
  '  "headline": "...",',
  '  "priorityAttention": [{"title": "...", "what": "...", "why": "...",',
  '                        "urgency": "urgent|monitor", "action": "...", "module": "<module key>"}],',
  '  "myDay": "...", "teamPulse": "...", "systemPulse": "...", "sustainableMomentum": "...",',
  '  "keepAnEyeOn": [{"title": "...", "detail": "...", "module": "<module key>"}],',
  '  "noIntervention": ["...", "..."],',
  '  "recommendedFocus": ["...", "..."]',
  "}",
  "Module keys: my-work, team-stats, leave, rto, projects, incidents, ticket-monitoring.",
  "",
  "headline — one or two sentences. Whether things are broadly stable, then what is not. No",
  "  greeting and no name; the page adds those. Say 'stable' only if the data supports it.",
  "",
  "priorityAttention — the 1-3 things most deserving of attention today. Fewer is fine; an empty",
  "  array on a quiet day is a real answer.",
  "  EVERY item MUST have ALL SIX fields: title, what, why, urgency, action, module.",
  '  `urgency` MUST be exactly the string "urgent" or exactly "monitor" — no other wording.',
  "  Use \"urgent\" for act-today and \"monitor\" for worth-watching; getting that split right is",
  "  most of this section's value. `title` is a short noun phrase naming the item. `what` is what",
  "  is happening, `why` is why it matters, `action` names a specific thing to do.",
  "  Prioritise actions over metrics.",
  "",
  "myDay — what deserves priority in the reader's OWN work. Do not restate the task list; the page",
  "  already lists it. Name what should be done first, what is overdue, and anything that looks",
  "  like a forgotten commitment. Empty string if there is nothing worth saying.",
  "",
  "teamPulse — meaningful changes in team activity and workload. CHECK CONTEXT BEFORE INTERPRETING",
  "  A CHANGE NEGATIVELY. If output dropped while people were on leave, that is the explanation,",
  "  not a performance finding, and saying otherwise is the worst mistake available here. If one",
  "  person carries far more than the others, name the PATTERN without labelling anyone a high",
  "  performer or an underperformer.",
  "",
  "systemPulse — how well the system lets the team work. Recurring operational problems, repeated",
  "  incidents, manual processes, bottlenecks, dependencies, excessive handoffs, repeated ticket",
  "  categories, work that keeps needing escalation. Where you can, say plainly whether something",
  "  is a people problem, a process problem or a system problem. Prioritise the systemic",
  "  opportunity when the same thing keeps needing manual intervention.",
  "",
  "sustainableMomentum — is performance being sustained by a healthy system or by excessive",
  "  individual effort? Signals: persistent workload increases, uneven distribution, frequent",
  "  escalations, repeated firefighting, dependence on specific people, recurring manual",
  "  intervention, more work without process improvement. High workload is NOT poor performance,",
  "  and high individual output is NOT automatically healthy. The question is whether this can be",
  "  maintained without unsustainable effort. IF THE DATA CANNOT ANSWER THAT, SAY SO EXPLICITLY —",
  "  this dashboard has no after-hours or time-tracking data on the team, so admit that limit",
  "  rather than inferring around it.",
  "",
  "keepAnEyeOn — emerging patterns that are NOT yet problems. A metric drifting, a recurring",
  "  incident type, rising volume, work concentrating on a few people, a process needing ever more",
  "  intervention. Early detection, not alarm. Empty array when nothing qualifies.",
  "  EVERY item MUST be an OBJECT with `title` and `detail`. Never a bare string.",
  "",
  "noIntervention — what is healthy and does NOT need the reader today. This section matters: it",
  "  is what stops unnecessary checking. One short statement each, and only ones the data",
  "  supports. Never invent reassurance.",
  "",
  "recommendedFocus — the 1-3 highest-LEVERAGE actions, favouring: reducing operational risk,",
  "  removing blockers, improving the system, protecting sustainable performance, moving important",
  "  work forward. Never invent work to fill capacity. 'No intervention needed — let the team",
  "  continue' is a valid and sometimes correct answer.",
  "",
  "ABSOLUTE RULES:",
  "- Use ONLY the numbers in the data. Never invent, estimate or round one that is not there, and",
  "  never invent a trend or a causal link.",
  "- A module listed as not connected has NO data. It is not zero, not healthy, not a risk. Say",
  "  nothing about it at all.",
  "- Do not repeat a dashboard number without saying what it means — the page already shows it.",
  "- Do not turn every anomaly into a problem, and do not recommend intervening where watching is",
  "  enough.",
  "- Do not diagnose an individual's performance from this much data.",
  "- Plain prose in the prose fields. No markdown, no bullet characters, no headings.",
].join("\n");

/**
 * Exactly what the model sees. Compact and pre-computed — no raw rows, both for tokens and so
 * there is nothing in the payload it could misread into a ticket-level claim.
 *
 * `coverage` sits alongside `delivery` on purpose: adjacency in the payload is what makes the
 * correlation available at all. `dataLimits` is stated explicitly because a model asked about
 * sustainability with no hours data will otherwise infer it from throughput.
 */
function buildPayload(data: OverviewData) {
  return {
    date: data.today,
    delivery: data.pulse.teams.map((t) => ({
      team: t.name,
      resolvedThisMonth: t.resolvedInPeriod,
      resolvedLastMonth: t.previousResolved,
      escalationRate: t.escalationRate,
      backlogAgingRate: t.backlogAgingRate,
      flaggedPeople: (t.insight?.flags ?? []).map((f) => ({ who: f.employee, why: f.detail })),
      systemOpportunities: (t.insight?.recommendations ?? []).map((r) => ({
        title: r.title,
        category: r.category,
        evidence: r.evidence,
        proposedAction: r.action,
      })),
    })),
    coverage: {
      available: data.pulse.leaveAvailable,
      onLeaveToday: data.pulse.onLeaveToday.map((p) => ({
        who: p.name,
        team: p.team,
        type: p.type,
        halfDay: p.halfDay || null,
      })),
      inOfficeToday: data.pulse.rtoAvailable
        ? data.pulse.inOfficeToday.map((p) => ({ who: p.name, team: p.team }))
        : null,
    },
    myWork: {
      workdayStarted: data.myDay.workdayOpen,
      openTasksToday: data.myDay.openTasks,
      completedToday: data.myDay.doneToday,
      overdueFromEarlier: data.myDay.overdueCount,
      focusTasks: data.myDay.focusTasks.filter((t) => !t.done).map((t) => t.title),
      projectTasksToday: data.myDay.projectTasks.map((t) => `${t.project}: ${t.title}`),
      workdayLogsNeedingCorrection: data.myDay.daysNeedingReview,
    },
    attentionAlreadyOnScreen: data.attention.map((a) => ({ title: a.title, why: a.why })),
    modulesNotYetConnected: data.planned.map((m) => m.label),
    dataLimits: [
      "No after-hours, overtime or per-person hours data exists for the team — only the reader's own workday log.",
      "Ticket-level detail, incidents and project milestones are not in this payload.",
      data.pulse.leaveAvailable ? null : "Leave could not be read today.",
      data.pulse.rtoAvailable ? null : "RTO could not be read today.",
    ].filter(Boolean),
  };
}

/**
 * Short, stable fingerprint of the payload. Not what decides whether to regenerate — the date does
 * that — but stored so two snapshots on the same day are distinguishable, and so a later "has
 * anything actually changed since this morning?" check has something to compare against.
 */
export function briefingVersion(data: OverviewData): string {
  const json = JSON.stringify(buildPayload(data));
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${json.length.toString(16)}`;
}

/** Snapshots are per day AND per register. See the note at the top of this file. */
function entityId(date: string, voice: VoiceMode): string {
  return `${date}:${voice}`;
}

/**
 * Today's snapshot in this register, or null. Never generates, never throws — the Overview renders
 * with an empty briefing rather than failing, because a broken cache must not take down the page
 * you check when something is already wrong.
 */
export async function getBriefing(
  email: string,
  date: string,
  voice: VoiceMode
): Promise<OverviewBriefing | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("ai_insight_cache")
      .select("content_json,model_used,generated_at")
      .eq("user_email", email)
      .eq("context", BRIEFING_CONTEXT)
      .eq("entity_id", entityId(date, voice))
      // Newest wins: a manual refresh writes a second row for the day under a different
      // source_version rather than overwriting, so the day's history is not destroyed.
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const content = data.content_json as Partial<BriefingContent> | null;
    if (!content || typeof content.headline !== "string") return null;

    return {
      ...normalise(content),
      generatedAt: String(data.generated_at),
      model: (data.model_used as string | null) ?? null,
      date,
      voice,
    };
  } catch {
    return null;
  }
}

/** Best-effort write — a failed cache write must not fail the analysis just paid for. */
async function saveBriefing(
  email: string,
  date: string,
  voice: VoiceMode,
  version: string,
  content: BriefingContent,
  model: string
): Promise<void> {
  try {
    await getSupabaseClient()
      .from("ai_insight_cache")
      .upsert(
        {
          user_email: email,
          context: BRIEFING_CONTEXT,
          entity_id: entityId(date, voice),
          source_version: version,
          content_json: content,
          model_used: model,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_email,context,entity_id,source_version" }
      );
  } catch {
    // Intentionally swallowed.
  }
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Urgency, from whatever the model actually wrote.
 *
 * Observed 2026-08-25: asked for "urgent" it returned "act today", and for "monitor" it returned
 * "worth watching" — both perfectly correct answers to the prose and both outside the enum. The
 * prompt now states the literals, and this copes anyway: an unrecognised value falls to `monitor`,
 * so a wording slip can only ever UNDER-state urgency, never invent it.
 */
function toUrgency(value: unknown): BriefingUrgency {
  const v = text(value).toLowerCase();
  if (v === "urgent" || v.includes("act") || v.includes("today") || v.includes("now")) return "urgent";
  return "monitor";
}

/**
 * Coerces whatever came back into the shape the UI renders.
 *
 * Anything malformed is DROPPED rather than patched up with a placeholder: a row with an empty
 * title renders as a broken card, and a broken card on the page you open to check whether
 * anything is wrong is worse than one fewer row.
 */
function normalise(raw: Partial<BriefingContent> | Record<string, unknown>): BriefingContent {
  const r = raw as Record<string, unknown>;
  return {
    headline: text(r.headline),
    // `action` is the only genuinely required field: an attention item with nothing to do is a
    // metric, and this section is explicitly not that. Everything else degrades — a missing title
    // borrows `what`, because dropping a real finding over a missing label would be the worse
    // failure, and this is formatting rather than invention.
    priorityAttention: list(r.priorityAttention)
      .map((x) => x as Record<string, unknown>)
      .filter((x) => x && text(x.action) && (text(x.title) || text(x.what)))
      .slice(0, 3)
      .map((x) => ({
        title: text(x.title) || text(x.what),
        what: text(x.title) ? text(x.what) : "",
        why: text(x.why),
        urgency: toUrgency(x.urgency),
        action: text(x.action),
        module: typeof x.module === "string" ? (x.module as ModuleKey) : undefined,
      })),
    myDay: text(r.myDay),
    teamPulse: text(r.teamPulse),
    systemPulse: text(r.systemPulse),
    sustainableMomentum: text(r.sustainableMomentum),
    // Accepts a bare string as well as the documented object — observed coming back both ways.
    // A string becomes the detail with no title; the UI renders a title only when there is one.
    keepAnEyeOn: list(r.keepAnEyeOn)
      .map((x) => (typeof x === "string" ? { title: "", detail: x } : (x as Record<string, unknown>)))
      .filter((x) => x && (text(x.title) || text(x.detail)))
      .slice(0, 5)
      .map((x) => ({
        title: text(x.title),
        detail: text(x.detail) || text(x.title),
        module: typeof x.module === "string" ? (x.module as ModuleKey) : undefined,
      })),
    noIntervention: list(r.noIntervention).map(text).filter(Boolean).slice(0, 6),
    recommendedFocus: list(r.recommendedFocus).map(text).filter(Boolean).slice(0, 3),
  };
}

export async function generateBriefing(
  email: string,
  data: OverviewData,
  voice: VoiceMode
): Promise<OverviewBriefing> {
  const model = getAiModel("deep");

  const answer = await chatJson<Record<string, unknown>>(
    ["DATA:", JSON.stringify(buildPayload(data))].join("\n"),
    {
      systemPrompt: voicedSystemPrompt(BRIEFING_INSTRUCTIONS, voice),
      tier: "deep",
      maxTokens: 2400,
    }
  );

  const content = normalise(answer);
  if (!content.headline) throw new Error("The assessment came back without a summary.");

  await saveBriefing(email, data.today, voice, briefingVersion(data), content, model);

  return { ...content, generatedAt: new Date().toISOString(), model, date: data.today, voice };
}
