"use client";

import { useEffect, useState } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { AlertCircle, Check, HelpCircle, Sparkles, X } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { QuadrantSelect } from "@/components/work/Quadrant";
import type { Triage, BriefFieldReview } from "@/lib/work";
import {
  ONE_PAGER_FIELDS,
  type OnePagerFieldKey,
  type ProjectOnePagerReview,
  type ProjectPhaseStatus,
} from "@/lib/project-tracking";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";

const ONE_PAGER_PLACEHOLDERS: Record<OnePagerFieldKey, string> = {
  problem_context: "What is broken today, with evidence",
  objective: "What this project sets out to do",
  expected_outcome: "What is true when this is done",
  scope: "What's in",
  out_of_scope: "What's explicitly not in",
  success_metrics: "Baseline → target → by when",
};

const addProjectSchema = z.object({
  project_name: z.string().min(1, "A project needs a name."),
  owning_team: z.string().min(1, "Required"),
  owner: z.string().min(1, "Required"),
  contributors: z.string().optional(),
  urgent: z.boolean().nullable().optional(),
  important: z.boolean().nullable().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  committed_date: z.string().optional(),
  problem_context: z.string().optional(),
  objective: z.string().optional(),
  expected_outcome: z.string().optional(),
  scope: z.string().optional(),
  out_of_scope: z.string().optional(),
  success_metrics: z.string().optional(),
  quick_risk: z.string().optional(),
  quick_dependency: z.string().optional(),
});

export type AddProjectValues = z.infer<typeof addProjectSchema>;

/** What a parsed charter contributes beyond the fields that map straight into the form — created
 * as separate rows right after the project itself, same "already-created, best-effort" handling
 * as the existing quick-risk/quick-dependency fields. */
export type PendingCharterImport = {
  phases: Array<{
    name: string;
    description: string;
    status: ProjectPhaseStatus;
    start_date: string;
    target_date: string;
  }>;
  risks: Array<{ risk: string; mitigation: string }>;
};

function defaultValues(defaultTeam?: string): AddProjectValues {
  return {
    project_name: "",
    owning_team: defaultTeam ?? "",
    owner: "",
    contributors: "",
    urgent: null,
    important: null,
    start_date: "",
    target_date: "",
    committed_date: "",
    problem_context: "",
    objective: "",
    expected_outcome: "",
    scope: "",
    out_of_scope: "",
    success_metrics: "",
    quick_risk: "",
    quick_dependency: "",
  };
}

async function postJson(url: string, payload: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
  return body.data;
}

async function patchJson(url: string, payload: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
  return body.data;
}

/**
 * The "+ Add Project" flow — the one-pager structure, up front, rather than the full edit form's
 * kitchen sink (tracking mode, batch inputs, Jira label, notes…). Those stay reachable from
 * `EditProjectDialog` right after creation; a project's FIRST five minutes are about naming the
 * problem and who owns it, not choosing a tracking mode for work that hasn't started.
 *
 * Reuses `/api/project-tracking/projects/review` (the project-tracking twin of My Work's own
 * "Refine with AI") — same editor-not-author contract, same invented-figure guard, same cache.
 */
