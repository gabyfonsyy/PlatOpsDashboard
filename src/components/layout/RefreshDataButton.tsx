"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Manual cache-bust for the two layers that can make a just-deployed backend fix look like it
 * "didn't take" for a few minutes — the GAS backend's own 10-minute sheet cache, and Next.js's
 * 5-minute fetch cache. See api/gas/refresh/route.ts for what actually gets invalidated.
 */
export function RefreshDataButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleRefresh() {
    setState("loading");
    try {
      const res = await fetch("/api/gas/refresh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      router.refresh();
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={state === "loading"}
      className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-sprout-700 transition-colors disabled:opacity-50"
      title="Clear cached data and reload the latest synced numbers"
    >
      <RefreshCw className={cn("w-4 h-4", state === "loading" && "animate-spin")} />
      <span className="hidden sm:inline">
        {state === "done" ? "Refreshed" : state === "error" ? "Couldn't refresh" : "Refresh Data"}
      </span>
      {state === "done" && <Check className="w-4 h-4 sm:hidden" />}
    </button>
  );
}
