"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { ProjectMilestone } from "@/lib/project-tracking";
import { formatManilaDate } from "@/lib/format";

/** A project's milestones — a simple checklist, ordered by `position` (append-only, no manual
 * reorder like phases). Each gets its own target date so `ProjectPhaseGanttChart` can overlay it
 * as a diamond on the timeline. */
export function MilestonesChecklist({ projectId, milestones }: { projectId: string; milestones: ProjectMilestone[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleDone(m: ProjectMilestone) {
    await fetch("/api/project-tracking/milestones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, done: !m.done }),
    });
    router.refresh();
  }

  async function updateDate(m: ProjectMilestone, value: string) {
    await fetch("/api/project-tracking/milestones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, target_date: value || null }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this milestone?")) return;
    await fetch("/api/project-tracking/milestones", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  async function addMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, name: name.trim(), target_date: targetDate || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setName("");
      setTargetDate("");
      router.refresh();
    } catch (err) {
      setError(`Could not add milestone: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {milestones.length === 0 && <p className="text-sm text-neutral-400">No milestones yet.</p>}
      {milestones.map((m) => (
        <div key={m.id} className="flex items-center gap-3 bg-surface rounded-md border border-neutral-200 px-3 py-2">
          <input
            type="checkbox"
            checked={m.done}
            onChange={() => toggleDone(m)}
            className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
          />
          <span
            className={
              m.done
                ? "flex-1 min-w-0 truncate text-sm text-neutral-400 line-through"
                : "flex-1 min-w-0 truncate text-sm text-neutral-800"
            }
          >
            {m.name}
          </span>
          <input
            type="date"
            defaultValue={m.target_date ? formatManilaDate(m.target_date) : ""}
            onBlur={(e) => {
              const current = m.target_date ? formatManilaDate(m.target_date) : "";
              if (e.target.value !== current) updateDate(m, e.target.value);
            }}
            className="form-input !w-auto text-xs py-1"
            aria-label="Target date"
          />
          <button
            onClick={() => remove(m.id)}
            className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
            aria-label="Delete milestone"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <form onSubmit={addMilestone} className="flex items-center gap-2 mt-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Beta launch"
          className="form-input flex-1 text-sm py-1.5"
        />
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="form-input !w-auto text-sm py-1.5"
          aria-label="Target date"
        />
        <button type="submit" disabled={submitting || !name.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add"}
        </button>
      </form>
      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
