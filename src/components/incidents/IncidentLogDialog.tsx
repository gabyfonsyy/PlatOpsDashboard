"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, Loader2, ExternalLink } from "lucide-react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";
import { formatManilaDate } from "@/lib/format";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_CODES,
  defaultEmployeeForRole,
  formatScoreImpact,
  jiraIssueUrl,
  rolesForTeam,
  type IncidentFeedbackAssist,
  type IncidentLog,
  type IncidentRole,
  type IncidentTicket,
} from "@/lib/incidents";

const incidentLogSchema = z.object({
  role: z.enum(["Doer", "Validator"]),
  employee_name: z.string().min(1, "Required"),
  severity: z.enum(["S1", "S2", "S3", "S4"], { required_error: "Pick a severity" }),
  incident_date: z.string().min(1, "Required"),
  feedback_raw: z.string().min(1, "Write why this was flagged"),
  feedback_polished: z.string().optional().default(""),
  improvements: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

type IncidentLogFormValues = z.infer<typeof incidentLogSchema>;

/**
 * Create-or-edit in one dialog: an incident log is always anchored to a ticket that already
 * exists, so the only difference between the two cases is whether `log` is present. Splitting
 * them would duplicate the whole AI-assist panel for no behavioural difference.
 */
export function IncidentLogDialog({
  ticket,
  log,
  hasPeerReview,
  teamLabel,
  jiraBaseUrl,
  aiEnabled,
  rosterNames,
  validatorNames,
  onClose,
}: {
  ticket: IncidentTicket;
  /** Omitted when adding a new log. */
  log?: IncidentLog;
  hasPeerReview: boolean;
  teamLabel: string;
  jiraBaseUrl: string;
  aiEnabled: boolean;
  rosterNames: string[];
  /** The designated peer reviewers — suggested instead of the whole roster for a Validator log. */
  validatorNames: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>(log?.categories ?? []);
  // Recorded alongside the log so it's always clear which model wrote a stored rewrite —
  // re-reading months-old feedback, that provenance is the difference between "the AI said this"
  // and "my manager said this". Cleared implicitly if the manager rewrites by hand and never
  // re-runs the assist, which is the honest outcome.
  const [aiMeta, setAiMeta] = useState<{ model: string; at: string } | null>(
    log?.ai_model ? { model: log.ai_model, at: log.ai_generated_at } : null
  );
  /**
   * The exact note that produced the draft currently on screen. Re-pressing the button on
   * unchanged text would produce a near-identical rewrite for the price of a live AI request, so
   * the button goes inert instead — the cheapest possible saving, on the app's most-used AI
   * feature. Seeded from the stored log so re-opening a saved incident doesn't offer a pointless
   * regeneration either.
   */
  const [assistedFrom, setAssistedFrom] = useState<string | null>(
    log?.feedback_polished ? log.feedback_raw : null
  );

  const availableRoles = rolesForTeam(hasPeerReview);

  const form = useForm<IncidentLogFormValues>({
    resolver: zodResolver(incidentLogSchema),
    defaultValues: log
      ? {
          role: log.role,
          employee_name: log.employee_name,
          severity: log.severity,
          incident_date: formatManilaDate(log.incident_date),
          feedback_raw: log.feedback_raw,
          feedback_polished: log.feedback_polished,
          improvements: log.improvements,
          notes: log.notes,
        }
      : {
          role: availableRoles[0],
          employee_name: defaultEmployeeForRole(ticket, availableRoles[0]),
          incident_date: formatManilaDate(ticket.incident_date),
          feedback_raw: "",
          feedback_polished: "",
          improvements: "",
          notes: "",
        },
  });

  const { register, watch, setValue, formState: { errors } } = form;
  const role = watch("role");
  const severity = watch("severity");
  const feedbackRaw = watch("feedback_raw");
  const polished = watch("feedback_polished");

  /** Switching role re-points the log at that role's person from Jira, unless editing an
   * existing log where the manager may have deliberately overridden the name. */
  function onRoleChange(next: IncidentRole) {
    setValue("role", next);
    if (!log) setValue("employee_name", defaultEmployeeForRole(ticket, next));
  }

  function toggleCategory(category: string) {
    setCategories((current) =>
      current.includes(category) ? current.filter((c) => c !== category) : [...current, category]
    );
  }

  async function runAssist() {
    setAssisting(true);
    setAssistError(null);
    try {
      const res = await fetch("/api/ai/incident-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: feedbackRaw,
          issueKey: ticket.issue_key,
          summary: ticket.summary,
          employeeName: watch("employee_name"),
          role,
          severity: severity ?? "",
          teamLabel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      const data = body.data as IncidentFeedbackAssist;
      setValue("feedback_polished", data.polished);
      setValue("improvements", data.improvements);
      // Replaces rather than merges: the categories are the model's read of THIS note, so keeping
      // stale picks from a previous run would misrepresent what it actually classified.
      setCategories(data.categories);
      setAiMeta({ model: data.model, at: new Date().toISOString() });
      setAssistedFrom(feedbackRaw);
      celebrate("success");
    } catch (err) {
      setAssistError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setAssisting(false);
    }
  }

  async function onSubmit(values: IncidentLogFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        issue_key: ticket.issue_key,
        team_key: ticket.team_key,
        ...values,
        categories,
        ai_model: aiMeta?.model ?? "",
        ai_generated_at: aiMeta?.at ?? "",
      };
      const res = await fetch("/api/gas/incidents", {
        method: log ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(log ? { id: log.incident_id, ...payload } : payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      // Writing up an incident is the tedious part of this job — the one place a reward is
      // genuinely earned.
      celebrate("milestone");
      onClose();
      router.refresh();
    } catch (err) {
      celebrate("nope");
      setError(
        `Could not save: ${err instanceof Error ? err.message : String(err)}. If this says "Unauthorized", sign out and back in.`
      );
    } finally {
      setSubmitting(false);
    }
  }

  const rubric = severity ? INCIDENT_SEVERITIES[severity] : null;
  // Unchanged note + an existing draft = nothing new to ask for.
  const alreadyDrafted =
    assistedFrom !== null && assistedFrom.trim() === (feedbackRaw ?? "").trim() && Boolean(polished);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card bg-surface w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 adhd-springy"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900">
              {log ? "Edit incident log" : "New incident log"}
            </h2>
            <p className="text-sm text-neutral-500 mt-0.5 truncate">
              <a
                href={jiraIssueUrl(jiraBaseUrl, ticket.issue_key)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sprout-700 hover:underline inline-flex items-center gap-1"
              >
                {ticket.issue_key}
                <ExternalLink className="w-3 h-3" />
              </a>
              {ticket.summary && <span className="text-neutral-500"> — {ticket.summary}</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="form-label">Role on this incident</label>
              <select
                value={role}
                onChange={(e) => onRoleChange(e.target.value as IncidentRole)}
                className="form-input"
              >
                {availableRoles.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              {!hasPeerReview && (
                <p className="text-xs text-neutral-400 mt-1">{teamLabel} has no peer-review step.</p>
              )}
            </div>

            <div>
              <label className="form-label">Person</label>
              <input
                {...register("employee_name")}
                className="form-input"
                list="incident-roster-names"
                placeholder={role === "Validator" ? "Validator" : "Doer"}
              />
              {/* A datalist, not a select: the doer/validator synced from Jira is usually right,
                  but Jira display names and roster names don't always match exactly, so the
                  manager needs to be able to type a correction rather than be locked out.
                  For a Validator log the suggestions narrow to the designated reviewers, since
                  those are the only people who perform review. */}
              <datalist id="incident-roster-names">
                {(role === "Validator" && validatorNames.length ? validatorNames : rosterNames).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {errors.employee_name && <p className="form-error">{errors.employee_name.message}</p>}
            </div>

            <div>
              <label className="form-label">Incident date</label>
              <input type="date" {...register("incident_date")} className="form-input" />
              {errors.incident_date && <p className="form-error">{errors.incident_date.message}</p>}
            </div>
          </div>

          <div>
            <label className="form-label">Severity</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INCIDENT_SEVERITY_CODES.map((code) => {
                const s = INCIDENT_SEVERITIES[code];
                const active = severity === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setValue("severity", code, { shouldValidate: true })}
                    className={cn(
                      "text-left px-3 py-2 rounded-xl border transition-all duration-200",
                      active
                        ? "border-sprout-300 bg-sprout-50 ring-2 ring-sprout-400/40"
                        : "border-neutral-200/80 bg-surface/60 hover:border-sprout-200"
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-neutral-900">
                        {code} · {s.label}
                      </span>
                      <span className="text-sm font-semibold text-red-600 tabular-nums">
                        {formatScoreImpact(s.scoreImpact)}
                      </span>
                    </span>
                    <span className="block text-xs text-neutral-500 mt-0.5">{s.description}</span>
                  </button>
                );
              })}
            </div>
            {errors.severity && <p className="form-error">{errors.severity.message}</p>}
            {rubric && (
              <p className="text-xs text-neutral-500 mt-2">
                Applies <span className="font-semibold text-red-600">{formatScoreImpact(rubric.scoreImpact)}</span> to
                this person&apos;s evaluation for the period.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-end justify-between gap-3 mb-1">
              <label className="form-label mb-0">Why this was flagged as a valid incident</label>
              <button
                type="button"
                onClick={() => { void runAssist(); }}
                disabled={!aiEnabled || assisting || !feedbackRaw?.trim() || alreadyDrafted}
                className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  !aiEnabled
                    ? "Set AI_API_KEY to enable"
                    : alreadyDrafted
                      ? "Already drafted for this note — edit the note to rephrase again"
                      : "Rephrase and categorise with AI"
                }
              >
                {assisting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {assisting ? "Working…" : alreadyDrafted ? "Drafted" : "Rephrase with AI"}
              </button>
            </div>
            <textarea
              {...register("feedback_raw")}
              rows={4}
              className="form-input resize-y"
              placeholder="Your own words — blunt is fine. e.g. pushed a config change without checking the client's env first, took 3 back-and-forths to sort out"
            />
            {errors.feedback_raw && <p className="form-error">{errors.feedback_raw.message}</p>}
            <p className="text-xs text-neutral-400 mt-1">
              Kept private and verbatim. The rewrite below is what you&apos;d share with the person.
            </p>
            {assistError && <p className="form-error">{assistError}</p>}
            {!aiEnabled && (
              <p className="text-xs text-amber-600 mt-1">
                AI assist is off — set <code>AI_API_KEY</code> in <code>.env.local</code>. You can still write
                the shared version yourself.
              </p>
            )}
          </div>

          <div>
            <label className="form-label">Feedback to share</label>
            <textarea
              {...register("feedback_polished")}
              rows={4}
              className="form-input resize-y"
              placeholder="The AI rewrite lands here — edit freely, it's yours once it's on screen."
            />
            {aiMeta && polished && (
              <p className="text-xs text-neutral-400 mt-1">
                Drafted by {aiMeta.model}
                {aiMeta.at ? ` · ${formatManilaDate(aiMeta.at)}` : ""} — edit before saving if it&apos;s not quite right.
              </p>
            )}
          </div>

          <div>
            <label className="form-label">Suggested improvements</label>
            <textarea
              {...register("improvements")}
              rows={3}
              className="form-input resize-y"
              placeholder="Concrete things to do differently next time."
            />
          </div>

          <div>
            <label className="form-label">Concern categories</label>
            <div className="flex flex-wrap gap-2">
              {INCIDENT_CATEGORIES.map((category) => {
                const active = categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className={cn(
                      "badge border transition-all duration-200",
                      active
                        ? "bg-sprout-50 text-sprout-700 border-sprout-300"
                        : "bg-surface/60 text-neutral-500 border-neutral-200 hover:border-sprout-200"
                    )}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-neutral-400 mt-1.5">
              The AI picks these from your note; click to add or remove.
            </p>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <input {...register("notes")} className="form-input" placeholder="Optional — anything else for the record" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Saving…" : log ? "Save changes" : "Add incident log"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
