"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "@/components/ui/Copy";
import { REVIEW_CHECKLIST_ITEMS } from "@/lib/business-review";

/**
 * Lightweight prep checklist, scoped to one (team, mode, period). Checked state persists per
 * period (business_review_checklist_state) so it naturally "resets" when she moves to a new week/
 * month/quarter — there's nothing to explicitly clear.
 */
export function ReviewPrepChecklist({ periodKey, initialState }: { periodKey: string; initialState: Record<string, boolean> }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(itemKey: string) {
    const next = !state[itemKey];
    setState((s) => ({ ...s, [itemKey]: next }));
    setPending(itemKey);
    try {
      await fetch("/api/business-review/checklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_key: periodKey, item_key: itemKey, checked: next }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-neutral-900">
        <Copy serious="Review Prep" playful="🛠️ Pre-Flight Checklist" />
      </h2>
      <div className="mt-3 flex flex-col gap-1.5">
        {REVIEW_CHECKLIST_ITEMS.map((item) => (
          <label
            key={item.key}
            className="flex items-center gap-2.5 text-sm text-neutral-700 py-1 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={Boolean(state[item.key])}
              onChange={() => toggle(item.key)}
              disabled={pending === item.key}
              className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
            />
            <span className={state[item.key] ? "line-through text-neutral-400" : ""}>
              <Copy serious={item.label} playful={item.gabyLabel} />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
