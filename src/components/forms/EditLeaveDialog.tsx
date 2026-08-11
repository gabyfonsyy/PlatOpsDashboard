"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { LeaveRecord, RosterMember } from "@/lib/types";
import { formatManilaDate } from "@/lib/format";
import {
  leaveSchema,
  buildLeavePayload,
  splitLeaveType,
  LeaveFormFields,
  type LeaveFormValues,
} from "@/components/forms/leave-fields";

/** Maps a stored record into the form's shape (half-day derivation + Manila-normalised dates). */
function recordToFormValues(r: LeaveRecord): LeaveFormValues {
  const isHalf = String(r.half_day_period || "").trim() !== "";
  const { leave_type, leave_type_other } = splitLeaveType(r.leave_type);
  return {
    team_key: r.team_key,
    employee_name: r.employee_name,
    leave_type,
    leave_type_other,
    duration_type: isHalf ? "Half Day" : "Full Day",
    half_day_period: r.half_day_period || "",
    start_date: formatManilaDate(r.start_date),
    end_date: formatManilaDate(r.end_date),
    num_days: Number(r.num_days) || 0,
    status: r.status || "Approved",
    notes: r.notes || "",
  };
}

export function EditLeaveDialog({
  record,
  teams,
  roster,
  onClose,
}: {
  record: LeaveRecord;
  teams: TeamConfig[];
  roster: RosterMember[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveSchema),
    defaultValues: recordToFormValues(record),
  });

  async function onSubmit(values: LeaveFormValues) {
    setSubmitting(true);
    await fetch("/api/gas/leave", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.leave_id, ...buildLeavePayload(values) }),
    });
    setSubmitting(false);
    onClose();
    router.refresh();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Edit Leave</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
          <LeaveFormFields form={form} teams={teams} roster={roster} showStatus />
          <div className="col-span-full flex items-center justify-end gap-2 pt-2">
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
