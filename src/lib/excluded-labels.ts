/**
 * User-added labels excluded from every ticket table / label analysis on top of the built-in
 * ANALYSIS_EXCLUDED_LABELS (lib/ticket-breakdowns.ts). Same split and same reasoning as
 * lib/automation-labels.ts: kept client-safe (no server imports) so both the browser editor and a
 * server component can use it, and mirrored into a COOKIE rather than localStorage because the
 * SERVER needs to know the list during render (a page fetches it via next/headers' cookies() and
 * passes it into meaningfulLabels(labels, extra) — see that function's second parameter).
 *
 * Gaby asked for this 2026-09-03: "give me a way to add labels on the frontend and it will take
 * effect for all tables/reports where these are called." This cookie is that mechanism — anywhere
 * that reads it (currently the Lead/Cycle Time deep-dives) honors an edit immediately on the next
 * render, with no rebuild.
 */

export const EXTRA_EXCLUDED_LABELS_COOKIE = "platops-excluded-labels";

const MAX_LABELS = 60;
const MAX_LABEL_LENGTH = 60;

/** Real Jira labels never contain whitespace; letters/digits/underscore/hyphen only. */
const SAFE_LABEL = /^[A-Za-z0-9_-]+$/;

/** Trims, drops anything unsafe/empty, dedupes case-insensitively, caps length and count. */
export function sanitizeExtraExcludedLabels(input: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const label = String(raw ?? "").trim();
    if (!label || label.length > MAX_LABEL_LENGTH) continue;
    if (!SAFE_LABEL.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

export function serializeExtraExcludedLabels(labels: readonly string[]): string {
  return sanitizeExtraExcludedLabels(labels).join(",");
}

/** An absent cookie means "nothing added yet" — an empty list, not the built-in defaults (those
 * live separately in ANALYSIS_EXCLUDED_LABELS and are always applied regardless of this cookie). */
export function resolveExtraExcludedLabels(cookieValue: string | undefined): string[] {
  if (!cookieValue) return [];
  return sanitizeExtraExcludedLabels(decodeURIComponent(cookieValue).split(","));
}

/** Client-side only. Mirrors the list into the cookie; safe to call repeatedly. */
export function persistExtraExcludedLabelsCookie(labels: readonly string[]): void {
  try {
    const value = encodeURIComponent(serializeExtraExcludedLabels(labels));
    document.cookie = `${EXTRA_EXCLUDED_LABELS_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // Cookies blocked: the server falls back to no extra exclusions. Not worth failing over.
  }
}

/** Reads the cookie directly from document.cookie — for the editor's initial client-side state,
 * mirroring what the server already rendered so the first paint and the editor never disagree. */
export function readExtraExcludedLabelsCookieClient(): string[] {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${EXTRA_EXCLUDED_LABELS_COOKIE}=([^;]*)`));
    return resolveExtraExcludedLabels(match?.[1]);
  } catch {
    return [];
  }
}
