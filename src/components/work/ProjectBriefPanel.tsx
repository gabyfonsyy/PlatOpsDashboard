"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  GripVertical,
  AlertCircle,
  Sparkles,
  Check,
  X,
  HelpCircle,
} from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { QuadrantSelect } from "@/components/work/Quadrant";
import { cn } from "@/lib/utils";
import {
  BRIEF_PROMPTS,
  MEASURE_PHASE,
  MIN_EXPLICITLY_OUT,
  briefGaps,
  newPhaseId,
  type BriefFieldReview,
  type BriefReview,
  type ProjectPhase,
  type Triage,
  type WorkProject,
} from "@/lib/work";

/**
 * The project one-pager, for both creating and editing.
 *
 * One component for both because the questions are the same either way, and a separate "new
 * project" form is how the two drift until the create path is missing whatever was added last.
 *
 * ── Why it asks rather than blocks ────────────────────────────────────────────────────────────
 * Nothing here is mandatory. A brief that cannot be saved half-written means the half-written
 * project gets tracked in a notebook instead, where the app cannot see it — and the questions
 * stop being a thinking tool the moment they become a gate. What the form does instead is refuse
 * to look finished: every unanswered question is named, in the panel and again on the card, so an
 * un-articulated project is visibly un-articulated rather than quietly indistinguishable from a
 * real one.
 *
 * The rule under each field is the point of that field, so it is printed rather than left in a
 * tooltip. "Needs a number, or something someone else can confirm" is the difference between a
 * problem statement and a complaint.
 */
