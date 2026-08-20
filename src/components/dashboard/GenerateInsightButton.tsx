"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { voiceForTheme } from "@/lib/ai-voice";

type GenerateResult = {
  aiCalls?: number;
  results?: { scope: string; status: string }[];
};

/**
 * Explicit, user-pressed AI generation. Nothing on this dashboard generates an insight on page
 * load, navigation, or refresh — this button is the only trigger, so the AI cost of browsing is
 * zero by construction.
 *
 * The two actions are deliberately separate:
 *   Generate  — cheap path. Skipped server-side if the underlying metrics haven't changed.
 *   Regenerate — forces a call even when the data is unchanged. Only shown once something exists.
 *
 * `busy` guards against double-submits from a double-click or a re-render, which is the easy way
 * to spend two requests on one intention.
 */
export function GenerateInsightButton({
  scope,
  hasInsight,
}: {
  scope: string;
  hasInsight: boolean;
}) {
  const router = useRouter();
  // The AI's register follows the active theme — Gaby's View gets the full voice.
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(force: boolean) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/gas/insight/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, force, voice: voiceForTheme(theme) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      const data = body.data as GenerateResult;
      // Says plainly whether an AI request was actually spent, so "nothing changed" doesn't look
      // like a silent failure.
      setNote(
        data.aiCalls === 0
          ? "Already up to date — no AI request used."
          : `Generated${data.aiCalls ? ` · ${data.aiCalls} AI request${data.aiCalls === 1 ? "" : "s"}` : ""}.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {hasInsight && (
          <button
            onClick={() => run(true)}
            disabled={busy}
            className="btn-secondary py-1.5 px-3 text-xs"
            title="Force a fresh AI request even if the numbers haven't changed"
          >
            Regenerate
          </button>
        )}
        <button onClick={() => run(false)} disabled={busy} className="btn-secondary py-1.5 px-3 text-xs">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? "Working…" : hasInsight ? "Refresh insight" : "Generate insight"}
        </button>
      </div>
      {note && <p className="text-[11px] text-neutral-400">{note}</p>}
      {error && <p className="text-[11px] text-red-600 max-w-xs text-right">{error}</p>}
    </div>
  );
}
