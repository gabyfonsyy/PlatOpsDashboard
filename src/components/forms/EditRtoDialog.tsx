"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { RtoRecord, RosterMember } from "@/lib/types";
import { formatManilaDate } from "@/lib/format";
import {
  rtoSchema,
  buildRtoPayload,
  RtoFormFields,
  ATTENDANCE_TYPES,
  type RtoFormValues,
} from "@/components/forms/rto-fields";

function recordToFormValues(r: RtoRecord): RtoFormValues {
  const attendance = (ATTENDANCE_TYPES as readonly string[]).includes(r.attendance_type)
    ? (r.attendance_type as RtoFormValues["attendance_type"])
    : "In-Office";
  return {
    team_key: r.team_key,
    employee_name: r.employee_name,
    date: formatManilaDate(r.date),
    attendance_type: attendance,
    notes: r.notes || "",
  };
}

export function EditRtoDialog({
  record,
  teams,
  roster,
  onClose,
}: {
  record: RtoRecord;
  teams: TeamConfig[];
  roster: RosterMember[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<RtoFormValues>({
    resolver: zodResolver(rtoSchema),
    defaultValues: recordToFormValues(record),
  });

  async function onSubmit(values: RtoFormValues) {
    setSubmitting(true);
    await fetch("/api/gas/rto", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.rto_id, ...buildRtoPayload(values) }),
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
        className="card bg-surface w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Edit Attendance</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
          <RtoFormFields form={form} teams={teams} roster={roster} />
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
