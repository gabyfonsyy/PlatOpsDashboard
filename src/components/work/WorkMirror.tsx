"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { WorkMirrorResult } from "@/lib/work";
import { useTheme } from "@/components/theme/ThemeProvider";
import { voiceForTheme } from "@/lib/ai-voice";

/**
 * Work Mirror. A quiet observer, and the UI has to hold that line as much as the prompt does:
 *
 *  - Pattern and interpretation are rendered as visually distinct things. The pattern is the
 *    claim; the interpretation is a hedge, greyer and prefixed. Flattening them into one paragraph
 *    is exactly how a correlation starts reading as a diagnosis.
 *  - It only speaks when asked. Analysis is a button, not something a page load triggers — it
 *    costs an AI call, and unprompted commentary about your working life is not a feature.
 *  - No chat, no avatar, no greeting.
 */
export function WorkMirror({ daysAvailable }: { daysAvailable: number }) {
  // The AI's register follows the theme — Gaby's View gets the full voice, Light/Dark stay plain.
  const { theme } = useTheme();
  const [result, setResult] = useState<WorkMirrorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(force = false) {
    if (loading) return; // guards against a double-click spending two requests
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/work/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, voice: voiceForTheme(theme) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setResult(body.data as WorkMirrorResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">🪞 Work Mirror</h2>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">
            Patterns across your tracked days — durations, tasks, projects, moods and your own
            notes. It reports what it sees; it doesn&apos;t give advice. Runs only when you ask,
            and re-uses the last answer while your data is unchanged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only offered once something exists, and clearly the paying action of the two. */}
          {result && !result.notEnoughData && (
            <button
              onClick={() => run(true)}
              disabled={loading}
              className="btn-secondary py-1.5 px-3 text-xs"
              title="Force a fresh AI request even if nothing has changed since last time"
            >
              Regenerate
            </button>
          )}
          <button onClick={() => run(false)} disabled={loading} className="btn-secondary">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? "Reading…" : result ? "Look again" : "What have you noticed?"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!result && !error && (
        <p className="text-xs text-neutral-400">
          {daysAvailable} tracked day{daysAvailable === 1 ? "" : "s"} available.
        </p>
      )}

      {result?.notEnoughData && (
        <p className="text-sm text-neutral-500">{result.notEnoughData}</p>
      )}

      {result && !result.notEnoughData && result.observations.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing stood out across those days — which is itself a kind of answer.
        </p>
      )}

      {result && result.observations.length > 0 && (
        <div className="flex flex-col gap-3">
          {result.observations.map((o, i) => (
            <div key={i} className="border-l-2 border-sprout-300 pl-3">
              <p className="text-sm text-neutral-800">{o.pattern}</p>
              {o.interpretation && (
                <p className="text-xs text-neutral-500 mt-1">
                  <span className="font-medium">Might mean:</span> {o.interpretation}
                </p>
              )}
            </div>
          ))}
          <p className="text-xs text-neutral-400">
            From {result.daysAnalysed} tracked day{result.daysAnalysed === 1 ? "" : "s"}
            {result.model ? ` · ${result.model}` : ""}. Correlation, not cause.
            {/* Said out loud, because "Look again" returning the same text instantly would
                otherwise look broken rather than free. */}
            {result.fromCache && " Served from cache — no AI request used."}
          </p>
        </div>
      )}
    </div>
  );
}
