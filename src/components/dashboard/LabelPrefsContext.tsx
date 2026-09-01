"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ANALYSIS_EXCLUDED_LABELS } from "@/lib/ticket-breakdowns";

/**
 * localStorage holds the one DISPLAY preference: the hidden-label list.
 *
 * The automation-label catalogue is deliberately NOT here: it selects tickets, so the server needs
 * it during the render and it lives in a cookie instead (lib/automation-labels.ts). Keeping the two
 * in different places is the point — one changes what you see, the other changes what is counted.
 */
const STORAGE_KEY = "platops-automated-label-prefs-v3";

/**
 * Stale keys are tolerated, not versioned away: an earlier build also stored a `basis` field for a
 * unique-tickets / label-occurrences toggle that Gaby removed on 2026-09-01. Anything unrecognised
 * here is simply ignored, so her hidden list survives rather than being reset.
 */
type StoredPrefs = { hidden: string[] };

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** A label CSV split into tokens, with the currently hidden ones removed. */
export function visibleLabels(raw: string, hidden: Set<string>): string[] {
  return raw
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !hidden.has(normalizeLabel(l)));
}

type LabelPrefs = {
  hidden: string[];
  hiddenSet: Set<string>;
  isDefaultHidden: boolean;
  setHidden: (next: string[]) => void;
};

const LabelPrefsContext = createContext<LabelPrefs | null>(null);

/**
 * Owner of the hidden-label list — the page's one DISPLAY-ONLY label preference.
 *
 * It has a single consumer today (AutomatedTicketsPanel), so it could be inlined there. It is kept
 * separate for two reasons: it is where the invariant lives — hiding a label changes which rows a
 * label table has and NOTHING else, never a ticket count, an average, or which tickets are listed —
 * and it briefly had a second consumer (a By Label breakdown card, since removed), so the next thing
 * that needs the list will need this again.
 *
 * Why localStorage and not a cookie: a cookie would let the SERVER apply the exclusion, but it would
 * also turn a display-only toggle into a server round-trip and re-query on every chip. The
 * automation-label catalogue is the opposite case and correctly does use a cookie
 * (lib/automation-labels.ts) — it selects tickets, so the server has to know it.
 *
 * Server components can still render inside this provider — they are passed in as children from the
 * server page and arrive as an already-rendered payload.
 */
export function LabelPrefsProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState<string[]>([...ANALYSIS_EXCLUDED_LABELS]);

  // Read in an effect, not in the initial state: everything under this provider is server-rendered
  // first, and seeding state from localStorage during render would make the server and client
  // markup disagree. Same pattern as ThemeProvider.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      if (Array.isArray(parsed.hidden) && parsed.hidden.every((x) => typeof x === "string")) {
        setHiddenState(parsed.hidden);
      }
    } catch {
      // Blocked or corrupt storage falls through to the defaults.
    }
  }, []);

  const setHidden = useCallback((next: string[]) => {
    setHiddenState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: next } satisfies StoredPrefs));
    } catch {
      // Nothing to do — the change still applies for this page view.
    }
  }, []);

  const value = useMemo<LabelPrefs>(() => {
    const hiddenSet = new Set(hidden.map(normalizeLabel));
    const isDefaultHidden =
      hidden.length === ANALYSIS_EXCLUDED_LABELS.length &&
      ANALYSIS_EXCLUDED_LABELS.every((l) => hiddenSet.has(normalizeLabel(l)));
    return { hidden, hiddenSet, isDefaultHidden, setHidden };
  }, [hidden, setHidden]);

  return <LabelPrefsContext.Provider value={value}>{children}</LabelPrefsContext.Provider>;
}

export function useLabelPrefs(): LabelPrefs {
  const ctx = useContext(LabelPrefsContext);
  if (!ctx) throw new Error("useLabelPrefs must be used inside a LabelPrefsProvider");
  return ctx;
}
