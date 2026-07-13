"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TeamConfig } from "@/lib/teams";
import type { RosterMember } from "@/lib/types";
import {
  leaveSchema,
  buildLeavePayload,
  LeaveFormFields,
  type LeaveFormValues,
} from "@/components/forms/leave-fields";

export function LeaveForm({ teams, roster }: { teams: TeamConfig[]; roster: RosterMember[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveSchema),
    defaultValues: { duration_type: "Full Day", half_day_period: "", num_days: 1 },
  });

  async function onSubmit(values: LeaveFormValues) {
    setSubmitting(true);
    await fetch("/api/gas/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLeavePayload(values)),
    });
    setSubmitting(false);
    form.reset({ duration_type: "Full Day", half_day_period: "", num_days: 1 });
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="card p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
      <LeaveFormFields form={form} teams={teams} roster={roster} />
      <div className="col-span-full">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Adding…" : "Add Leave"}
        </button>
      </div>
    </form>
  );
}
