"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Right-hand slide-over. Used for the things you do at the END of a day — the check-in and Work
 * Mirror — which are worth having available without them taking up half the page all day.
 *
 * Deliberately not a `<dialog>`: the native element's backdrop can't be transitioned in every
 * browser this has to work in, and its top-layer promotion fights the app's own stacking. This is
 * a plain overlay with the three behaviours that actually matter for a dialog — Escape closes,
 * focus moves inside on open and returns to the trigger on close, and the page behind stops
 * scrolling.
 *
 * ── It MUST be portalled, and this is not a style preference ───────────────────────────────────
 * `backdrop-filter` on an ancestor makes that ancestor a CONTAINING BLOCK for `position: fixed`
 * descendants — the fixed element stops being positioned against the viewport and is trapped
 * inside the ancestor's box, at the ancestor's place in the stacking order. The app header uses
 * `backdrop-blur-xl`, so a panel opened from a header button rendered INSIDE the header, clipped
 * to it, with the page content drawing straight over the top. `inset-0` and `z-50` are both
 * powerless against it; the only fix is to render outside that subtree.
 *
 * `transform` and `filter` on an ancestor do exactly the same thing. If this ever appears to be
 * "behind the page" again, look for one of those three on a parent before touching z-index.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  width = "standard",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /**
   * "wide" is for a panel that is a DOCUMENT rather than a control — the project brief, which is
   * six questions with prose answers and would otherwise be read a clause at a time. Two sizes,
   * not a free width: a panel that can be any width is a panel that ends up a different width on
   * every screen it is used from.
   */
  width?: "standard" | "wide";
  children: ReactNode;
}) {
  // Portals need a DOM target, which does not exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement>(null);
  // Where focus was before the panel opened, so closing puts it back on the button that opened it
  // rather than dumping the caret at the top of the document.
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    // Locking the body is what stops a scroll gesture over the overlay from moving the page
    // underneath, which reads as the panel itself being broken.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 transition-opacity duration-200",
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-neutral-900/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "absolute right-0 top-0 h-full w-full bg-surface border-l border-line/70 shadow-2xl",
          width === "wide" ? "max-w-2xl" : "max-w-md",
          "flex flex-col outline-none transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line/70 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
            {description && <p className="text-xs text-neutral-500 mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-900 transition-colors p-1 -mr-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* The panel scrolls, not the page behind it. */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
