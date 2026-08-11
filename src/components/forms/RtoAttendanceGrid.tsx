"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { RosterMember, RtoRecord } from "@/lib/types";
import { teamSelectOptions, cn } from "@/lib/utils";
import { ATTENDANCE_TYPES } from "@/components/forms/rto-fields";

const TONE: Record<(typeof ATTENDANCE_TYPES)[number], string> = {
  "In-Office": "data-[active=true]:bg-sprout-500 data-[active=true]:text-white",
  "Remote": "data-[active=true]:bg-sky-500 data-[active=true]:text-white",
  "Absent": "data-[active=true]:bg-red-500 data-[active=true]:text-white",
  "Leave": "data-[active=true]:bg-amber-500 data-[active=true]:text-white",
};

/**
 * "Take attendance" bulk entry — one row per roster member for a picked team+date, a quick
 * button per person instead of the old one-employee-per-submission form. Team/date live in the
 * URL (?attTeam=&attDate=) so picking a new one re-fetches roster + that day's existing records
 * server-side; the page keys this component by `${team}-${date}` so switching either fully
 * remounts it and re-seeds local state from the fresh props instead of carrying stale picks over.
 */
export function RtoAttendanceGrid({
  teams,
  roster,
  existingRecords,
  team,
  date,
}: {
  teams: TeamConfig[];
  roster: RosterMember[];
  /** This team's existing RTO rows for `date`, for prefill when re-visiting an already-logged day. */
  existingRecords: RtoRecord[];
  team: string;
  date: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const teamOptions = teamSelectOptions(teams, roster);
  const rosterForTeam = roster.filter((m) => m.team_key === team);
  const existingByEmployee = new Map(existingRecords.map((r) => [r.employee_name, r.attendance_type]));

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    rosterForTeam.forEach((m) => {
      initial[m.employee_name] = existingByEmployee.get(m.employee_name) || "In-Office";
    });
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  async function saveAll() {
    setSubmitting(true);
    setMessage(null);
    try {
      const entries = rosterForTeam.map((m) => ({
        employee_name: m.employee_name,
        team_key: team,
        attendance_type: values[m.employee_name] || "In-Office",
      }));
      const res = await fetch("/api/gas/rto/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, entries }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setMessage({ type: "success", text: `Saved attendance for ${entries.length} people.` });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: `Could not save attendance: ${err instanceof Error ? err.message : String(err)}. If this says "Unauthorized", sign out and back in.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-end gap-3 transition-opacity", isPending && "opacity-60")}>
        <div>
          <label className="form-label">Team</label>
          <select
            value={team}
            onChange={(e) => updateParams({ attTeam: e.target.value })}
            disabled={isPending}
            className="form-input w-auto disabled:cursor-wait"
          >
            {teamOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => updateParams({ attDate: e.target.value })}
            disabled={isPending}
            className="form-input w-auto disabled:cursor-wait"
          />
        </div>
        {isPending && <Loader2 className="w-4 h-4 animate-spin text-neutral-400 self-center" />}
      </div>

      {rosterForTeam.length === 0 ? (
        <p className="text-sm text-neutral-400">No active roster members for this team.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rosterForTeam.map((m) => (
            <div
              key={m.employee_name}
              className="flex items-center justify-between gap-3 bg-neutral-50 rounded-md border border-neutral-200 px-3 py-2"
            >
              <span className="text-sm font-medium text-neutral-800">{m.employee_name}</span>
              <div className="flex items-center gap-1">
                {ATTENDANCE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-active={values[m.employee_name] === t}
                    onClick={() => setValues((prev) => ({ ...prev, [m.employee_name]: t }))}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium text-neutral-500 bg-white border border-neutral-200 transition-colors",
                      TONE[t]
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={saveAll}
          disabled={submitting || rosterForTeam.length === 0}
          className="btn-primary w-fit"
        >
          {submitting ? "Saving…" : `Save Attendance (${rosterForTeam.length})`}
        </button>
        {message && (
          <p className={`text-sm ${message.type === "success" ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
