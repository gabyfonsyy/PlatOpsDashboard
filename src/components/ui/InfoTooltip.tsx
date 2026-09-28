import { Info } from "lucide-react";

/**
 * Small "i" affordance with a hover/focus tooltip — the same dark-chip pattern MetricCard uses,
 * lifted here so every card (Business Review Prep's metric cards, etc.) shows an identical one.
 *
 * bg-gray-900 (Tailwind's stock scale), NOT bg-neutral-900 — this app's "neutral" ramp inverts
 * under the dark/adhd theme (globals.css), which would flip the chip to white-on-white. A tooltip
 * must stay a dark chip in every theme. Opens BELOW the trigger so it isn't clipped off the top of
 * the viewport on cards near the top of a page.
 */
export function InfoTooltip({ text, widthClass = "w-56" }: { text: string; widthClass?: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info
        className="w-3.5 h-3.5 text-neutral-300 hover:text-neutral-500 cursor-help transition-colors"
        tabIndex={0}
        aria-label={text}
      />
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 ${widthClass}
                   rounded-lg bg-gray-900 text-white text-[11px] leading-snug font-normal normal-case tracking-normal
                   px-3 py-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-30 shadow-lg`}
      >
        {text}
      </span>
    </span>
  );
}
