"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { ProjectRecord } from "@/lib/types";
import {
  projectSchema,
  buildProjectPayload,
  projectToFormValues,
  ProjectFormFields,
  type ProjectFormValues,
} from "@/components/forms/project-fields";

export function EditProjectDialog({
  project,
  computedPercent,
  hasTasks,
  teams,
  onClose,
}: {
  project: ProjectRecord;
  /** The batch-projection percentage ProjectsTable is actually displaying, if any — see projectToFormValues. */
  computedPercent?: number;
  /** Whether this project already has PROJECT_TASKS rows — feeds inferLegacyTrackingMode. */
  hasTasks?: boolean;
  teams: TeamConfig[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: projectToFormValues(project, computedPercent, hasTasks),
  });

  async function onSubmit(values: ProjectFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/gas/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.project_id, ...buildProjectPayload(values) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(`Could not save: ${err instanceof Error ? err.message : String(err)}. If "Unauthorized", sign out and back in.`);
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="card bg-surface w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Edit Project</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ProjectFormFields form={form} teams={teams} />
          <div className="col-span-full flex items-center justify-end gap-3 pt-2">
            {error && <p className="form-error mr-auto">{error}</p>}
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
