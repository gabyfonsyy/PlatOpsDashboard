"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TeamConfig } from "@/lib/teams";

const schema = z.object({
  employee_name: z.string().min(1, "Required"),
  team_key: z.string().min(1, "Required"),
  leave_type: z.string().min(1, "Required"),
  start_date: z.string().min(1, "Required"),
  end_date: z.string().min(1, "Required"),
  num_days: z.coerce.number().min(0.5, "Must be at least 0.5"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const LEAVE_TYPES = ["Vacation", "Sick", "Emergency", "Bereavement", "Maternity", "Paternity", "Unpaid", "Other"];

export function LeaveForm({ teams }: { teams: TeamConfig[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    await fetch("/api/gas/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSubmitting(false);
    reset();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
      <div>
        <label className="form-label">Employee</label>
        <input {...register("employee_name")} className="form-input" placeholder="Full name" />
        {errors.employee_name && <p className="form-error">{errors.employee_name.message}</p>}
      </div>
      <div>
        <label className="form-label">Team</label>
        <select {...register("team_key")} className="form-input">
          <option value="">Select…</option>
          {teams.map((t) => <option key={t.team_key} value={t.team_key}>{t.team_name}</option>)}
        </select>
        {errors.team_key && <p className="form-error">{errors.team_key.message}</p>}
      </div>
      <div>
        <label className="form-label">Leave Type</label>
        <select {...register("leave_type")} className="form-input">
          <option value="">Select…</option>
          {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {errors.leave_type && <p className="form-error">{errors.leave_type.message}</p>}
      </div>
      <div>
        <label className="form-label">Start Date</label>
        <input type="date" {...register("start_date")} className="form-input" />
        {errors.start_date && <p className="form-error">{errors.start_date.message}</p>}
      </div>
      <div>
        <label className="form-label">End Date</label>
        <input type="date" {...register("end_date")} className="form-input" />
        {errors.end_date && <p className="form-error">{errors.end_date.message}</p>}
      </div>
      <div>
        <label className="form-label">Number of Days</label>
        <input type="number" step="0.5" {...register("num_days")} className="form-input" />
        {errors.num_days && <p className="form-error">{errors.num_days.message}</p>}
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="Optional" />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Adding…" : "Add Leave"}
        </button>
      </div>
    </form>
  );
}
