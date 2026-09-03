"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { sanitizeExtraExcludedLabels, persistExtraExcludedLabelsCookie } from "@/lib/excluded-labels";
import { ANALYSIS_EXCLUDED_LABELS } from "@/lib/ticket-breakdowns";
import { LabelChipEditor } from "@/components/dashboard/LabelChipEditor";

/**
 * Adds to the built-in ANALYSIS_EXCLUDED_LABELS list without touching code — same cookie-first,
 * router.refresh() pattern AutomatedTicketsPanel's catalogue editor already established. `labels`
 * is what the SERVER resolved the cookie to for this render (see lib/excluded-labels.ts), so the
 * editor and the page it's sitting on can never disagree about what's currently excluded.
 *
 * Only affects labels shown/grouped on pages that read this cookie — see that module's doc
 * comment for which ones currently do.
 */
export function ExcludedLabelsEditor({ labels }: { labels: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const commit = (next: readonly string[]) => {
    const clean = sanitizeExtraExcludedLabels(next);
    persistExtraExcludedLabelsCookie(clean);
    startTransition(() => router.refresh());
  };

  return (
    <LabelChipEditor
      title="Excluded Labels"
      description="Hidden from every label column and grouping on this page — the built-in list below, plus anything you add."
      labels={labels}
      onAdd={(label) => commit([...labels, label])}
      onRemove={(label) => commit(labels.filter((l) => l.toLowerCase() !== label.toLowerCase()))}
      onReset={() => commit([])}
      canReset={labels.length > 0}
      addPlaceholder="Add a label to exclude…"
      chipTitle={(label) => `Stop excluding "${label}"`}
      busy={pending}
      readOnlyLabels={[...ANALYSIS_EXCLUDED_LABELS].sort()}
      readOnlyTitle="Built in"
      editableTitle="Added by you"
    />
  );
}
