"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Copy } from "@/components/ui/Copy";
import {
  QUADRANT_META,
  QUADRANT_ORDER,
  quadrantOf,
  triageFor,
  type MatrixReadout,
  type Quadrant,
  type Triage,
} from "@/lib/work";

/**
 * The shared Eisenhower pieces: the one control that sets a quadrant, the cell a quadrant's work
 * sits in, the readout above the board, and the form that makes a park a park.
 *
 * All of it works off `urgent` + `important` and never off a quadrant field, because there isn't
 * one — the square is derived (quadrantOf). The control below is the only place in the UI that
 * turns a chosen square back into the two booleans, so there is exactly one line to check if the
 * axes are ever swapped.
 */

/**
 * Picking a square. A native select rather than a popover, deliberately: task rows live inside
 * `.card`, which is `backdrop-blur-xl`, and a backdrop filter creates a containing block that
 * traps `position: fixed` children — the same trap documented in ui/SidePanel and worked around
 * by the copy strip. A select's dropdown is drawn by the browser, outside all of that.
 *
 * Always visible, never behind hover. Which square something is in is the one thing on the row
 * you want to be able to read without touching it — a triage you have to go looking for is a
 * triage that stops happening.
 */
export function QuadrantSelect({
  value,
  onChange,
  size = "sm",
  label = "Eisenhower quadrant",
}: {
  value: Triage;
  onChange: (next: Triage) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const current = quadrantOf(value);
  return (
    <select
      value={current ?? ""}
      onChange={(e) => onChange(triageFor((e.target.value || null) as Quadrant | null))}
      aria-label={label}
      title={
        current
          ? `${QUADRANT_META[current].verb} — ${QUADRANT_META[current].axis}. ${QUADRANT_META[current].line}`
          : "Not sorted into the matrix yet"
      }
      className={cn(
        "form-input w-auto shrink-0",
        size === "sm" ? "py-1 text-xs max-w-[7.5rem]" : "text-sm max-w-[10rem]",
        current ? QUADRANT_META[current].text : "text-neutral-400"
      )}
    >
      <option value="">Unsorted</option>
      {QUADRANT_ORDER.map((q) => (
        <option key={q} value={q}>
          {QUADRANT_META[q].verb}
        </option>
      ))}
    </select>
  );
}

/**
 * One square of the 2x2, with its own heading, its instruction and — always — its failure mode.
 *
 * The warning line is not decoration and is not hidden behind a tooltip. A matrix whose four
 * squares are just labels degrades into four prettier priority levels within a fortnight; the
 * thing that keeps it a decision tool is that each square says out loud what goes wrong when it
 * is used badly, right next to the work that is in it.
 */
export function QuadrantCell({
  quadrant,
  count,
  warn,
  children,
}: {
  quadrant: Quadrant;
  count: number;
  /** Raised when this square's own failure mode is currently happening. */
  warn?: string | null;
  children: React.ReactNode;
}) {
  const meta = QUADRANT_META[quadrant];
  return (
    // `min-w-0` for the same reason as the rows wrapper: a grid item defaults to its content
    // width as a minimum, so without it the cell grows to fit an unwrapped row instead of making
    // the row wrap, and the four boxes stop being the same size again.
    <section className={cn("card border-l-2 p-4 flex flex-col gap-3 h-full min-w-0", meta.accent)}>
      {/* Fixed height, because the four headers are not naturally the same one: the axis lines and
          the failure-mode notes run from six words to fourteen, so headers sized to their content
          started each cell's task list on a different line and made the boxes look mismatched even
          once the grid was equalising them. */}
      <header className="flex flex-col gap-1 min-h-[6.5rem]">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={cn("text-sm font-semibold", meta.text)}>{meta.verb}</h3>
          <span className="text-xs text-neutral-400 shrink-0">{count}</span>
        </div>
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">{meta.axis}</p>
        {/* Both registers ship in the markup and CSS picks one — see ui/Copy. That is what lets
            the square change voice in Gaby's View with no hydration flash and no client JS. */}
        <p className="text-xs text-neutral-600">
          <Copy serious={meta.line} playful={meta.playful.line} />
        </p>
        <p
          className={cn(
            "text-[11px]",
            warn ? "text-amber-600 font-medium" : "text-neutral-400 italic"
          )}
        >
          <Copy serious={meta.note} playful={meta.playful.note} />
        </p>
      </header>
      {children}
    </section>
  );
}

/**
 * What the shape of the day actually says. Every line is computed from the rows (matrixReadout in
 * lib/work) and carries the number that produced it, so it can be checked against the board rather
 * than taken on trust. Nothing here is generated.
 */
export function MatrixReadoutStrip({
  readout,
  extra = [],
}: {
  readout: MatrixReadout;
  /** Project-level lines, rendered in the same list. Same two-register shape. */
  extra?: MatrixReadout["notes"];
}) {
  const notes = [...readout.notes, ...extra];
  if (notes.length === 0) return null;
  return (
    <div className="card p-3 flex flex-col gap-1.5">
      {notes.map((note, i) => {
        const meta = note.quadrant ? QUADRANT_META[note.quadrant] : null;
        return (
          <p key={i} className="text-xs text-neutral-600 flex items-start gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full",
                meta ? meta.dot : "bg-neutral-300"
              )}
            />
            <span>
              {meta && <span className={cn("font-medium", meta.text)}>{meta.verb} · </span>}
              {/* The figures are identical across both registers — only the framing differs. */}
              <Copy serious={note.text} playful={note.playful} />
            </span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * The two answers a park is required to give, asked at the moment of parking.
 *
 * "A parked project needs a stated reason and a named decision, not a slipped date." The reason
 * and the decision are two separate fields precisely so the second one cannot be satisfied by the
 * first: it is very easy to write "waiting on capacity" and feel finished, and that is a fact
 * about now, not a decision anybody has agreed to make. Neither field accepts a date on its own,
 * which is why the placeholder for the decision names a person — a decision with no owner is the
 * slipped date this rule exists to refuse.
 *
 * The store enforces the same rule server-side (resolveParkFields / the task route), so this form
 * is the polite version of a constraint rather than the constraint itself.
 */
export function ParkFields({
  reason,
  decision,
  onReason,
  onDecision,
  disabled,
}: {
  reason: string;
  decision: string;
  onReason: (v: string) => void;
  onDecision: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-neutral-500">Why is it parked?</span>
        <input
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          disabled={disabled}
          placeholder="The thing that is actually true right now"
          className="form-input text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-neutral-500">What decision un-parks it, and whose?</span>
        <input
          value={decision}
          onChange={(e) => onDecision(e.target.value)}
          disabled={disabled}
          placeholder="e.g. Ken decides whether we still need a second reviewer"
          className="form-input text-sm"
        />
      </label>
      <p className="text-[11px] text-neutral-400 flex items-start gap-1.5">
        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
        A named decision, not a date to revisit. &ldquo;Q4&rdquo; is a slipped date wearing a
        decision&apos;s coat.
      </p>
    </div>
  );
}

/** Shows what a parked thing said, so a park that has outlived its reason is visible at rest. */
export function ParkedNote({
  reason,
  decision,
  className,
}: {
  reason: string | null;
  decision: string | null;
  className?: string;
}) {
  if (!reason && !decision) return null;
  return (
    <div className={cn("text-[11px] text-neutral-500 flex flex-col gap-0.5", className)}>
      {reason && <p className="truncate" title={reason}>Parked: {reason}</p>}
      {decision && (
        <p className="truncate" title={decision}>
          Un-parks when: {decision}
        </p>
      )}
    </div>
  );
}