export function ProjectBriefPanel({
  open,
  project,
  initialName,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The project being edited, or null when this is a new one. */
  project: WorkProject | null;
  /** Whatever was typed in the quick-add box, carried into the name field. */
  initialName?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(project?.name ?? initialName ?? "");
  const [triage, setTriage] = useState<Triage>({
    urgent: project?.urgent ?? null,
    important: project?.important ?? null,
  });
  const [problem, setProblem] = useState(project?.problem ?? "");
  const [outcome, setOutcome] = useState(project?.outcome ?? "");
  const [baseline, setBaseline] = useState(project?.metric_baseline ?? "");
  const [target, setTarget] = useState(project?.metric_target ?? "");
  const [byWhen, setByWhen] = useState(project?.metric_by_when ?? "");
  const [out, setOut] = useState<string[]>(
    project?.explicitly_out?.length ? [...project.explicitly_out] : ["", ""]
  );
  const [phases, setPhases] = useState<ProjectPhase[]>(
    project?.phases?.length ? [...project.phases] : [{ id: newPhaseId(), name: "", exit: "" }]
  );
  const [owner, setOwner] = useState(project?.owner ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The AI pass. Suggestions live BESIDE the fields and never in them: nothing the model returns
   * is written into the brief until she presses Use, so a review can be read, disagreed with and
   * thrown away without having overwritten a word she meant to keep.
   */
  const [review, setReview] = useState<BriefReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function runReview(force = false) {
    if (reviewing) return; // guards against a double-click spending two requests
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await fetch("/api/work/projects/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force,
          name,
          problem,
          outcome,
          metric_baseline: baseline,
          metric_target: target,
          metric_by_when: byWhen,
          explicitly_out: out.filter((v) => v.trim()),
          ...(project ? { project_id: project.project_id } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setReview(body.data as BriefReview);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }

  /** Accepting a suggestion also retires it — a card still offering what you just took is noise. */
  function clearSuggestion(key: keyof BriefReview) {
    setReview((r) => (r ? { ...r, [key]: null } : r));
  }

  const draft = {
    problem,
    outcome,
    metric_target: target,
    metric_by_when: byWhen,
    explicitly_out: out,
    phases,
    owner,
  };
  const gaps = briefGaps(draft);
  const hasMeasurePhase = phases.some((p) => p.name.trim() === MEASURE_PHASE.name);

  async function save() {
    const value = name.trim();
    if (!value) {
      setError("A project needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: value,
        ...triage,
        problem,
        outcome,
        metric_baseline: baseline,
        metric_target: target,
        metric_by_when: byWhen,
        explicitly_out: out,
        phases,
        owner,
        ...(project ? { project_id: project.project_id } : {}),
      };
      const res = await fetch("/api/work/projects", {
        method: project ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width="wide"
      title={project ? "Project brief" : "New project"}
      description="One page. If you cannot answer these, that is the finding."
    >
      <div className="flex flex-col gap-6">
        {/* Sits at the top, before the questions, so it reads as "have this looked at" rather than
            as a step in filling the form in. It is never automatic: an AI request on open would
            fire on every project she glances at, and the answer to unchanged text is cached
            anyway, so the button is both the cost boundary and the intent. */}
        <div className="flex flex-wrap items-center gap-3 -mb-1">
          <button
            onClick={() => runReview(false)}
            disabled={reviewing}
            className="btn-secondary py-1.5 px-3 text-xs"
          >
            <Sparkles className={cn("w-3.5 h-3.5", reviewing && "animate-pulse")} />
            {reviewing ? "Reading it…" : review ? "Review again" : "Review"}
          </button>
          <p className="text-[11px] text-neutral-400 flex-1 min-w-[14rem]">
            Suggests clearer wording for Problem, Outcome, Success metric and Explicitly out. It
            cannot add facts — anything it needs from you comes back as a question.
          </p>
          {review?.fromCache && (
            <button
              onClick={() => runReview(true)}
              className="text-[11px] text-neutral-400 hover:text-sprout-700 transition-colors"
              title="This answer was cached because the text hasn't changed. Ask again anyway."
            >
              Unchanged since last review · ask again
            </button>
          )}
        </div>

        {reviewError && <p className="text-xs text-red-600 -mb-2">{reviewError}</p>}
        {review?.unavailable && <p className="text-xs text-neutral-500 -mb-2">{review.unavailable}</p>}
        {review && review.discarded.length > 0 && (
          <p className="text-xs text-amber-600 flex items-start gap-2 -mb-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Discarded the suggestion for {review.discarded.join(" and ")}: it introduced a figure
              that wasn&apos;t in what you wrote. Numbers here have to be measured, not drafted.
            </span>
          </p>
        )}

        <Field label="Name">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What it is called"
              className="form-input flex-1 min-w-[12rem]"
              aria-label="Project name"
            />
            <QuadrantSelect
              value={triage}
              onChange={setTriage}
              size="md"
              label="Quadrant for this project"
            />
          </div>
        </Field>

        <Field {...BRIEF_PROMPTS.problem}>
          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={3}
            placeholder="Reviews are waiting 3.2 days on average; four SEs raised it in the last retro."
            className="form-input text-sm w-full"
            aria-label="Problem"
          />
          <Suggestion
            review={review?.problem ?? null}
            current={problem}
            onUse={(v) => setProblem(v)}
            onDismiss={() => clearSuggestion("problem")}
          />
        </Field>

        <Field {...BRIEF_PROMPTS.outcome}>
          <textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={3}
            placeholder="An SE who submits for review knows the same day whether it passed."
            className="form-input text-sm w-full"
            aria-label="Outcome"
          />
          <Suggestion
            review={review?.outcome ?? null}
            current={outcome}
            onUse={(v) => setOutcome(v)}
            onDismiss={() => clearSuggestion("outcome")}
          />
        </Field>

        <Field {...BRIEF_PROMPTS.metric}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <LabelledInput
              label="Baseline"
              value={baseline}
              onChange={setBaseline}
              placeholder="3.2 days"
            />
            <LabelledInput label="Target" value={target} onChange={setTarget} placeholder="< 1 day" />
            <LabelledInput
              label="By when"
              value={byWhen}
              onChange={setByWhen}
              placeholder="end of Q4"
            />
          </div>

          {/*
            The one gap the form does something about rather than complains about. "No baseline?
            Then measuring it is Phase 1" is an instruction, so it is offered as the button that
            carries it out — a rule you have to remember to follow yourself is a rule that gets
            followed on the days it is least needed.
          */}
          {!baseline.trim() && !hasMeasurePhase && (
            <button
              onClick={() =>
                setPhases((list) => [
                  { id: newPhaseId(), ...MEASURE_PHASE },
                  ...list.filter((p) => p.name || p.exit),
                ])
              }
              className="btn-secondary py-1 px-3 text-xs self-start mt-2"
            >
              <Plus className="w-3.5 h-3.5" />
              No baseline — add &ldquo;{MEASURE_PHASE.name}&rdquo; as Phase 1
            </button>
          )}

          {review?.metric && (
            <SuggestionShell
              why={review.metric.why}
              asks={review.metric.asks}
              onDismiss={() => clearSuggestion("metric")}
              onUse={
                review.metric.baseline || review.metric.target || review.metric.by_when
                  ? () => {
                      // Only overwrites what the model actually returned. A blank from the model
                      // means "no view on this one", not "clear it".
                      if (review.metric?.baseline) setBaseline(review.metric.baseline);
                      if (review.metric?.target) setTarget(review.metric.target);
                      if (review.metric?.by_when) setByWhen(review.metric.by_when);
                      clearSuggestion("metric");
                    }
                  : undefined
              }
            >
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  ["Baseline", review.metric.baseline],
                  ["Target", review.metric.target],
                  ["By when", review.metric.by_when],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] text-neutral-400">{label}</dt>
                    <dd className="text-sm text-neutral-800">{value || <span className="text-neutral-300">—</span>}</dd>
                  </div>
                ))}
              </dl>
            </SuggestionShell>
          )}
        </Field>

        <Field {...BRIEF_PROMPTS.explicitlyOut}>
          <ListEditor
            items={out}
            onChange={setOut}
            placeholder="People will assume this covers…"
            addLabel="Add another exclusion"
            minimum={MIN_EXPLICITLY_OUT}
            minimumHint={`Two is the minimum that means anything — one exclusion reads as an afterthought.`}
          />
          {review?.explicitly_out && (
            <SuggestionShell
              why={review.explicitly_out.why}
              asks={review.explicitly_out.asks}
              onDismiss={() => clearSuggestion("explicitly_out")}
              onUse={
                review.explicitly_out.items.length
                  ? () => {
                      setOut(review.explicitly_out?.items ?? []);
                      clearSuggestion("explicitly_out");
                    }
                  : undefined
              }
            >
              {review.explicitly_out.items.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-sm text-neutral-800">
                  {review.explicitly_out.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}

              {/*
                Kept apart from the rewrites above, and added one at a time. An exclusion is a
                scope decision; a scope decision she did not make must never arrive looking like
                one she did, so these are proposals with their own accept, not part of "Use this".
              */}
              {review.explicitly_out.suggested.length > 0 && (
                <div className="mt-2 pt-2 border-t border-neutral-100">
                  <p className="text-[11px] text-neutral-400 mb-1">
                    Also proposed — scope is yours, so these are separate:
                  </p>
                  <ul className="space-y-1">
                    {review.explicitly_out.suggested.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <button
                          onClick={() => {
                            setOut((list) => [...list.filter((v) => v.trim()), item]);
                            setReview((r) =>
                              r && r.explicitly_out
                                ? {
                                    ...r,
                                    explicitly_out: {
                                      ...r.explicitly_out,
                                      suggested: r.explicitly_out.suggested.filter((v) => v !== item),
                                    },
                                  }
                                : r
                            );
                          }}
                          className="text-sprout-600 hover:text-sprout-700 transition-colors shrink-0 mt-0.5"
                          aria-label={`Add exclusion: ${item}`}
                          title="Add this exclusion"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm text-neutral-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </SuggestionShell>
          )}
        </Field>

        <Field {...BRIEF_PROMPTS.phases}>
          <PhaseEditor phases={phases} onChange={setPhases} />
        </Field>

        <Field {...BRIEF_PROMPTS.owner}>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="A person"
            className="form-input text-sm w-full"
            aria-label="Owner"
          />
        </Field>

        {/* Named, not counted. "4 fields missing" is a form error; "Problem, Owner" is a to-do. */}
        {gaps.length > 0 && (
          <p className="text-xs text-amber-600 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Still unanswered: {gaps.join(", ")}. You can save anyway — the card will say the same
              thing until you come back to it.
            </span>
          </p>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={busy || !name.trim()} className="btn-primary">
            {project ? "Save brief" : "Create project"}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </SidePanel>
  );
}

/**
 * The frame every AI suggestion is drawn in.
 *
 * Deliberately visually distinct from the fields it sits under — a dashed, tinted panel — because
 * the one thing a reader must never be unsure about is which words are hers and which a model
 * proposed. Nothing here is written into the brief until Use is pressed.
 *
 * `onUse` is optional, and its absence is meaningful: when the model had no rewrite to offer and
 * only questions to ask, there is nothing to accept, so no button appears rather than a dead one.
 */
function SuggestionShell({
  why,
  asks,
  onUse,
  onDismiss,
  children,
}: {
  why: string;
  asks: string[];
  onUse?: () => void;
  onDismiss: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-sprout-300/80 bg-sprout-50/40 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-sprout-600 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-sprout-700">
          Suggested
        </span>
        <button
          onClick={onDismiss}
          className="ml-auto text-neutral-400 hover:text-neutral-700 transition-colors p-0.5"
          aria-label="Dismiss suggestion"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {children}

      {/* Why it changed, so the suggestion can be judged rather than just taken. */}
      {why && <p className="text-[11px] text-neutral-500 italic">{why}</p>}

      {/*
        The questions are the honest half of this feature. Where a model would normally invent the
        missing evidence, it has to ask for it instead — so these are the most valuable thing on
        the card, not a footnote, and they stay visible after the rewrite is accepted or dropped.
      */}
      {asks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {asks.map((ask, i) => (
            <li key={i} className="text-xs text-neutral-600 flex items-start gap-1.5">
              <HelpCircle className="w-3 h-3 mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />
              {ask}
            </li>
          ))}
        </ul>
      )}

      {onUse && (
        <button onClick={onUse} className="btn-secondary py-1 px-3 text-xs self-start">
          <Check className="w-3.5 h-3.5" />
          Use this
        </button>
      )}
    </div>
  );
}

/**
 * A suggestion for a single prose field.
 *
 * Renders nothing when the model came back with wording identical to hers — a card that says
 * "here is your own sentence back" is worse than silence, and it is the outcome whenever a field
 * was already well written.
 */
function Suggestion({
  review,
  current,
  onUse,
  onDismiss,
}: {
  review: BriefFieldReview | null;
  current: string;
  onUse: (value: string) => void;
  onDismiss: () => void;
}) {
  if (!review) return null;
  const changed = review.revised.trim() && review.revised.trim() !== current.trim();
  if (!changed && review.asks.length === 0) return null;

  return (
    <SuggestionShell
      why={changed ? review.why : ""}
      asks={review.asks}
      onDismiss={onDismiss}
      onUse={
        changed
          ? () => {
              onUse(review.revised.trim());
              onDismiss();
            }
          : undefined
      }
    >
      {changed ? (
        <p className="text-sm text-neutral-800 whitespace-pre-wrap">{review.revised}</p>
      ) : (
        <p className="text-xs text-neutral-500">
          No rewrite needed — this reads clearly as written.
        </p>
      )}
    </SuggestionShell>
  );
}

/** One question: what it asks, the rule that makes the answer worth having, and the control. */
function Field({
  label,
  ask,
  rule,
  children,
}: {
  label: string;
  ask?: string;
  rule?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{label}</h3>
        {ask && <p className="text-xs text-neutral-600 mt-0.5">{ask}</p>}
        {rule && <p className="text-[11px] text-neutral-400 italic">{rule}</p>}
      </div>
      {children}
    </section>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input text-sm"
      />
    </label>
  );
}

/** A short list of one-liners, grown a row at a time. Used for the exclusions. */
function ListEditor({
  items,
  onChange,
  placeholder,
  addLabel,
  minimum,
  minimumHint,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  minimum: number;
  minimumHint: string;
}) {
  const filled = items.filter((v) => v.trim()).length;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-neutral-300 w-4 shrink-0 text-right">{i + 1}</span>
          <input
            value={item}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            placeholder={placeholder}
            className="form-input text-sm flex-1 min-w-0"
            aria-label={`Exclusion ${i + 1}`}
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-neutral-300 hover:text-red-600 transition-colors p-1 shrink-0"
            aria-label={`Remove exclusion ${i + 1}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => onChange([...items, ""])}
          className="btn-secondary py-1 px-3 text-xs self-start"
        >
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </button>
        {filled < minimum && <span className="text-[11px] text-neutral-400">{minimumHint}</span>}
      </div>
    </div>
  );
}

/**
 * The phases. Two fields each, and the labels are load-bearing: the name asks for a STATE
 * ("Migration verified on staging"), not an activity ("do the migration"), because a phase named
 * after an activity has no moment at which it is over. The exit criterion is the same discipline
 * said twice — one sentence that is either true or not true on a given morning.
 */
function PhaseEditor({
  phases,
  onChange,
}: {
  phases: ProjectPhase[];
  onChange: (next: ProjectPhase[]) => void;
}) {
  function set(i: number, patch: Partial<ProjectPhase>) {
    onChange(phases.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= phases.length) return;
    const next = [...phases];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {phases.map((phase, i) => (
        <div key={i} className="card p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide shrink-0">
              Phase {i + 1}
            </span>
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {/* Order is the plan, so it has to be changeable without retyping two fields. */}
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-neutral-300 hover:text-neutral-600 disabled:opacity-30 transition-colors p-1"
                aria-label={`Move phase ${i + 1} earlier`}
              >
                <GripVertical className="w-3.5 h-3.5 rotate-180" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === phases.length - 1}
                className="text-neutral-300 hover:text-neutral-600 disabled:opacity-30 transition-colors p-1"
                aria-label={`Move phase ${i + 1} later`}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onChange(phases.filter((_, j) => j !== i))}
                className="text-neutral-300 hover:text-red-600 transition-colors p-1"
                aria-label={`Remove phase ${i + 1}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500">The state it ends in</span>
            <input
              value={phase.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="Migration verified on staging"
              className="form-input text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500">Exit criterion — one, and checkable</span>
            <input
              value={phase.exit}
              onChange={(e) => set(i, { exit: e.target.value })}
              placeholder="A full run completes with zero row-count differences."
              className="form-input text-sm"
            />
          </label>
        </div>
      ))}
      <button
        onClick={() => onChange([...phases, { id: newPhaseId(), name: "", exit: "" }])}
        className="btn-secondary py-1 px-3 text-xs self-start"
      >
        <Plus className="w-3.5 h-3.5" />
        Add a phase
      </button>
    </div>
  );
}

/** The saved brief, read-only, for the card's expanded view. */
export function BriefSummary({ project }: { project: WorkProject }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (project.problem) rows.push({ label: BRIEF_PROMPTS.problem.label, value: project.problem });
  if (project.outcome) rows.push({ label: BRIEF_PROMPTS.outcome.label, value: project.outcome });
  if (project.explicitly_out.length > 0) {
    rows.push({
      label: BRIEF_PROMPTS.explicitlyOut.label,
      value: (
        <ul className="list-disc pl-4 space-y-0.5">
          {project.explicitly_out.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ),
    });
  }
  if (project.phases.length > 0) {
    rows.push({
      label: BRIEF_PROMPTS.phases.label,
      value: (
        <ol className="space-y-1">
          {project.phases.map((phase, i) => (
            <li key={i}>
              <span className="text-neutral-700">
                {i + 1}. {phase.name}
              </span>
              <span className="block text-neutral-400 pl-4">Ends when: {phase.exit}</span>
            </li>
          ))}
        </ol>
      ),
    });
  }
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-neutral-100">
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">
            {row.label}
          </p>
          <div className={cn("text-xs text-neutral-600 mt-0.5")}>{row.value}</div>
        </div>
      ))}
    </div>
  );
}
