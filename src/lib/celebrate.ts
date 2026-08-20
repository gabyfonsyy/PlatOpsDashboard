/**
 * The reward bus.
 *
 * Core dashboard components call `celebrate("success")` after an action succeeds. They import
 * nothing theme-aware, hold no state, and don't care whether anything is listening — if ADHD View
 * is off (or reduced motion is on) the event simply has no subscriber and nothing happens.
 *
 * That indirection is the point: a new personality effect can subscribe to these events later
 * without touching a single dashboard component, which is what the brief asks for.
 */
export type CelebrationKind =
  /** A small win — a record saved, a row updated. */
  | "success"
  /** A bigger one — a backlog cleared, everything healthy. */
  | "milestone"
  /** Something didn't work. Deliberately understated; failure shouldn't be fun. */
  | "nope"
  /** Easter egg. Louder than anything an ordinary action produces. */
  | "chaos";

export const CELEBRATE_EVENT = "gaby:celebrate";

export type CelebrateDetail = {
  kind: CelebrationKind;
  /** Viewport coords for the burst origin. Defaults to the last pointer position. */
  x?: number;
  y?: number;
};

/** Fire-and-forget. Safe during SSR and safe when no effects layer is mounted. */
export function celebrate(kind: CelebrationKind, at?: { x: number; y: number }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CelebrateDetail>(CELEBRATE_EVENT, {
      detail: { kind, x: at?.x, y: at?.y },
    })
  );
}

/**
 * Briefly marks an element as just-changed so the ADHD stylesheet can flash it. No-op outside
 * ADHD View because the class it adds is only styled there.
 */
export function flashElement(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove("adhd-flash");
  // Reading offsetWidth forces a reflow so re-adding the class restarts the animation rather
  // than being coalesced into no change at all.
  void el.offsetWidth;
  el.classList.add("adhd-flash");
  window.setTimeout(() => el.classList.remove("adhd-flash"), 500);
}
