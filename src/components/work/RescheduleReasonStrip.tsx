"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Undo2, X, CalendarArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { RESCHEDULE_REASONS, dayLabel, rescheduleReasonLabel, type WorkTask } from "@/lib/work";

/**
 * Asked AFTER the move, never before it.
 *
 * The push button is one click because "not today" is a thought people have at 6pm when they are
 * already tired of the day, and a dialog between the thought and the task moving is how the button
 * stops getting pressed. So the task moves first and this asks the reason as one more optional
 * click.
 *
 * It is not anchored to the row for a mechanical reason: a pushed task LEAVES the board — it
 * belongs to Ahead now — so anything on the row would vanish at the exact moment it was meant to
 * be asking a question.
 *
 * ── Why a floating popup rather than a strip above the board (2026-09-01) ─────────────────────
 * It WAS a strip at the top of the board, and it got missed: the eye is on the row that just
 * moved, somewhere down the page, and a line appearing above the fold is a line that appears
 * outside the field of view. So it now floats bottom-right, portalled to document.body — the same
 * reason SidePanel is portalled, and worth restating because it is not a style choice:
 * `backdrop-filter` on an ancestor makes that ancestor a containing block for `position: fixed`
 * descendants, and `.card` is `backdrop-blur-xl`. A fixed element rendered inside the page tree
 * would be trapped in whichever blurred box happened to contain it.
 *
 * It is still NOT a modal. No overlay, nothing to dismiss before carrying on, no focus trap —
 * pushing three tasks in a row must stay three clicks. It waits, and it goes away on its own once
 * a reason is given.
 *
 * ── Why it is amber and not a card (2026-09-01) ───────────────────────────────────────────────
 * The first version reused `.card`, which is exactly wrong for something whose whole job is to be
 * noticed: `.card` is a translucent, backdrop-blurred surface designed to RECEDE, and eleven of
 * them are already on the page. A twelfth in the corner is camouflage.
 *
 * So it is an opaque panel with a solid amber band across the top. Amber rather than green or red
 * because it is neither a success nor a failure — it is the same "this needs a moment of your
 * attention" register the slip marker on a task row already uses, so the two read as the same
 * subject. A solid band also survives all three themes without a per-theme override, which a
 * tinted translucent surface does not.
 *
 * Everything about it is optional. Dismissing it costs nothing, and a reason nobody gives is worth
 * more than a mandatory field that makes the whole feature annoying enough to stop using.
 */
export function RescheduleReasonStrip({
  task,
  from,
  to,
  today,
  onUndo,
  onDismiss,
}: {
  task: WorkTask;
  from: string;
  to: string;
  today: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Portals need a DOM target, which does not exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * Escape dismisses it, because a thing floating over the corner of the screen should be
   * dismissible without aiming at a 14px close button. It does NOT trap focus or swallow anything
   * else — see the note above on why this is not a modal.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  /**
   * Sends the reason, and later the note, as the same call — the endpoint writes both onto the
   * newest slip for this task, so re-sending with a note simply fills in the detail rather than
   * logging a second thing.
   */
  async function save(reason: string, detail?: string) {
    setBusy(true);
    setError(null);
    // Optimistic: the chip is the answer to a question about the past, and making it wait on a
    // round trip would make giving a reason feel slower than not giving one.
    setSaved(reason);
    try {
      const res = await fetch("/api/work/tasks/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.task_id, reason, note: detail ?? null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaved(null);
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Bottom-right on a desktop, but full-width along the bottom on a phone, where a corner
        // card would cover the row that just moved.
        "fixed z-40 left-4 right-4 bottom-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[26rem]",
        // Opaque, not `.card`: a blurred translucent surface is built to recede, and this one
        // needs the opposite. `overflow-hidden` is what lets the amber band reach the corners.
        "rounded-xl overflow-hidden bg-surface shadow-2xl ring-2 ring-amber-400",
        "animate-toast-in"
      )}
    >
      {/* The band is the whole point of the redesign — a solid block of colour reads from the
          other side of the screen, which a tinted border does not. */}
      <div className="bg-amber-500 text-white px-4 py-2.5 flex items-start gap-2">
        <CalendarArrowDown className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-sm flex-1 min-w-0">
          Moved <span className="font-semibold">{task.title}</span> from {dayLabel(from, today)} to{" "}
          {dayLabel(to, today)}.
        </p>
        <button
          onClick={onUndo}
          className="text-xs text-white/90 hover:text-white underline underline-offset-2 transition-colors inline-flex items-center gap-1 shrink-0"
        >
          <Undo2 className="w-3 h-3" />
          Undo
        </button>
        <button
          onClick={onDismiss}
          className="text-white/70 hover:text-white transition-colors shrink-0 -mr-1"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">

      {saved === null ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The question is asked plainly and the answers are one click. Nothing here scores the
              day or asks her to justify it — these are facts about how a day went, and the point
              of collecting them is that Work Mirror can later say what keeps eating the week. */}
          <span className="text-xs text-neutral-500 mr-1">Why? (optional)</span>
          {RESCHEDULE_REASONS.map((r) => (
            <button
              key={r.code}
              onClick={() => save(r.code)}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-full border border-line/70 text-neutral-600 hover:border-sprout-300 hover:text-sprout-700 hover:bg-sprout-50/50 transition-colors disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">
            Noted: <span className="text-neutral-700">{rescheduleReasonLabel(saved)}</span>
          </span>
          {/* Offered only after a reason exists: a free-text box on its own collects sentences that
              can't be counted, and the codes are what make a tally possible. */}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() && save(saved, note.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
                onDismiss();
              }
            }}
            placeholder="Add a detail, if it helps…"
            className="form-input py-1 text-xs flex-1 min-w-[12rem]"
            aria-label="Detail about this move"
          />
          <button
            onClick={onDismiss}
            className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            Done
          </button>
        </div>
      )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>,
    document.body
  );
}