export function AddProjectPanel({
  open,
  onClose,
  teams,
  defaultTeam,
  initialDraft,
  pendingImport,
  importBanner,
  updateProjectId,
  charterRef,
}: {
  open: boolean;
  onClose: () => void;
  teams: TeamConfig[];
  defaultTeam?: string;
  /** Pre-fills the form when the panel opens — the charter-upload flow's mapped fields. */
  initialDraft?: Partial<AddProjectValues>;
  /** Created as separate rows right after the project itself — see PendingCharterImport. Never
   * set alongside `updateProjectId`: a repeat charter upload updates the project's own fields but
   * doesn't re-create phases/risks (they may already have manual edits since the first import). */
  pendingImport?: PendingCharterImport;
  /** Shown as a dismissible banner above the form when a charter's Team/Owner text couldn't be
   * mapped automatically — text only, built by the caller from the charter's own strings. */
  importBanner?: string;
  /** When set, submitting PATCHes this existing project instead of creating a new one — a charter
   * re-upload matched by `charter_client_ref` to a project already imported from it. */
  updateProjectId?: string;
  /** The charter's `client_ref`, stamped onto a newly-created project so a later re-upload of the
   * same charter can find it. Only meaningful on create (ignored when `updateProjectId` is set —
   * the existing row already has its ref). */
  charterRef?: string;
}) {
  const router = useRouter();
  const form = useForm<AddProjectValues>({
    resolver: zodResolver(addProjectSchema),
    defaultValues: defaultValues(defaultTeam),
  });
  const { register, watch, setValue, getValues, handleSubmit, reset, formState: { errors } } = form;
  const urgent = watch("urgent");
  const important = watch("important");
  const [banner, setBanner] = useState<string | null>(null);

  // Pre-fills without fighting react-hook-form's one-time default capture — keyed on `open` so
  // this only fires when the panel is (re)opened, not on every keystroke.
  useEffect(() => {
    if (open && initialDraft) {
      reset({ ...defaultValues(defaultTeam), ...initialDraft });
      setBanner(importBanner ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [review, setReview] = useState<ProjectOnePagerReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function runReview(force = false) {
    if (reviewing) return; // guards against a double-click spending two requests
    setReviewing(true);
    setReviewError(null);
    try {
      const v = getValues();
      const data = await postJson("/api/project-tracking/projects/review", {
        force,
        project_name: v.project_name,
        problem_context: v.problem_context,
        objective: v.objective,
        expected_outcome: v.expected_outcome,
        scope: v.scope,
        out_of_scope: v.out_of_scope,
        success_metrics: v.success_metrics,
      });
      setReview(data as ProjectOnePagerReview);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }

  /** Accepting a suggestion also retires it — a card still offering what you just took is noise. */
  function clearSuggestion(key: OnePagerFieldKey) {
    setReview((r) => (r ? { ...r, [key]: null } : r));
  }

  function closeAndReset() {
    reset(defaultValues(defaultTeam));
    setReview(null);
    setReviewError(null);
    setError(null);
    setBanner(null);
    onClose();
  }

  async function onSubmit(values: AddProjectValues) {
    setBusy(true);
    setError(null);
    try {
      const fields = {
        project_name: values.project_name,
        owning_team: values.owning_team,
        owner: values.owner,
        contributors: (values.contributors ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        urgent: values.urgent ?? null,
        important: values.important ?? null,
        start_date: values.start_date || "",
        target_date: values.target_date || "",
        committed_date: values.committed_date || "",
        problem_context: values.problem_context || "",
        objective: values.objective || "",
        expected_outcome: values.expected_outcome || "",
        scope: values.scope || "",
        out_of_scope: values.out_of_scope || "",
        success_metrics: values.success_metrics || "",
      };

      let projectId: string | undefined;
      if (updateProjectId) {
        const updated = (await patchJson("/api/project-tracking/projects", {
          id: updateProjectId,
          ...fields,
        })) as { project_id?: string } | undefined;
        projectId = updated?.project_id ?? updateProjectId;
      } else {
        const created = (await postJson("/api/project-tracking/projects", {
          ...fields,
          status: "Not Started",
          ...(charterRef ? { charter_client_ref: charterRef } : {}),
        })) as { project_id?: string };
        projectId = created?.project_id;
      }

      const risk = (values.quick_risk ?? "").trim();
      const dependency = (values.quick_dependency ?? "").trim();
      if (projectId && (risk || dependency)) {
        // The project itself is already saved at this point — a failed quick-add is not worth
        // blocking the close on. Add the risk/dependency later from the drill-down if it drops.
        await Promise.all([
          risk ? postJson("/api/project-tracking/risks", { project_id: projectId, risk }) : null,
          dependency
            ? postJson("/api/project-tracking/dependencies", { project_id: projectId, label: dependency })
            : null,
        ]).catch(() => {});
      }

      if (projectId && pendingImport) {
        // Same best-effort handling as the quick-add fields above — the imported charter's
        // phases/risks are a convenience on top of an already-saved project, not a reason to
        // block the close if one of them fails.
        await Promise.all([
          ...pendingImport.phases.map((phase) =>
            postJson("/api/project-tracking/phases", { project_id: projectId, ...phase })
          ),
          ...pendingImport.risks.map((r) =>
            postJson("/api/project-tracking/risks", { project_id: projectId, risk: r.risk, mitigation: r.mitigation })
          ),
        ]).catch(() => {});
      }

      router.refresh();
      closeAndReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={closeAndReset}
      width="wide"
      title={updateProjectId ? "Update project" : "New project"}
      description={
        updateProjectId
          ? "Updating from a revised charter. Phases and risks aren't re-imported — edit those directly if they changed."
          : "One page. If you cannot answer these, that is the finding."
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {banner && (
          <div className="rounded-lg border border-sprout-200 bg-sprout-50/60 p-3 flex items-start justify-between gap-3">
            <p className="text-xs text-sprout-800">{banner}</p>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-sprout-600 hover:text-sprout-800 transition-colors p-0.5 shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 -mb-1">
          <button
            type="button"
            onClick={() => runReview(false)}
            disabled={reviewing}
            className="btn-secondary py-1.5 px-3 text-xs"
          >
            <Sparkles className={reviewing ? "w-3.5 h-3.5 animate-pulse" : "w-3.5 h-3.5"} />
            {reviewing ? "Reading it…" : review ? "Review again" : "Refine with AI"}
          </button>
          <p className="text-[11px] text-neutral-400 flex-1 min-w-[14rem]">
            Suggests clearer wording for the one-pager below. It cannot add facts — anything it
            needs from you comes back as a question.
          </p>
          {review?.fromCache && (
            <button
              type="button"
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

        <Field label="Project Name">
          <input
            autoFocus
            {...register("project_name")}
            placeholder="What it is called"
            className="form-input w-full"
            aria-label="Project name"
          />
          {errors.project_name && <p className="form-error">{errors.project_name.message}</p>}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Team">
            <select {...register("owning_team")} className="form-input">
              <option value="">Select…</option>
              {teams.map((t) => (
                <option key={t.team_key} value={t.team_key}>{teamLabel(t.team_name)}</option>
              ))}
            </select>
            {errors.owning_team && <p className="form-error">{errors.owning_team.message}</p>}
          </Field>
          <Field label="Owner">
            <input {...register("owner")} placeholder="Full name" className="form-input w-full" />
            {errors.owner && <p className="form-error">{errors.owner.message}</p>}
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Stakeholders" hint="comma-separated">
            <input
              {...register("contributors")}
              placeholder="e.g. Jasper Razo, Ken Uy"
              className="form-input w-full"
            />
          </Field>
          <Field label="Priority">
            <QuadrantSelect
              value={{ urgent: urgent ?? null, important: important ?? null } as Triage}
              onChange={(next) => {
                setValue("urgent", next.urgent, { shouldDirty: true });
                setValue("important", next.important, { shouldDirty: true });
              }}
              size="md"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Start Date">
            <input type="date" {...register("start_date")} className="form-input w-full" />
          </Field>
          <Field label="Target Date">
            <input type="date" {...register("target_date")} className="form-input w-full" />
          </Field>
          <Field label="Committed Date" hint="the date you'd defend">
            <input type="date" {...register("committed_date")} className="form-input w-full" />
          </Field>
        </div>

        <div className="border-t border-neutral-100 pt-5 flex flex-col gap-6">
          <p className="text-xs uppercase tracking-wide text-neutral-400 -mb-2">One-pager</p>
          {ONE_PAGER_FIELDS.map((f) => (
            <OnePagerFieldEditor
              key={f.key}
              fieldKey={f.key}
              label={f.label}
              placeholder={ONE_PAGER_PLACEHOLDERS[f.key]}
              register={register}
              current={watch(f.key) ?? ""}
              review={review?.[f.key] ?? null}
              onUse={(value) => setValue(f.key, value, { shouldDirty: true })}
              onDismiss={() => clearSuggestion(f.key)}
            />
          ))}
        </div>

        <div className="border-t border-neutral-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Add an initial risk" hint="optional">
            <input
              {...register("quick_risk")}
              placeholder="What could stop this working"
              className="form-input w-full"
            />
          </Field>
          <Field label="Add a dependency" hint="optional">
            <input
              {...register("quick_dependency")}
              placeholder="What this is waiting on"
              className="form-input w-full"
            />
          </Field>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={busy} className="btn-primary">
            {updateProjectId ? (busy ? "Updating…" : "Update project") : busy ? "Creating…" : "Create project"}
          </button>
          <button
            type="button"
            onClick={closeAndReset}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </SidePanel>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="form-label">
        {label} {hint && <span className="text-neutral-400 font-normal">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

/** One one-pager field: label, textarea, and its AI suggestion (if any) directly beneath it. */
function OnePagerFieldEditor({
  fieldKey,
  label,
  placeholder,
  register,
  current,
  review,
  onUse,
  onDismiss,
}: {
  fieldKey: OnePagerFieldKey;
  label: string;
  placeholder: string;
  register: UseFormRegister<AddProjectValues>;
  current: string;
  review: BriefFieldReview | null;
  onUse: (value: string) => void;
  onDismiss: () => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-neutral-900">{label}</h3>
      <textarea
        {...register(fieldKey)}
        rows={fieldKey === "scope" || fieldKey === "out_of_scope" ? 2 : 3}
        placeholder={placeholder}
        className="form-input text-sm w-full"
        aria-label={label}
      />
      <Suggestion review={review} current={current} onUse={onUse} onDismiss={onDismiss} />
    </section>
  );
}

/**
 * The frame every AI suggestion is drawn in — dashed and tinted, deliberately distinct from the
 * field it sits under, so it's never ambiguous which words are hers and which a model proposed.
 * Nothing here is written into the form until Use is pressed.
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
    <div className="rounded-lg border border-dashed border-sprout-300/80 bg-sprout-50/40 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-sprout-600 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-sprout-700">Suggested</span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-neutral-400 hover:text-neutral-700 transition-colors p-0.5"
          aria-label="Dismiss suggestion"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {changed ? (
        <p className="text-sm text-neutral-800 whitespace-pre-wrap">{review.revised}</p>
      ) : (
        <p className="text-xs text-neutral-500">No rewrite needed — this reads clearly as written.</p>
      )}

      {review.why && changed && <p className="text-[11px] text-neutral-500 italic">{review.why}</p>}

      {review.asks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {review.asks.map((ask, i) => (
            <li key={i} className="text-xs text-neutral-600 flex items-start gap-1.5">
              <HelpCircle className="w-3 h-3 mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />
              {ask}
            </li>
          ))}
        </ul>
      )}

      {changed && (
        <button
          type="button"
          onClick={() => {
            onUse(review.revised.trim());
            onDismiss();
          }}
          className="btn-secondary py-1 px-3 text-xs self-start"
        >
          <Check className="w-3.5 h-3.5" />
          Use this
        </button>
      )}
    </div>
  );
}
