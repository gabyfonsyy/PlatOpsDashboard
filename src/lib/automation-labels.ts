/**
 * The catalogue of labels that mean "this ticket was raised by automation".
 *
 * Client-safe (no server imports) because both the editor in the browser and the server-side report
 * need it — the same split as lib/theme.ts.
 *
 * This list is NOT cosmetic. A ticket carrying one of these labels is counted as an automated
 * ticket even when a real person owns it as Assigned SE, so editing it moves the scorecard, the
 * averages and the ticket list. That is Gaby's requirement (2026-09-01): "if i add labels here, it
 * will also add the tickets with that label in the records + computations". It is the opposite of
 * the page's Hidden Labels list, which only ever changes what is displayed — the two live in
 * different places for exactly that reason.
 */

/** Gaby's starting set. Editing this array moves the default that Reset returns to. */
export const KNOWN_AUTOMATION_LABELS = ["update-ipwhitelisting", "mirrorassessment"];

/**
 * Mirrored into a cookie rather than kept in localStorage, because the SERVER decides which
 * tickets are in the population and it has to know the list during the render — the same reason
 * the theme is mirrored (see THEME_COOKIE). A cookie also means the Team Stats card and this page
 * read the same list, so the card can never disagree with the page it links to.
 */
export const AUTOMATION_LABELS_COOKIE = "platops-automation-labels";

/** Hard ceilings, so a hand-edited cookie cannot produce an unbounded query. */
const MAX_LABELS = 40;
const MAX_LABEL_LENGTH = 60;

/**
 * Whitelist: letters, digits, underscore, hyphen. Nothing else survives.
 *
 * This is a security boundary, not tidiness. These labels are interpolated into a PostgREST `or`
 * expression (`labels.ilike.*foo*,...`), whose grammar is built from `,` `.` `(` `)` `"` and `*` —
 * a label containing any of those could change the shape of the filter. Real Jira labels cannot
 * contain whitespace and in this instance are all of the form `update-ipwhitelisting`, so a
 * whitelist costs nothing and removes the question entirely.
 */
const SAFE_LABEL = /^[A-Za-z0-9_-]+$/;

/** Trims, drops anything unsafe or empty, dedupes case-insensitively, and caps the length. */
export function sanitizeAutomationLabels(input: readonly string[]): string[] {
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

export function serializeAutomationLabels(labels: readonly string[]): string {
  return sanitizeAutomationLabels(labels).join(",");
}

/**
 * The active list for this request.
 *
 * An ABSENT cookie means "never customised" and falls back to the default. A cookie holding an
 * empty string is a deliberate choice — she cleared the catalogue — and yields an empty list, which
 * narrows the population back to the unowned-ticket rule alone. Those two cases must not collapse
 * into each other, so the caller passes `undefined` for absent rather than `""`.
 */
export function resolveAutomationLabels(cookieValue: string | undefined): string[] {
  if (cookieValue === undefined) return [...KNOWN_AUTOMATION_LABELS];
  return sanitizeAutomationLabels(decodeURIComponent(cookieValue).split(","));
}

/** Client-side only. Mirrors the list into the cookie; safe to call repeatedly. */
export function persistAutomationLabelsCookie(labels: readonly string[]): void {
  try {
    const value = encodeURIComponent(serializeAutomationLabels(labels));
    document.cookie = `${AUTOMATION_LABELS_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // Cookies blocked: the server keeps using the default catalogue. Not worth failing over.
  }
}

/** Case/whitespace-insensitive set for matching a ticket's label CSV. */
export function automationLabelSet(labels: readonly string[]): Set<string> {
  return new Set(labels.map((l) => l.trim().toLowerCase()));
}

/**
 * Whether a ticket carries any catalogued automation label.
 *
 * Matches whole comma-separated TOKENS, never substrings: `fullsyncsso` must not be matched by a
 * ticket labelled `sb-fullsyncsso`, which is a different thing. (The SQL side uses `ilike` and so
 * is a deliberate over-match — a prefilter this function then narrows exactly.)
 */
export function hasAutomationLabel(labelsCsv: string | null | undefined, set: Set<string>): boolean {
  if (set.size === 0) return false;
  return (labelsCsv || "")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .some((l) => set.has(l));
}
