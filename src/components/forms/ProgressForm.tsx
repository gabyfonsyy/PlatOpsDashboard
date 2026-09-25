"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  progressSchema,
  buildProgressPayload,
  ProgressFormFields,
  type ProgressFormValues,
  type ProgressProjectOption,
  type ProgressTicketOption,
} from "@/components/forms/progress-fields";

export function ProgressForm({
  projects,
  tickets,
  bare = false,
}: {
  projects: ProgressProjectOption[];
  tickets: ProgressTicketOption[];
  /** Skip the outer `.card` + heading — for embedding inside a SidePanel that already shows a
   * title/description in its own header. */
  bare?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const form = useForm<ProgressFormValues>({
    resolver: zodResolver(progressSchema),
    defaultValues: { project_id: "", date: "", issue_key: "", notes: "" },
  });

  async function onSubmit(values: ProgressFormValues) {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/project-tracking/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProgressPayload(values)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      setMessage({ type: "success", text: `Logged ${values.items_processed} processed.` });
      form.reset({ project_id: values.project_id, date: "", issue_key: "", notes: "" });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: `Could not log batch: ${err instanceof Error ? err.message : String(err)}. If this says "Unauthorized", sign out and back in.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={bare ? undefined : "relative overflow-hidden card p-5"}>
      {!bare && (
        <>
          {/* `background-color`, not `border-t-*`: `[data-theme="adhd"] .card` sets `border-color`
              as an unlayered rule in globals.css, which beats any Tailwind border-* class
              regardless of specificity — see HealthDot.tsx's `healthAccentBg` for the full
              explanation. A bg overlay survives every theme instead. */}
          <span className="absolute inset-x-0 top-0 h-1 bg-sprout-500" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-sprout-500" />
            Processed Batches
          </h2>
          <p className="text-sm text-neutral-500 mt-1">
            Log how many items (e.g. databases) each batch processed. Totals drive each project&apos;s
            progress bar and completion forecast.
          </p>
        </>
      )}
      <div className={cn("grid grid-cols-2 gap-4", !bare && "mt-4")}>
        <ProgressFormFields form={form} projects={projects} tickets={tickets} />
        <div className="col-span-2 flex items-center gap-3">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Logging…" : "Log processed batch"}
          </button>
          {message && (
            <p className={`text-sm ${message.type === "success" ? "text-emerald-700" : "text-red-600"}`}>
              {message.text}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
