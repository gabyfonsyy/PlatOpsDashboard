"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A single collapsible section with a count badge in the trigger — shared by the landing page's
 * Ongoing/Completed lists and the drill-down's Linked Tickets section, rather than each owning
 * its own copy of the same chevron/toggle markup. */
export function Accordion({
  title,
  count,
  countLabel,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  countLabel: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight className={cn("w-4 h-4 text-neutral-400 shrink-0 transition-transform", open && "rotate-90")} />
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        </div>
        <span className="text-xs text-neutral-400 whitespace-nowrap">
          {count} {countLabel}
        </span>
      </button>

      {open && <div className="border-t border-neutral-200/70 p-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}
