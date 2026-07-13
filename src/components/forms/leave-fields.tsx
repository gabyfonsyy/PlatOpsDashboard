"use client";

import { z } from "zod";
import { useEffect, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { TeamConfig } from "@/lib/teams";
import type { RosterMember } from "@/lib/types";
import { teamSelectOptions } from "@/lib/utils";

export const LEAVE_TYPES = ["Vacation", "Sick", "Emergency", "Bereavement", "Maternity", "Paternity", "Unpaid", "Other"];
export const LEAVE_STATUSES = ["Approved", "Pending", "Cancelled"];

export const leaveSchema = z
  .object({
    team_key: z.string().min(1, "Required"),
    employee_name: z.string().min(1, "Required"),
    leave_type: z.string().min(1, "Required"),
    duration_type: z.enum(["Full Day", "Half Day"]),
    half_day_period: z.string().optional().default(""),
    start_date: z.string().min(1, "Required"),
    end_date: z.string().optional().default(""),
    num_days: z.coerce.number().min(0.5, "Must be at least 0.5"),
    status: z.string().optional().default(""),
    notes: z.string().optional(),
  })
  .refine((v) => v.duration_type === "Full Day" || v.half_day_period !== "", {
    message: "Pick which half",
    path: ["half_day_period"],
  });

export type LeaveFormValues = z.infer<typeof leaveSchema>;

/** Inclusive calendar-day count between two ISO dates, or 0 if invalid/reversed. */
export function inclusiveDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86_400_000) + 1;
}

/** Shapes raw form values into the API payload — normalising half-day (single date) vs full-day. */
export function buildLeavePayload(values: LeaveFormValues) {
  const isHalf = values.duration_type === "Half Day";
  return {
    employee_name: values.employee_name,
    team_key: values.team_key,
    leave_type: values.leave_type,
    start_date: values.start_date,
    end_date: isHalf ? values.start_date : values.end_date || values.start_date,
    num_days: values.num_days,
    half_day_period: isHalf ? values.half_day_period : "",
    status: values.status ?? "",
    notes: values.notes ?? "",
  };
}

/**
 * The shared set of leave input fields, used by both the create form and the edit dialog.
 * The parent owns the <form> and the grid container; this renders the field cells and wires
 * the team→employee filtering plus the num_days auto-sync.
 */
export function LeaveFormFields({
  form,
  teams,
  roster,
  showStatus = false,
}: {
  form: UseFormReturn<LeaveFormValues>;
  teams: TeamConfig[];
  roster: RosterMember[];
  showStatus?: boolean;
}) {
  const { register, watch, setValue, formState: { errors } } = form;

  const teamKey = watch("team_key");
  const durationType = watch("duration_type");
  const startDate = watch("start_date");
  const endDate = watch("end_date");
  const isHalfDay = durationType === "Half Day";

  const rosterForTeam = useMemo(
    () => (teamKey ? roster.filter((m) => m.team_key === teamKey) : roster),
    [roster, teamKey]
  );
  const teamOptions = useMemo(() => teamSelectOptions(teams, roster), [teams, roster]);

  // Keep num_days in sync with the chosen duration so the manager doesn't hand-count.
  useEffect(() => {
    if (isHalfDay) {
      setValue("num_days", 0.5);
    } else {
      const d = inclusiveDays(startDate, endDate || startDate);
      if (d > 0) setValue("num_days", d);
    }
  }, [isHalfDay, startDate, endDate, setValue]);

  return (
    <>
      <div>
        <label className="form-label">Team</label>
        <select {...register("team_key")} className="form-input">
          <option value="">Select…</option>
          {teamOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {errors.team_key && <p className="form-error">{errors.team_key.message}</p>}
      </div>

      <div>
        <label className="form-label">Employee</label>
        <select {...register("employee_name")} className="form-input" disabled={!teamKey}>
          <option value="">{teamKey ? "Select…" : "Select a team first"}</option>
          {rosterForTeam.map((m) => (
            <option key={m.employee_name} value={m.employee_name}>{m.employee_name}</option>
          ))}
        </select>
        {errors.employee_name && <p className="form-error">{errors.employee_name.message}</p>}
      </div>

      <div>
        <label className="form-label">Leave Type</label>
        <select {...register("leave_type")} className="form-input">
          <option value="">Select…</option>
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {errors.leave_type && <p className="form-error">{errors.leave_type.message}</p>}
      </div>

      <div>
        <label className="form-label">Duration</label>
        <select {...register("duration_type")} className="form-input">
          <option value="Full Day">Full Day</option>
          <option value="Half Day">Half Day</option>
        </select>
      </div>

      {isHalfDay ? (
        <>
          <div>
            <label className="form-label">Half</label>
            <select {...register("half_day_period")} className="form-input">
              <option value="">Select…</option>
              <option value="First Half">First Half (AM)</option>
              <option value="Second Half">Second Half (PM)</option>
            </select>
            {errors.half_day_period && <p className="form-error">{errors.half_day_period.message}</p>}
          </div>
          <div>
            <label className="form-label">Date</label>
            <input type="date" {...register("start_date")} className="form-input" />
            {errors.start_date && <p className="form-error">{errors.start_date.message}</p>}
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

      <div>
        <label className="form-label">Number of Days</label>
        <input type="number" step="0.5" {...register("num_days")} className="form-input" readOnly={isHalfDay} />
        {errors.num_days && <p className="form-error">{errors.num_days.message}</p>}
      </div>

      {showStatus && (
        <div>
          <label className="form-label">Status</label>
          <select {...register("status")} className="form-input">
            {LEAVE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      <div className="col-span-full">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="Optional" />
      </div>
    </>
  );
}
