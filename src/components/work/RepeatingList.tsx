"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Repeat, Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Copy } from "@/components/ui/Copy";
import { dayLabel, recurrenceLabel, type WorkProject, type WorkRecurrence } from "@/lib/work";

/**
 * The schedules, not the tasks. Everything a rule produces shows up on the board and in Ahead as
 * an ordinary task — this list is only for changing the rule itself.
 *
 * Pause is the primary action, ahead of delete: "not this month" is a far more common thought
 * than "never again", and if the only way to get a break from a routine is to destroy the rule,
 * people delete things they wanted back. Paused rules stop producing instances and immediately
 * give up the ones they'd already put on future days.
 */
export function RepeatingList({
  rules,
  ready,
  projects,
  today,
}: {
  rules: WorkRecurrence[];
  /** False until the recurrence migration has been run. */
  ready: boolean;
  projects: WorkProject[];
  today: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "PATCH" | "DELETE", body: Record<string, unknown>) {
    setBusyId(String(body.recurrence_id));
    setError(null);
    try {
      const res = await fetch("/api/work/recurrences", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) {
    return (
      <div className="card px-4 py-3">
        <p className="text-xs text-neutral-500">
          Repeating tasks need one SQL step — re-run{" "}
          <code className="text-sprout-700">supabase/my-work.sql</code> in the Supabase SQL editor.
          Everything else on this page works without it.
        </p>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="card px-4 py-3">
        <p className="text-xs text-neutral-400">
          <Copy
            serious="Nothing repeats yet. Set Repeats when adding a task to make it come back on its own."
            playful="Nothing repeats yet — every task is a one-off surprise. Bold."
          />
        </p>
      </div>
    );
  }

  const projectName = (id: string | null) =>
    id ? projects.find((p) => p.project_id === id)?.name ?? null : null;

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="card divide-y divide-neutral-100">
        {rules.map((rule) => {
          const busy = busyId === rule.recurrence_id;
          const project = projectName(rule.project_id);
          return (
            <div key={rule.recurrence_id} className="flex items-center gap-3 px-4 py-2.5 group">
              <Repeat
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  rule.paused ? "text-neutral-300" : "text-sprout-500"
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm truncate",
                    rule.paused ? "text-neutral-400" : "text-neutral-900"
                  )}
                >
                  {rule.title}
                </p>
                <p className="text-xs text-neutral-400 truncate">
                  {recurrenceLabel(rule)}
                  {project && ` · ${project}`}
                  {rule.paused
                    ? " · paused"
                    : rule.nextDate
                      ? ` · next ${dayLabel(rule.nextDate, today)}`
                      : " · finished"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  onClick={() => send("PATCH", { recurrence_id: rule.recurrence_id, paused: !rule.paused })}
                  disabled={busy}
                  className="text-neutral-400 hover:text-sprout-700 transition-colors p-1 disabled:opacity-40"
                  aria-label={rule.paused ? `Resume ${rule.title}` : `Pause ${rule.title}`}
                  title={rule.paused ? "Resume" : "Pause"}
                >
                  {rule.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => send("DELETE", { recurrence_id: rule.recurrence_id })}
                  disabled={busy}
                  className="text-neutral-400 hover:text-red-600 transition-colors p-1 disabled:opacity-40"
                  aria-label={`Delete the repeat for ${rule.title}`}
                  title="Delete the schedule (finished days stay)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-400">
        Deleting a schedule keeps the days it already produced — only untouched future copies go.
      </p>
    </div>
  );
}
