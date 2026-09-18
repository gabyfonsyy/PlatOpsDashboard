"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Copy } from "@/components/ui/Copy";

type TalkingPoint = { id: string; content: string; position: number };

/**
 * Editable talking points — seeded from the top-ranked metrics' insight sentences (see
 * lib/business-review.ts's seedTalkingPointsIfEmpty), then hers to adjust before the meeting.
 * Same inline-edit-in-place pattern as ProjectTasksPanel.tsx: a textarea per point, saved on blur.
 */
export function TalkingPoints({ periodKey, initialPoints }: { periodKey: string; initialPoints: TalkingPoint[] }) {
  const router = useRouter();
  const [points, setPoints] = useState(initialPoints);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/business-review/talking-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_key: periodKey, content }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.ok && body.data) {
        setPoints((p) => [...p, body.data as TalkingPoint]);
        setDraft("");
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function save(point: TalkingPoint, content: string) {
    if (content === point.content) return;
    setPoints((p) => p.map((pt) => (pt.id === point.id ? { ...pt, content } : pt)));
    await fetch("/api/business-review/talking-points", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: point.id, content }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    setPoints((p) => p.filter((pt) => pt.id !== id));
    await fetch("/api/business-review/talking-points", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-neutral-900">
        <Copy serious="Talking Points" playful="🎙️ Your Talking Points" />
      </h2>

      {points.length === 0 ? (
        <p className="text-sm text-neutral-400 mt-2">No talking points yet — add one below.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {points.map((point) => (
            <div key={point.id} className="flex items-start gap-2 bg-neutral-50 rounded-md border border-neutral-200 px-3 py-2">
              <textarea
                defaultValue={point.content}
                onBlur={(e) => save(point, e.target.value.trim())}
                rows={2}
                className="form-input flex-1 text-sm resize-none bg-transparent border-0 p-0 focus:ring-0"
              />
              <button
                onClick={() => remove(point.id)}
                className="text-neutral-400 hover:text-red-600 transition-colors shrink-0 mt-0.5"
                aria-label="Delete talking point"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="flex items-center gap-2 mt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a talking point..."
          className="form-input flex-1 text-sm py-1.5"
        />
        <button type="submit" disabled={submitting || !draft.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add"}
        </button>
      </form>
    </div>
  );
}
