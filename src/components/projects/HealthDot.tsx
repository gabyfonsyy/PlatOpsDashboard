import { HEALTH_META, type ProjectHealth } from "@/lib/project-tracking";
import { cn } from "@/lib/utils";

const TONE_BG: Record<"success" | "warning" | "danger" | "neutral", string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-neutral-300",
};

/** A single colored dot for a project's health — the same tone `HEALTH_META`/`Badge` already use,
 * just small enough to sit inline in a compact row without a text label. Unset health reads as a
 * neutral dot, not an alarming one. */
export function HealthDot({ health, className }: { health: ProjectHealth; className?: string }) {
  const tone = health ? HEALTH_META[health].tone : "neutral";
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full shrink-0", TONE_BG[tone], className)}
      aria-hidden="true"
      title={health ? HEALTH_META[health].label : "Health not set"}
    />
  );
}

/** A `background-color` class in the same tone as `HealthDot` — for a card's colored accent bar.
 * Deliberately NOT a `border` colour: `[data-theme="adhd"] .card` (globals.css) sets `border-color`
 * on every card as an unlayered rule, which beats ANY Tailwind border utility regardless of
 * specificity (unlayered CSS always wins over `@layer utilities`, where Tailwind's classes live) —
 * a `border-l-*` accent silently disappears the moment Gaby View is active. `background-color` on
 * a small overlay element isn't touched by that rule, so this is the one technique that survives
 * every theme without needing its own `[data-theme="adhd"]` override. */
export function healthAccentBg(health: ProjectHealth): string {
  const tone = health ? HEALTH_META[health].tone : "neutral";
  return TONE_BG[tone];
}
