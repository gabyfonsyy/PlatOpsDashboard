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
  date: z.string().min(1, "Required"),
  attendance_type: z.enum(["In-Office", "Remote", "Absent", "Leave"]),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function RtoForm({ teams }: { teams: TeamConfig[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    await fetch("/api/gas/rto", {
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
        <label className="form-label">Date</label>
        <input type="date" {...register("date")} className="form-input" />
        {errors.date && <p className="form-error">{errors.date.message}</p>}
      </div>
      <div>
        <label className="form-label">Attendance</label>
        <select {...register("attendance_type")} className="form-input">
          <option value="In-Office">In-Office</option>
          <option value="Remote">Remote</option>
          <option value="Absent">Absent</option>
          <option value="Leave">Leave</option>
        </select>
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="Optional" />
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={submitting} className="btn-primary w-full justify-center">
          {submitting ? "Logging…" : "Log Attendance"}
        </button>
      </div>
    </form>
  );
}
