"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";
import { Copy } from "@/components/ui/Copy";

type SyncResult = {
  scanned: number;
  byTeam: { team_key: string; found: number; upserted: number; skipped: number }[];
  errors: { team_key: string; error: string }[];
  capped: boolean;
  note: string;
  elapsedMs?: number;
  changelogFetches?: number;
  startDate?: string;
  outOfWindow?: number;
  prunedBefore?: number;
  prunedKeptBecauseLogged?: number;
};

/**
 * Pulls Jira tickets tagged with Report Tagging into the incident list. The daily trigger
 * (syncIncidentTickets in gas/Triggers.gs) does this on a schedule; this is the "I just tagged
 * one, show it now" path, because the whole point of the tag is that it's applied by hand and
 * the manager is often tagging and writing up in the same sitting.
 *
 * The result is summarised on screen rather than swallowed: per-team JQL failures are returned
 * by the backend instead of thrown (one team's project missing the field must not block the
 * others), so if they aren't surfaced here they'd be invisible.
 */
export function SyncIncidentsButton({ team }: { team?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setState("loading");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/gas/incidents/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      const data = body.data as SyncResult;
      setResult(data);
      // A sync that actually pulled something in is worth more than one that found nothing new.
      celebrate(data.byTeam.some((t) => t.upserted > 0) ? "milestone" : "success");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setState("idle");
    }
  }

  const upserted = result?.byTeam.reduce((sum, t) => sum + t.upserted, 0) ?? 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={handleSync} disabled={state === "loading"} className="btn-secondary">
        <DownloadCloud className={cn("w-4 h-4", state === "loading" && "animate-pulse")} />
        {state === "loading" ? "Syncing from Jira…" : "Sync from Jira"}
      </button>

      {state === "loading" && (
        <p className="text-xs text-neutral-400">
          <Copy
            serious="Reading tagged tickets — can take a while on the first run."
            playful="Asking Jira what everyone's been up to…"
          />
        </p>
      )}

      {result && (
        <p className="text-xs text-neutral-500 text-right">
          Scanned {result.scanned} tagged ticket{result.scanned === 1 ? "" : "s"}, updated {upserted}
          {typeof result.elapsedMs === "number" ? ` in ${(result.elapsedMs / 1000).toFixed(1)}s` : ""}.
          {/* A capped run is normal, not an error — it just means click again. Amber, not red. */}
          {result.capped && <span className="text-amber-600 block">{result.note}</span>}
          {/* Say what was excluded and why. A sync that quietly drops 117 tickets reads as a bug
              unless the window doing it is stated. */}
          {result.startDate && (
            <span className="block text-neutral-400">
              Window: {result.startDate} onwards
              {result.outOfWindow ? ` · ${result.outOfWindow} older ticket${result.outOfWindow === 1 ? "" : "s"} skipped` : ""}
              {result.prunedBefore ? ` · ${result.prunedBefore} pre-window row${result.prunedBefore === 1 ? "" : "s"} removed` : ""}
            </span>
          )}
          {result.prunedKeptBecauseLogged ? (
            <span className="block text-neutral-400">
              {result.prunedKeptBecauseLogged} older ticket
              {result.prunedKeptBecauseLogged === 1 ? "" : "s"} kept — {result.prunedKeptBecauseLogged === 1 ? "it has" : "they have"} an
              incident log.
            </span>
          ) : null}
        </p>
      )}

      {result?.errors.length ? (
        <p className="text-xs text-red-600 text-right max-w-sm">
          {result.errors.map((e) => `${e.team_key}: ${e.error}`).join(" · ")}
        </p>
      ) : null}

      {error && <p className="text-xs text-red-600 text-right max-w-sm">{error}</p>}
    </div>
  );
}
