"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Circle } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import { formatDuration, formatManilaTime, type WorkSession } from "@/lib/work";
import { cn } from "@/lib/utils";

/**
 * Start / End Work. One click, no form — the brief is explicit that being asked to fill anything
 * in just to begin the day is how a tool like this stops getting used.
 */
export function WorkdayBar({
  openSession,
  todaySessions,
}: {
  openSession: WorkSession | null;
  todaySessions: WorkSession[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticks the elapsed label. Only mounted while a session is open, so a closed day costs nothing.
  const [, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!openSession) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [openSession]);

  async function toggle(action: "start" | "end") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/work/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      celebrate(action === "start" ? "success" : "milestone");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setBusy(false);
    }
  }

  const elapsed = openSession
    ? (Date.now() - new Date(openSession.started_at).getTime()) / 60000
    : null;

  // Sum of every closed session today, so a day resumed after lunch reads as its real total.
  const loggedToday = todaySessions
    .filter((s) => s.ended_at)
    .reduce(
      (sum, s) => sum + (new Date(s.ended_at as string).getTime() - new Date(s.started_at).getTime()) / 60000,
      0
    );

  return (
    <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={cn(
            "inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0",
            openSession ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-400"
          )}
        >
          <Circle className={cn("w-3.5 h-3.5", openSession && "fill-current")} />
        </span>
        <div className="min-w-0">
          {openSession ? (
            <>
              <p className="text-sm font-semibold text-neutral-900">
                Working since {formatManilaTime(openSession.started_at)}
              </p>
              <p className="text-xs text-neutral-500">
                {formatDuration(elapsed)} so far
                {loggedToday > 0 && ` · ${formatDuration(loggedToday)} logged earlier today`}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-neutral-900">Workday not started</p>
              <p className="text-xs text-neutral-500">
                {loggedToday > 0
                  ? `${formatDuration(loggedToday)} logged today`
                  : "Nothing logged today yet"}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
        {openSession ? (
          <button onClick={() => toggle("end")} disabled={busy} className="btn-secondary">
            <Square className="w-4 h-4" />
            {busy ? "Ending…" : "End Work"}
          </button>
        ) : (
          <button onClick={() => toggle("start")} disabled={busy} className="btn-primary">
            <Play className="w-4 h-4" />
            {busy ? "Starting…" : "Start Work"}
          </button>
        )}
      </div>
    </div>
  );
}
