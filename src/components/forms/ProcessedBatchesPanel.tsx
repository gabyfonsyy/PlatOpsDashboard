"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { EdgeTab } from "@/components/ui/EdgeTab";
import { ProgressForm } from "@/components/forms/ProgressForm";
import type { ProgressProjectOption, ProgressTicketOption } from "@/components/forms/progress-fields";

/** Logging a batch is a quick, occasional action, not something that needs a permanently-expanded
 * form taking up half the page — pull the edge tab, log one or several batches in the slide-out
 * (it stays open and resets itself after each save), close when done. Same edge-tab mechanism as
 * the "Today" overview panel, stacked below its fixed centre position rather than sharing it. */
export function ProcessedBatchesPanel({
  projects,
  tickets,
}: {
  projects: ProgressProjectOption[];
  tickets: ProgressTicketOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EdgeTab
        icon={ClipboardList}
        label="Batches"
        onClick={() => setOpen(true)}
        open={open}
        className="top-[60%] -translate-y-1/2"
      />
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Log a Processed Batch"
        description="Totals drive each project's progress bar and completion forecast."
      >
        <ProgressForm projects={projects} tickets={tickets} bare />
      </SidePanel>
    </>
  );
}
