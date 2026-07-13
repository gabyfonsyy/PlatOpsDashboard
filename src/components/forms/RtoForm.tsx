"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TeamConfig } from "@/lib/teams";
import type { RosterMember } from "@/lib/types";
import {
  rtoSchema,
  buildRtoPayload,
  RtoFormFields,
  type RtoFormValues,
} from "@/components/forms/rto-fields";

export function RtoForm({ teams, roster }: { teams: TeamConfig[]; roster: RosterMember[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<RtoFormValues>({
    resolver: zodResolver(rtoSchema),
    defaultValues: { attendance_type: "In-Office" },
  });

  async function onSubmit(values: RtoFormValues) {
    setSubmitting(true);
    await fetch("/api/gas/rto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRtoPayload(values)),
    });
    setSubmitting(false);
    form.reset({ attendance_type: "In-Office" });
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
      <RtoFormFields form={form} teams={teams} roster={roster} />
      <div className="col-span-full">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Logging…" : "Log Attendance"}
        </button>
      </div>
    </form>
  );
}
