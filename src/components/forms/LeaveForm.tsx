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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const form = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveSchema),
    defaultValues: { duration_type: "Full Day", half_day_period: "", num_days: 1 },
  });

  async function onSubmit(values: LeaveFormValues) {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/gas/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLeavePayload(values)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      setMessage({ type: "success", text: `Leave added for ${values.employee_name}.` });
      form.reset({ duration_type: "Full Day", half_day_period: "", num_days: 1 });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: `Could not add leave: ${err instanceof Error ? err.message : String(err)}. If this says "Unauthorized", sign out and back in.`,
      });
    } finally {
      // Always runs — the button can never get stuck on "Adding…".
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="card p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
      <LeaveFormFields form={form} teams={teams} roster={roster} />
      <div className="col-span-full flex items-center gap-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Adding…" : "Add Leave"}
        </button>
        {message && (
          <p className={`text-sm ${message.type === "success" ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
