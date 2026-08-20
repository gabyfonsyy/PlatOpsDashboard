"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";
import { DAY_FACTORS, MOODS, moodByCode, type WorkCheckin } from "@/lib/work";

/**
 * End-of-day check-in. Target is ~30 seconds, which drives every decision here:
 *
 *  - Picking a mood SAVES IMMEDIATELY. That single tap is the whole minimum viable check-in; the
 *    factors and the note are strictly optional extras layered on after. Requiring a submit button
 *    would mean a half-finished check-in saves nothing at all, which is the common case at 6pm.
 *  - Factors save on click too, one at a time.
 *  - Only the free-text note has an explicit save, because you can't sensibly autosave prose.
 *
 * Already answered today? It shows the answer and lets you change it, rather than pretending the
 * day is unrecorded.
 */
export function CheckInCard({ checkin }: { checkin: WorkCheckin | null }) {
  const router = useRouter();
  const [mood, setMood] = useState<string | null>(checkin?.mood ?? null);
  const [factors, setFactors] = useState<string[]>(checkin?.factors ?? []);
  const [note, setNote] = useState(checkin?.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: { mood?: string | null; factors?: string[]; note?: string }) {
    const payloadMood = next.mood ?? mood;
    // Mood is the one required field, so nothing can be saved before it's chosen.
    if (!payloadMood) return;
    setError(null);
    try {
      const res = await fetch("/api/work/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood: payloadMood,
          factors: next.factors ?? factors,
          note: next.note ?? note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    }
  }

  function pickMood(code: string) {
    setMood(code);
    void save({ mood: code });
    // Acknowledged, not congratulated — a rough day shouldn't be met with confetti.
    const weight = moodByCode(code)?.weight ?? 3;
    celebrate(weight >= 4 ? "success" : "nope");
  }

  function toggleFactor(code: string) {
    const next = factors.includes(code) ? factors.filter((f) => f !== code) : [...factors, code];
    setFactors(next);
    void save({ factors: next });
  }

  async function saveNote() {
    setSavingNote(true);
    setNoteSaved(false);
    await save({ note });
    setSavingNote(false);
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 2000);
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">How was work today?</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          {checkin
            ? "Answered — tap to change."
            : "One tap saves it. The rest is optional."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {MOODS.map((m) => {
          const active = mood === m.code;
          return (
            <button
              key={m.code}
              onClick={() => pickMood(m.code)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all duration-200",
                active
                  ? "border-sprout-300 bg-sprout-50 text-sprout-700 ring-2 ring-sprout-400/40"
                  : "border-neutral-200/80 bg-surface/60 text-neutral-600 hover:border-sprout-200"
              )}
            >
              <span aria-hidden="true">{m.emoji}</span>
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Revealed only after a mood is chosen — an empty page of optional fields is what makes a
          check-in feel like a form instead of a tap. */}
      {mood && (
        <>
          <div>
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
              What affected your day?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DAY_FACTORS.map((f) => {
                const active = factors.includes(f.code);
                return (
                  <button
                    key={f.code}
                    onClick={() => toggleFactor(f.code)}
                    aria-pressed={active}
                    className={cn(
                      "badge border transition-all duration-200",
                      active
                        ? "bg-sprout-50 text-sprout-700 border-sprout-300"
                        : "bg-surface/60 text-neutral-500 border-neutral-200 hover:border-sprout-200"
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="checkin-note">
              Anything you want future-you to know?
            </label>
            <textarea
              id="checkin-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional."
              className="form-input resize-y"
            />
            <div className="flex items-center gap-3 mt-2">
              <button onClick={saveNote} disabled={savingNote} className="btn-secondary py-1.5 px-3 text-xs">
                {savingNote ? "Saving…" : "Save note"}
              </button>
              {noteSaved && (
                <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                  <Check className="w-3 h-3" /> Saved
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
