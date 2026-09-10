"use client";

import { Pencil, Trash2, ExternalLink, ChevronUp, ChevronDown, Link2, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { WorkReference } from "@/lib/references-store";

/** Bare hostname for a quick visual "what site is this", without pulling in a URL-parsing lib. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * One reference tile — extracted out of ReferencesView so it can be reused per-category-section
 * without duplicating markup. Same visual design as before this feature (`.card`, `bg-surface
 * border-2 border-neutral-300 shadow-lg`); now shows a Category chip alongside the existing Type
 * badge, visually distinct (outline vs filled) rather than adding a second colour.
 */
export function ReferenceCard({
  reference,
  isFirstInCategory,
  isLastInCategory,
  moving,
  onEdit,
  onDelete,
  onMove,
}: {
  reference: WorkReference;
  isFirstInCategory: boolean;
  isLastInCategory: boolean;
  moving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <div className="card p-4 flex flex-col gap-3 h-full bg-surface border-2 border-neutral-300 shadow-lg group">
      <div className="flex items-start justify-between gap-2">
        <span className="w-9 h-9 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
          <Link2 className="w-4.5 h-4.5" />
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-center gap-0.5">
            <button
              onClick={() => onMove("up")}
              disabled={isFirstInCategory || moving}
              className="text-neutral-400 hover:text-sprout-600 disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors"
              aria-label="Move up within category"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onMove("down")}
              disabled={isLastInCategory || moving}
              className="text-neutral-400 hover:text-sprout-600 disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors"
              aria-label="Move down within category"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={onEdit} className="text-neutral-400 hover:text-sprout-600 transition-colors" aria-label="Edit">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="text-neutral-400 hover:text-red-600 transition-colors" aria-label="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-neutral-900 truncate">{reference.title}</span>
        </div>
        <p className="text-xs text-neutral-400 truncate mt-0.5">{hostOf(reference.url)}</p>
        {reference.description && <p className="text-sm text-neutral-600 mt-1.5 line-clamp-3">{reference.description}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {reference.type && <Badge tone="neutral">{reference.type.name}</Badge>}
          {reference.category && <span className="chip-outline">{reference.category.name}</span>}
        </div>
      </div>

      <a
        href={reference.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-sprout-700 group-hover:text-sprout-800 transition-colors"
      >
        Open
        <ArrowRight className="w-4 h-4" />
        <ExternalLink className="w-3 h-3 text-neutral-300" />
      </a>
    </div>
  );
}
