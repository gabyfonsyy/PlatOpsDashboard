"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatManilaDateTime } from "@/lib/format";

/**
 * Recomputes kpi_baselines for every team in one call (see recompute/route.ts) and refreshes the
 * page so the new values show immediately. Same explicit-action posture as Site Monitoring's own
 * sync button (SiteMonitoringSection.tsx) — never runs on its own as a page-load side effect.
 */
export function KpiBaselineControl({ computedAt }: { computedAt: string | null }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recompute() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kpi-baselines/recompute", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <p className="text-xs text-neutral-400">
        {computedAt ? `Baseline (${"2026-Q1+Q2"}) computed · ${formatManilaDateTime(computedAt)}` : "No baseline computed yet"}
      </p>
      <button
        onClick={recompute}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-sprout-700 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
        {syncing ? "Recomputing…" : "Recompute Baseline"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
