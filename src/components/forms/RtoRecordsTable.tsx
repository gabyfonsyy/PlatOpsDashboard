"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { RtoRecord, RosterMember } from "@/lib/types";
import { formatManilaDate } from "@/lib/format";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EditRtoDialog } from "@/components/forms/EditRtoDialog";

export function RtoRecordsTable({
  records,
  teams,
  roster,
}: {
  records: RtoRecord[];
  teams: TeamConfig[];
  roster: RosterMember[];
}) {
  const [editing, setEditing] = useState<RtoRecord | null>(null);
  const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Team</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Attendance</th>
            <th className="px-4 py-3">Notes</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {sortedRecords.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">No RTO records yet.</td>
            </tr>
          )}
          {sortedRecords.map((r) => (
            <tr key={r.rto_id}>
              <td className="px-4 py-3 font-medium text-neutral-900">{r.employee_name}</td>
              <td className="px-4 py-3">{r.team_key}</td>
              <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(r.date)}</td>
              <td className="px-4 py-3">{r.attendance_type}</td>
              <td className="px-4 py-3 text-neutral-500">{r.notes}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setEditing(r)}
                    className="text-neutral-400 hover:text-sprout-600 transition-colors"
                    aria-label="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <DeleteButton endpoint="/api/gas/rto" id={r.rto_id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditRtoDialog
          record={editing}
          teams={teams}
          roster={roster}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
