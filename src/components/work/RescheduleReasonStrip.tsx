"use client";

import { useState } from "react";
import { Undo2, X } from "lucide-react";
import { RESCHEDULE_REASONS, dayLabel, rescheduleReasonLabel, type WorkTask } from "@/lib/work";

/**
 * Asked AFTER the move, never before it.
 *
 * The push button is one click because "not today" is a thought people have at 6pm when they are
 * already tired of the day, and a dialog between the thought and the task moving is how the button
 * stops getting pressed. So the task moves first and this strip appears where her eyes already
 * are, offering the reason as one more optional click.
 *
 * It lives here rather than on the row for a mechanical reason too: a pushed task LEAVES the
 * board — it belongs to Ahead now — so anything anchored to the row would vanish at the exact
 * moment it was meant to be asking a question.
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

  return (
    <div className="card px-4 py-3 flex flex-col gap-2 border-sprout-200/70">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm text-neutral-800">
          Moved <span className="font-medium">{task.title}</span> from {dayLabel(from, today)} to{" "}
          {dayLabel(to, today)}.
        </p>
        <button
          onClick={onUndo}
          className="text-xs text-neutral-400 hover:text-sprout-700 transition-colors inline-flex items-center gap-1"
        >
          <Undo2 className="w-3 h-3" />
          Undo
        </button>
        <button
          onClick={onDismiss}
          className="ml-auto text-neutral-300 hover:text-neutral-600 transition-colors p-1"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

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
  );
}
