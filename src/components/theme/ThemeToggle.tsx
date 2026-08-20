"use client";

import { Sun, Moon, Sparkles, Zap } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { THEMES, THEME_LABELS, type Theme } from "@/lib/theme";
import { celebrate } from "@/lib/celebrate";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  adhd: Sparkles,
};

/**
 * Three-way segmented control. A cycle-through-one-button toggle would hide the third mode
 * (nobody discovers "click twice more for sparkles"), and the sparkle icon is the affordance
 * that makes ADHD View findable at all.
 */
export function ThemeToggle() {
  const { theme, setTheme, ready, osReducedMotion, motionOverride, setMotionOverride } = useTheme();

  // Shown only in the one situation where ADHD View looks broken but isn't: the OS asked for
  // reduced motion, so the palette applied and every effect stayed switched off. Without this the
  // failure is invisible and indistinguishable from a bug.
  const motionSuppressed = ready && theme === "adhd" && osReducedMotion && !motionOverride;

  return (
    <div className="flex items-center gap-2">
      {motionSuppressed && (
        <button
          onClick={() => setMotionOverride(true)}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium
                     bg-amber-100 text-amber-800 ring-1 ring-amber-200
                     hover:brightness-105 transition-all duration-200"
          title="Your system is set to reduce motion, so the sparkles are switched off. Turn them on anyway?"
        >
          <Zap className="w-3 h-3" />
          Effects off — turn on
        </button>
      )}

      <div
        className="flex items-center gap-0.5 rounded-full bg-surface/60 backdrop-blur-md p-0.5 ring-1 ring-line/70"
        role="radiogroup"
        aria-label="Colour theme"
      >
        {THEMES.map((t) => {
          const Icon = ICONS[t];
          // Before hydration nothing is marked active — guessing would flash the wrong pill for
          // anyone whose stored theme isn't the default.
          const active = ready && theme === t;
          return (
            <button
              key={t}
              role="radio"
              aria-checked={active}
              aria-label={THEME_LABELS[t]}
              title={THEME_LABELS[t]}
              onClick={() => {
                setTheme(t);
                // Entering ADHD View announces itself. The effects layer mounts on the same tick,
                // so the burst is the first thing it ever draws.
                if (t === "adhd") celebrate("milestone");
              }}
              className={cn(
                "inline-flex items-center justify-center w-7 h-7 rounded-full transition-all duration-200",
                active
                  ? "bg-gradient-to-br from-sprout-500 to-sprout-600 text-white shadow-glow"
                  : "text-neutral-400 hover:text-sprout-600"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
