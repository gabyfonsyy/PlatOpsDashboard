"use client";

import { z } from "zod";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import type { TeamConfig } from "@/lib/teams";
import type { ProjectRecord } from "@/lib/types";
import { hasProjectionInputs } from "@/lib/projection";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";

export const TRACKING_MODE_LABELS = {
  manual: "Manual",
  scheduled: "Scheduled Activities",
  tasks: "Task Checklist",
} as const;

export const projectSchema = z.object({
  project_name: z.string().min(1, "Required"),
  owning_team: z.string().min(1, "Required"),
  teams_involved: z.array(z.string()).optional(),
  owner: z.string().min(1, "Required"),
  status: z.enum(["Not Started", "In Progress", "Blocked", "Done"]),
  tracking_mode: z.enum(["manual", "scheduled", "tasks"]).default("manual"),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  percent_complete: z.coerce.number().min(0).max(100).optional(),
  jira_label: z.string().optional(),
  total_items: z.coerce.number().min(0).optional().or(z.literal("")),
  batch_size: z.coerce.number().min(0).optional().or(z.literal("")),
  batches_per_week: z.coerce.number().min(0).optional().or(z.literal("")),
  weekly_plan: z
    .array(
      z.object({
        weekStart: z.string().optional().default(""),
        items: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
      })
    )
    .optional(),
  notes: z.string().optional(),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;

/** Shapes raw form values into the API payload — teams_involved as CSV, overrides as JSON. */
export function buildProjectPayload(values: ProjectFormValues) {
  const { weekly_plan, teams_involved, ...rest } = values;
  const overrides = (weekly_plan ?? [])
    .filter((o) => o.weekStart && o.items !== "" && o.items !== undefined && Number(o.items) > 0)
    .map((o) => ({ weekStart: o.weekStart as string, items: Number(o.items) }));
  return {
    ...rest,
    teams_involved: (teams_involved ?? []).join(","),
    weekly_plan_json: JSON.stringify(overrides),
  };
}

const numOrBlank = (v: ProjectRecord["total_items"]): number | "" =>
  v === "" || v === null || v === undefined ? "" : Number(v);

/**
 * A legacy row saved before `tracking_mode` existed has it blank — infer the mode it was
 * actually using so the edit form opens on the right tab instead of silently defaulting to
 * Manual and hiding the batch/task data it already has.
 */
function inferLegacyTrackingMode(r: ProjectRecord, hasTasks: boolean): "manual" | "scheduled" | "tasks" {
  if (r.tracking_mode === "manual" || r.tracking_mode === "scheduled" || r.tracking_mode === "tasks") {
    return r.tracking_mode;
  }
  if (hasTasks) return "tasks";
  if (hasProjectionInputs({ totalItems: r.total_items, batchSize: r.batch_size })) return "scheduled";
  return "manual";
}

/**
 * Maps a stored project into the form's shape (CSV→array, JSON→rows, Manila-normalised dates).
 * `computedPercent`, when given, overrides the raw stored percent_complete — ProjectsTable shows
 * a batch-throughput-projected percentage once there's enough data for one (see its own `pct`
 * calc), which can differ from the manually-entered field; the edit form should default to
 * whatever the table is actually showing, not silently disagree with it. `hasTasks` feeds
 * inferLegacyTrackingMode for rows saved before tracking_mode existed.
 */
export function projectToFormValues(r: ProjectRecord, computedPercent?: number, hasTasks = false): ProjectFormValues {
  let weekly: { weekStart: string; items: number | "" }[] = [];
  try {
    const parsed = JSON.parse(r.weekly_plan_json || "[]");
    if (Array.isArray(parsed)) {
      weekly = parsed.map((x) => ({
        weekStart: String(x?.weekStart || ""),
        items: x?.items === undefined || x?.items === null || x?.items === "" ? "" : Number(x.items),
      }));
    }
  } catch {
    /* tolerate malformed JSON */
  }
  return {
    project_name: r.project_name,
    owning_team: r.owning_team,
    teams_involved: String(r.teams_involved || "").split(",").map((s) => s.trim()).filter(Boolean),
    owner: r.owner,
    status: r.status,
    tracking_mode: inferLegacyTrackingMode(r, hasTasks),
    start_date: r.start_date ? formatManilaDate(r.start_date) : "",
    target_date: r.target_date ? formatManilaDate(r.target_date) : "",
    percent_complete: computedPercent ?? (Number(r.percent_complete) || 0),
    jira_label: r.jira_label || "",
    total_items: numOrBlank(r.total_items),
    batch_size: numOrBlank(r.batch_size),
    batches_per_week: numOrBlank(r.batches_per_week),
    weekly_plan: weekly,
    notes: r.notes || "",
  };
}

/**
 * The shared project field cells, used by both the create form and the edit dialog. The parent
 * owns the <form> and a 4-column grid (`grid grid-cols-2 sm:grid-cols-4 gap-4`); this renders the
 * cells plus the teams-involved checkboxes and the weekly-overrides field array.
 */
export function ProjectFormFields({
  form,
  teams,
}: {
  form: UseFormReturn<ProjectFormValues>;
  teams: TeamConfig[];
}) {
  const { register, control, watch, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "weekly_plan" });
  const trackingMode = watch("tracking_mode");

  return (
    <>
      <div className="col-span-2">
        <label className="form-label">Project Name</label>
        <input {...register("project_name")} className="form-input" placeholder="e.g. TDE Certificate" />
        {errors.project_name && <p className="form-error">{errors.project_name.message}</p>}
      </div>
      <div>
        <label className="form-label">Owning Team</label>
        <select {...register("owning_team")} className="form-input">
          <option value="">Select…</option>
          {teams.map((t) => <option key={t.team_key} value={t.team_key}>{teamLabel(t.team_name)}</option>)}
        </select>
        {errors.owning_team && <p className="form-error">{errors.owning_team.message}</p>}
      </div>
      <div>
        <label className="form-label">Owner</label>
        <input {...register("owner")} className="form-input" placeholder="Full name" />
        {errors.owner && <p className="form-error">{errors.owner.message}</p>}
      </div>

      <div className="col-span-full">
        <label className="form-label">Teams Involved</label>
        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1">
          {teams.map((t) => (
            <label key={t.team_key} className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
              <input type="checkbox" value={t.team_key} {...register("teams_involved")}
                className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500" />
              {teamLabel(t.team_name)}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="form-label">Status</label>
        <select {...register("status")} className="form-input">
          <option>Not Started</option>
          <option>In Progress</option>
          <option>Blocked</option>
          <option>Done</option>
        </select>
      </div>
      <div>
        <label className="form-label">Tracking Mode</label>
        <select {...register("tracking_mode")} className="form-input">
          <option value="manual">{TRACKING_MODE_LABELS.manual}</option>
          <option value="scheduled">{TRACKING_MODE_LABELS.scheduled}</option>
          <option value="tasks">{TRACKING_MODE_LABELS.tasks}</option>
        </select>
      </div>
      <div>
        <label className="form-label">Start Date</label>
        <input type="date" {...register("start_date")} className="form-input" />
      </div>
      <div>
        <label className="form-label">Target Date</label>
        <input type="date" {...register("target_date")} className="form-input" />
      </div>

      {trackingMode === "manual" && (
        <div>
          <label className="form-label">% Complete</label>
          <input type="number" min={0} max={100} {...register("percent_complete")} className="form-input" />
        </div>
      )}
      {trackingMode === "tasks" && (
        <div className="col-span-full">
          <p className="text-sm text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2">
            % complete is calculated from the task checklist — add and check off tasks by expanding
            this project&apos;s row in the table below after saving.
          </p>
        </div>
      )}

      <div className="col-span-2">
        <label className="form-label">Jira Label <span className="text-neutral-400 font-normal">(links cod-initiative tickets)</span></label>
        <input {...register("jira_label")} className="form-input" placeholder="e.g. audit-tdecert" />
      </div>

      {trackingMode === "scheduled" && (
        <>
          <div>
            <label className="form-label">Total Items</label>
            <input type="number" min={0} {...register("total_items")} className="form-input" placeholder="e.g. 500" />
          </div>
          <div>
            <label className="form-label">Batch Size</label>
            <input type="number" min={0} {...register("batch_size")} className="form-input" placeholder="e.g. 50" />
          </div>
          <div>
            <label className="form-label">Batches / Week</label>
            <input type="number" min={0} step="0.5" {...register("batches_per_week")} className="form-input" placeholder="e.g. 2" />
          </div>

          <div className="col-span-full">
            <label className="form-label">
              Weekly Overrides{" "}
              <span className="text-neutral-400 font-normal">(optional — weeks not listed use batch size × batches/week)</span>
            </label>
            <div className="flex flex-col gap-2 mt-1">
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2">
                  <input type="date" {...register(`weekly_plan.${i}.weekStart`)} className="form-input !w-auto" />
                  <input type="number" min={0} placeholder="items that week" {...register(`weekly_plan.${i}.items`)} className="form-input !w-44" />
                  <button type="button" onClick={() => remove(i)} className="text-neutral-400 hover:text-red-600 px-1" aria-label="Remove week">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => append({ weekStart: "", items: "" })} className="btn-secondary w-fit text-sm">
                + Add week
              </button>
            </div>
          </div>
        </>
      )}

      <div className="col-span-full">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="Optional" />
      </div>
    </>
  );
}
