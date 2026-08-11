"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ProgressRecord } from "@/lib/types";
import {
  progressSchema,
  buildProgressPayload,
  progressToFormValues,
  ProgressFormFields,
  type ProgressFormValues,
  type ProgressProjectOption,
  type ProgressTicketOption,
} from "@/components/forms/progress-fields";

export function EditProgressDialog({
  record,
  projects,
  tickets,
  onClose,
}: {
  record: ProgressRecord;
  projects: ProgressProjectOption[];
  tickets: ProgressTicketOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ProgressFormValues>({
    resolver: zodResolver(progressSchema),
    defaultValues: progressToFormValues(record),
  });

  async function onSubmit(values: ProgressFormValues) {
    setSubmitting(true);
    await fetch("/api/gas/project-progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.progress_id, ...buildProgressPayload(values) }),
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
      <div className="card bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Edit Processed Batch</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ProgressFormFields form={form} projects={projects} tickets={tickets} lockProject />
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
