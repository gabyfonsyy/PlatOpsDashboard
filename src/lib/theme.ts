/**
 * Theme model. Client-safe (no server imports) so both the provider and plain components can
 * pull from it.
 *
 * "adhd" is a full theme rather than a flag on top of dark: it has its own palette in globals.css
 * AND it gates the personality layer. Keeping it in the same enum means there is exactly one piece
 * of state to persist and one attribute to read, instead of a theme plus an orthogonal boolean
 * that could disagree with it.
 */
export const THEMES = ["light", "dark", "adhd"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "light";

/** localStorage key. Also read by the pre-hydration script in app/layout.tsx — keep in step. */
export const THEME_STORAGE_KEY = "platops-theme";

/**
 * Explicit opt-in to motion despite an OS `prefers-reduced-motion: reduce` setting.
 *
 * Respecting that preference is the correct default, but it must not be a prison: someone who
 * deliberately turned ADHD View on has asked for the sparkles, and silently giving them a static
 * purple theme instead — with no indication why — is worse than either honest outcome. So the
 * default stays "respect the OS", and this makes it one click to override, per-browser.
 *
 * Also mirrored onto `<html data-motion="force">` so the CSS reduced-motion block can stand down
 * too; otherwise the JS effects would run while every CSS transition stayed frozen.
 */
export const MOTION_STORAGE_KEY = "platops-motion-override";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * User-facing names. The `adhd` KEY is deliberately unchanged: it's the persisted localStorage
 * value and the `data-theme` attribute every ADHD-scoped CSS rule keys off, so renaming it would
 * silently reset the theme for anyone who already had it selected.
 */
export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  adhd: "Gaby's View",
};
