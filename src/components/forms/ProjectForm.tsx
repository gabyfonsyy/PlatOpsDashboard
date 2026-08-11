"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TeamConfig } from "@/lib/teams";
import {
  projectSchema,
  buildProjectPayload,
  ProjectFormFields,
  type ProjectFormValues,
} from "@/components/forms/project-fields";

export function ProjectForm({ teams }: { teams: TeamConfig[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: { status: "Not Started", tracking_mode: "manual", percent_complete: 0, teams_involved: [], weekly_plan: [] },
  });

  async function onSubmit(values: ProjectFormValues) {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/gas/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProjectPayload(values)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      setMessage({ type: "success", text: `Project “${values.project_name}” added.` });
      form.reset({ status: "Not Started", tracking_mode: "manual", percent_complete: 0, teams_involved: [], weekly_plan: [] });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: `Could not add project: ${err instanceof Error ? err.message : String(err)}. If this says "Unauthorized", sign out and back in.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
      <ProjectFormFields form={form} teams={teams} />
      <div className="col-span-2 sm:col-span-4 flex items-center gap-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Adding…" : "Add Project"}
        </button>
        {message && (
          <p className={`text-sm ${message.type === "success" ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
