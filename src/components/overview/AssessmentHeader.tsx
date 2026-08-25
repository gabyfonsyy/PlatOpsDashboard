"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { formatManilaDateTime } from "@/lib/format";
import { voiceForView, type OverviewView } from "@/lib/overview-view";

/**
 * The greeting, the AI headline, and the controls for the daily snapshot.
 *
 * ── The one deliberate exception to "no AI on page load" ───────────────────────────────────────
 * Every other AI surface on this dashboard generates only on an explicit press. This one asks for
 * an assessment automatically the first time the Overview is opened on a given day, because the
 * brief is that it should simply BE there in the morning.
 *
 * What makes that safe is the route, not this component: /api/overview/snapshot checks for a
 * snapshot dated today BEFORE doing any work and returns the cached one if it exists. So the
 * ceiling is one request per person per day per register no matter how many tabs are open. The
 * guard here (`asked`) only avoids a pointless round trip within a single mount.
 *
 * To make this strictly button-only, delete the effect below. Nothing else changes.
 */
export function AssessmentHeader({
  view,
  greeting,
  firstName,
  dateLabel,
  headline,
  generatedAt,
  hasBriefing,
}: {
  view: OverviewView;
  greeting: string;
  firstName: string;
  dateLabel: string;
  headline: string;
  generatedAt: string | null;
  hasBriefing: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Survives re-renders but not a remount, which is what we want: one attempt per page visit, and
  // the server does the real deduplication.
  const asked = useRef(false);

  async function generate(force: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/overview/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, voice: voiceForView(view) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      if (body.data?.aiCalls === 0) setNote("Already generated for today.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (hasBriefing || asked.current) return;
    asked.current = true;
    void generate(false);
    // Intentionally keyed on the register too: switching view needs its own day-one snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBriefing, view]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-neutral-400">{dateLabel}</p>
          <h1 className="mt-0.5">
            {greeting}, {firstName}.
          </h1>
        </div>
      </div>

      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Sparkles className="w-4 h-4 text-sprout-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              {busy && !hasBriefing ? (
                <p className="text-sm text-neutral-500 inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Reading today across every connected module…
                </p>
              ) : headline ? (
                <p className="text-sm text-neutral-800 leading-relaxed">{headline}</p>
              ) : (
                <p className="text-sm text-neutral-500">
                  No assessment for today yet.
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => generate(true)}
            disabled={busy}
            className="btn-secondary py-1.5 px-3 text-xs shrink-0"
            title="Generate a fresh assessment from the current data"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {busy ? "Working…" : "Refresh assessment"}
          </button>
        </div>

        {/* The timestamp is load-bearing, not decoration: the numbers on this page are live and the
            assessment is not, so a reader has to be able to see how old the interpretation is. */}
        <p className="text-[11px] text-neutral-400">
          {generatedAt
            ? `Assessment generated ${formatManilaDateTime(generatedAt)} · reflects the data available at that time. The dashboard figures below are live.`
            : "Generated once a day. The dashboard figures below are always live."}
          {note && ` · ${note}`}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
