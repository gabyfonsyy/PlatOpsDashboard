"use client";

import { useState, type ReactNode } from "react";
import { X, Plus, RotateCcw } from "lucide-react";

/**
 * An editable list of label names, rendered as removable chips with an add box and a reset.
 *
 * Extracted when the Automated Tickets page grew a second such list (hidden labels, and the
 * catalogue of known automation labels): the two behave identically and only differ in what they
 * mean, so they must not drift apart visually or in their add/remove semantics.
 *
 * Purely presentational — the owner holds the list, persists it and decides what it does. This
 * component only knows how to edit one.
 */
export function LabelChipEditor({
  title,
  description,
  labels,
  onAdd,
  onRemove,
  onReset,
  canReset,
  addPlaceholder = "Add a label…",
  addLabel = "Add",
  emptyMessage = "Nothing in this list.",
  chipTitle,
  actions,
  tone = "neutral",
  busy = false,
}: {
  title: string;
  description: ReactNode;
  labels: string[];
  onAdd: (label: string) => void;
  onRemove: (label: string) => void;
  onReset: () => void;
  /** False hides the Reset button — nothing to undo when the list is already at its default. */
  canReset: boolean;
  addPlaceholder?: string;
  addLabel?: string;
  emptyMessage?: string;
  /** Tooltip on each chip, e.g. 'Stop hiding "{label}"'. Receives the label. */
  chipTitle?: (label: string) => string;
  /** Extra buttons in the header, beside Reset. */
  actions?: ReactNode;
  /** `sprout` for the catalogue list, so the two editors are not mistaken for one another. */
  tone?: "neutral" | "sprout";
  /**
   * A server round-trip is in flight for this list. Inputs are disabled rather than merely dimmed:
   * a second edit landing mid-refresh would be computed against the pre-edit list and silently lost.
   */
  busy?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const chipClass =
    tone === "sprout"
      ? "bg-sprout-50 hover:bg-red-50 text-sprout-700 hover:text-red-700"
      : "bg-neutral-100 hover:bg-red-50 text-neutral-600 hover:text-red-700";

  return (
    <div className="card p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-xs text-neutral-400 mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {canReset && (
            <button
              onClick={onReset}
              disabled={busy}
              className="btn-secondary py-1 px-2.5 text-xs"
              title="Back to the default list"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-3">
        {labels.length === 0 && <span className="text-xs text-neutral-400">{emptyMessage}</span>}
        {labels.map((label) => (
          <button
            key={label}
            onClick={() => onRemove(label)}
            disabled={busy}
            className={`group inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 transition-colors disabled:opacity-50 ${chipClass}`}
            title={chipTitle ? chipTitle(label) : `Remove "${label}"`}
          >
            {label}
            <X className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:text-red-600" />
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(draft);
          setDraft("");
        }}
        className="flex items-center gap-2 mt-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={addPlaceholder}
          aria-label={addPlaceholder}
          disabled={busy}
          className="form-input !py-1 !px-2 text-xs flex-1 min-w-0"
        />
        <button
          type="submit"
          className="btn-secondary py-1 px-2.5 text-xs shrink-0"
          disabled={busy || !draft.trim()}
        >
          <Plus className="w-3 h-3" />
          {addLabel}
        </button>
      </form>
    </div>
  );
}
