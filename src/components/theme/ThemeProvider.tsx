"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_THEME,
  MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isTheme,
  persistThemeCookie,
  type Theme,
} from "@/lib/theme";

/**
 * Hand-rolled rather than next-themes: there are three modes, only two of which are colour
 * schemes, and the third also gates a behavioural layer. next-themes would need bending to
 * express that, for ~40 lines of state we can own outright — and the brief asks not to add
 * dependencies the stack can already handle.
 *
 * The <html data-theme> attribute is the single source of truth for CSS. It's set by the
 * pre-hydration script in app/layout.tsx (so there's no flash of the wrong theme) and kept in
 * step here.
 */

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** True once mounted — lets consumers avoid rendering theme-dependent markup during SSR. */
  ready: boolean;
  /** The OS preference, watched live. */
  osReducedMotion: boolean;
  /** User's explicit "yes, animate anyway". */
  motionOverride: boolean;
  setMotionOverride: (on: boolean) => void;
  /** The resolved answer the effects layer acts on. */
  motionAllowed: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  ready: false,
  osReducedMotion: false,
  motionOverride: false,
  setMotionOverride: () => {},
  motionAllowed: true,
});

/**
 * The personality layer, loaded only when it's actually wanted. `ssr: false` plus a dynamic
 * import means the canvas/particle code is a separate chunk that never reaches the browser in
 * Light or Dark mode — the brief's performance requirement, enforced by the bundler rather than
 * by an `if` at runtime.
 */
const AdhdEffects = dynamic(() => import("@/components/theme/AdhdEffects"), { ssr: false });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);
  const [osReducedMotion, setOsReducedMotion] = useState(false);
  const [motionOverride, setMotionOverrideState] = useState(false);

  // Watched live rather than read once: someone flipping the OS setting shouldn't need a reload
  // to be respected (or un-respected).
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setOsReducedMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    } catch {
      // Blocked storage: default to respecting the OS.
    }
    if (stored === "1") {
      setMotionOverrideState(true);
      document.documentElement.dataset.motion = "force";
    }
  }, []);

  const setMotionOverride = useCallback((on: boolean) => {
    setMotionOverrideState(on);
    if (on) {
      document.documentElement.dataset.motion = "force";
    } else {
      delete document.documentElement.dataset.motion;
    }
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, on ? "1" : "0");
    } catch {
      // Non-fatal.
    }
  }, []);

  // Adopt whatever the pre-hydration script already applied, so the attribute and React state
  // agree without a second repaint.
  useEffect(() => {
    const fromDom = document.documentElement.dataset.theme;
    if (isTheme(fromDom)) {
      setThemeState(fromDom);
      // Back-fills the cookie for anyone who chose a theme before it existed, so the server sees
      // the right one without them having to re-pick.
      persistThemeCookie(fromDom);
    } else {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // Private-mode / blocked storage: fall through to the default rather than breaking.
      }
      if (isTheme(stored)) {
        setThemeState(stored);
        persistThemeCookie(stored);
      }
    }
    setReady(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persisting is a nicety; the session still works without it.
    }
    // Mirrored so the next SERVER render knows the theme — see THEME_COOKIE in lib/theme.ts.
    persistThemeCookie(next);
  }, []);

  const motionAllowed = !osReducedMotion || motionOverride;

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      ready,
      osReducedMotion,
      motionOverride,
      setMotionOverride,
      motionAllowed,
    }),
    [theme, setTheme, ready, osReducedMotion, motionOverride, setMotionOverride, motionAllowed]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      {/* Gated here rather than inside the effects component, so there is exactly one place that
          decides whether the personality layer exists — and so it genuinely isn't mounted (no
          canvas, no listeners, no rAF loop) when it shouldn't be. */}
      {theme === "adhd" && motionAllowed && <AdhdEffects />}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
