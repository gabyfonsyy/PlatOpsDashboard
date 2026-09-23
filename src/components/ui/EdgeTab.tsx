"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * A pull-tab fixed to the right edge of the viewport — the same affordance
 * `OverviewQuickPanel`'s "Today" compass tab uses: the button and the SidePanel it opens read as
 * one object, one pulled out of the other, so a thing you consult mid-task and dismiss doesn't
 * need to live permanently in the page body. Icon-only until hovered, when a short vertical label
 * unfolds — a permanent word on an edge tab is a permanent distraction, an icon alone is a guess.
 *
 * Unlike the Today tab (mounted globally, one fixed vertical position), this is meant to be
 * mounted per-page and stacked — callers pass their own `style`/`className` offset so multiple
 * tabs on the same page don't collide.
 */
export function EdgeTab({
  icon: Icon,
  label,
  onClick,
  open,
  style,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  /** Hides the tab while its own panel is open, same as the Today tab. */
  open?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={style}
      className={cn(
        "group fixed right-0 z-30",
        "flex items-center gap-2 py-3 pl-2.5 pr-2",
        "rounded-l-xl border border-r-0 border-line/70 bg-surface/80 backdrop-blur-xl shadow-card",
        "text-neutral-400 hover:text-sprout-700 hover:pr-3 transition-all duration-200",
        open && "opacity-0 pointer-events-none",
        className
      )}
      aria-label={label}
      title={label}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span
        className="max-w-0 group-hover:max-w-8 overflow-hidden transition-all duration-200 text-[11px] font-medium tracking-wide whitespace-nowrap"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  );
}
