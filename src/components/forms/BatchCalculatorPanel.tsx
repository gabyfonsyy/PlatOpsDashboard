"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { EdgeTab } from "@/components/ui/EdgeTab";
import { BatchCalculator } from "@/components/forms/BatchCalculator";

/** Same edge-tab mechanism as the "Today" overview panel — stacked just below the Batches tab
 * rather than taking up permanent space in the page body. */
export function BatchCalculatorPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EdgeTab
        icon={Calculator}
        label="Calculator"
        onClick={() => setOpen(true)}
        open={open}
        className="top-[72%] -translate-y-1/2"
      />
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Batch Projection Calculator"
        description="Fixed batch size at a weekly cadence. Fill total items + batch size, then either a cadence (→ completion date) or a target date (→ required cadence)."
      >
        <BatchCalculator bare />
      </SidePanel>
    </>
  );
}
