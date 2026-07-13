"use client";

import { z } from "zod";
import { useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { TeamConfig } from "@/lib/teams";
import type { RosterMember } from "@/lib/types";
import { teamSelectOptions } from "@/lib/utils";

export const ATTENDANCE_TYPES = ["In-Office", "Remote", "Absent", "Leave"] as const;

export const rtoSchema = z.object({
  team_key: z.string().min(1, "Required"),
  employee_name: z.string().min(1, "Required"),
  date: z.string().min(1, "Required"),
  attendance_type: z.enum(ATTENDANCE_TYPES),
  notes: z.string().optional(),
});

export type RtoFormValues = z.infer<typeof rtoSchema>;

export function buildRtoPayload(values: RtoFormValues) {
  return {
    employee_name: values.employee_name,
    team_key: values.team_key,
    date: values.date,
    attendance_type: values.attendance_type,
    notes: values.notes ?? "",
  };
}

/**
 * Shared RTO input fields, used by both the create form and the edit dialog. The parent owns
 * the <form> and grid; this renders the field cells and wires the team→employee filtering.
 */
export function RtoFormFields({
  form,
  teams,
  roster,
}: {
  form: UseFormReturn<RtoFormValues>;
  teams: TeamConfig[];
  roster: RosterMember[];
}) {
  const { register, watch, formState: { errors } } = form;
  const teamKey = watch("team_key");

  const rosterForTeam = useMemo(
    () => (teamKey ? roster.filter((m) => m.team_key === teamKey) : roster),
    [roster, teamKey]
  );
  const teamOptions = useMemo(() => teamSelectOptions(teams, roster), [teams, roster]);

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
        <label className="form-label">Date</label>
        <input type="date" {...register("date")} className="form-input" />
        {errors.date && <p className="form-error">{errors.date.message}</p>}
      </div>

      <div>
        <label className="form-label">Attendance</label>
        <select {...register("attendance_type")} className="form-input">
          {ATTENDANCE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="col-span-full">
        <label className="form-label">Notes</label>
        <input {...register("notes")} className="form-input" placeholder="Optional" />
      </div>
    </>
  );
}
