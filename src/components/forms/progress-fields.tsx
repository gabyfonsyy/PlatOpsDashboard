"use client";

import { z } from "zod";
import { useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ProgressRecord } from "@/lib/types";
import { formatManilaDate } from "@/lib/format";

/** A project option for the dropdown. */
export type ProgressProjectOption = { project_id: string; project_name: string; owning_team?: string };
/** A ticket option, tagged with the project it resolves to so the dropdown can filter by project. */
export type ProgressTicketOption = { issue_key: string; summary: string; project_id?: string };

export const progressSchema = z.object({
  project_id: z.string().min(1, "Required"),
  date: z.string().min(1, "Required"),
  issue_key: z.string().optional().default(""),
  items_processed: z.coerce.number().min(1, "Must be at least 1"),
  notes: z.string().optional().default(""),
});

export type ProgressFormValues = z.infer<typeof progressSchema>;

/** Shapes raw form values into the API payload. */
export function buildProgressPayload(values: ProgressFormValues) {
  return {
    project_id: values.project_id,
    date: values.date,
    issue_key: values.issue_key ?? "",
    items_processed: values.items_processed,
    notes: values.notes ?? "",
  };
}

/** Maps a stored record into the form's shape (Manila-normalised date). */
export function progressToFormValues(r: ProgressRecord): ProgressFormValues {
  return {
    project_id: r.project_id,
    date: r.date ? formatManilaDate(r.date) : "",
    issue_key: r.issue_key || "",
    items_processed: Number(r.items_processed) || 0,
    notes: r.notes || "",
  };
}

/**
 * Shared processed-batch field cells, used by both the create form and the edit dialog. The
 * parent owns the <form> and a grid container. The ticket dropdown is filtered to the tickets
 * linked to the chosen project (falls back to all tickets when none resolve to it).
 */
export function ProgressFormFields({
  form,
  projects,
  tickets,
  lockProject = false,
}: {
  form: UseFormReturn<ProgressFormValues>;
  projects: ProgressProjectOption[];
  tickets: ProgressTicketOption[];
  /** When editing, keep the project fixed (the row belongs to one project). */
  lockProject?: boolean;
}) {
  const { register, watch, formState: { errors } } = form;
  const projectId = watch("project_id");

  const ticketOptions = useMemo(() => {
    const scoped = tickets.filter((t) => t.project_id && t.project_id === projectId);
    const list = scoped.length ? scoped : tickets;
    // Order by ticket key, numeric-aware so DEV-9 sorts before DEV-45 (and keys group by prefix).
    return [...list].sort((a, b) =>
      a.issue_key.localeCompare(b.issue_key, undefined, { numeric: true, sensitivity: "base" }));
  }, [tickets, projectId]);

  return (
    <>
      <div className="col-span-2">
        <label className="form-label">Project</label>
        <select {...register("project_id")} className="form-input" disabled={lockProject}>
          <option value="">Select…</option>
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
          ))}
        </select>
        {errors.project_id && <p className="form-error">{errors.project_id.message}</p>}
      </div>

      <div>
        <label className="form-label">Date Processed</label>
        <input type="date" {...register("date")} className="form-input" />
        {errors.date && <p className="form-error">{errors.date.message}</p>}
      </div>

      <div>
        <label className="form-label">Items Processed</label>
        <input type="number" min={1} {...register("items_processed")} className="form-input" placeholder="e.g. 300" />
        {errors.items_processed && <p className="form-error">{errors.items_processed.message}</p>}
      </div>

      <div className="col-span-2">
        <label className="form-label">
          Ticket <span className="text-neutral-400 font-normal">(optional)</span>
        </label>
        <select {...register("issue_key")} className="form-input" disabled={!projectId}>
          <option value="">{projectId ? "— none —" : "Select a project first"}</option>
          {ticketOptions.map((t) => (
            <option key={t.issue_key} value={t.issue_key}>
              {t.issue_key}{t.summary ? ` — ${t.summary}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="col-span-full">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="e.g. HR-DB-01" />
      </div>
    </>
  );
}
