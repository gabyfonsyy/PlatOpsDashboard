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
 * The theme is ALSO mirrored into a cookie under this same name.
 *
 * localStorage is the source of truth and always will be — it is what the pre-hydration script
 * reads, and it is what keeps the theme from flashing. The cookie exists for one reason: the
 * SERVER needs to know the theme. The Overview picks which register of its daily AI assessment to
 * fetch from the theme, and that fetch happens during the server render, long before any client
 * code could tell it what localStorage says.
 *
 * Treat it as a cache of localStorage, never as the truth: it can be stale by exactly one request
 * after a theme change, which is why ThemeProvider writes it eagerly and the Overview self-heals
 * when it disagrees.
 */
export const THEME_COOKIE = THEME_STORAGE_KEY;

/** Mirrors the theme into the cookie. Client-side only; safe to call repeatedly. */
export function persistThemeCookie(theme: Theme): void {
  try {
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // Cookies blocked: the server falls back to the default register. Not worth failing over.
  }
}

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
