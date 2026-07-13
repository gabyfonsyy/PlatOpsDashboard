"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";

const schema = z.object({
  project_name: z.string().min(1, "Required"),
  owning_team: z.string().min(1, "Required"),
  owner: z.string().min(1, "Required"),
  status: z.enum(["Not Started", "In Progress", "Blocked", "Done"]),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  percent_complete: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ProjectForm({ teams }: { teams: TeamConfig[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: "Not Started", percent_complete: 0 },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    await fetch("/api/gas/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSubmitting(false);
    reset();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="col-span-2">
        <label className="form-label">Project Name</label>
        <input {...register("project_name")} className="form-input" placeholder="e.g. DBA Tools rollout" />
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
        <label className="form-label">% Complete</label>
        <input type="number" min={0} max={100} {...register("percent_complete")} className="form-input" />
      </div>
      <div>
        <label className="form-label">Start Date</label>
        <input type="date" {...register("start_date")} className="form-input" />
      </div>
      <div>
        <label className="form-label">Target Date</label>
        <input type="date" {...register("target_date")} className="form-input" />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="Optional" />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Adding…" : "Add Project"}
        </button>
      </div>
    </form>
  );
}
