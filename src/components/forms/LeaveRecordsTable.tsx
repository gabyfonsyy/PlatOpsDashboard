"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { LeaveRecord, RosterMember } from "@/lib/types";
import { formatManilaDate } from "@/lib/format";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EditLeaveDialog } from "@/components/forms/EditLeaveDialog";

function dateRange(r: LeaveRecord): string {
  const start = formatManilaDate(r.start_date);
  const end = formatManilaDate(r.end_date);
  if (!end || start === end) return start;
  return `${start} → ${end}`;
}

export function LeaveRecordsTable({
  records,
  teams,
  roster,
}: {
  records: LeaveRecord[];
  teams: TeamConfig[];
  roster: RosterMember[];
}) {
  const [editing, setEditing] = useState<LeaveRecord | null>(null);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Team</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Dates</th>
            <th className="px-4 py-3">Days</th>
            <th className="px-4 py-3">Half Day</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {records.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-neutral-400">No leave records yet.</td>
            </tr>
          )}
          {records.map((r) => (
            <tr key={r.leave_id}>
              <td className="px-4 py-3 font-medium text-neutral-900">{r.employee_name}</td>
              <td className="px-4 py-3">{r.team_key}</td>
              <td className="px-4 py-3">{r.leave_type}</td>
              <td className="px-4 py-3 whitespace-nowrap">{dateRange(r)}</td>
              <td className="px-4 py-3">{r.num_days}</td>
              <td className="px-4 py-3 whitespace-nowrap text-neutral-600">{r.half_day_period || "—"}</td>
              <td className="px-4 py-3">{r.status}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setEditing(r)}
                    className="text-neutral-400 hover:text-sprout-600 transition-colors"
                    aria-label="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <DeleteButton endpoint="/api/gas/leave" id={r.leave_id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditLeaveDialog
          record={editing}
          teams={teams}
          roster={roster}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
