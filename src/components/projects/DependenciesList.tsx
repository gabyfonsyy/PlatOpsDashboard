"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { ProjectDependency } from "@/lib/project-tracking";
import { Badge } from "@/components/ui/Badge";

/** External things this project is waiting on — distinct from a blocker note, which is "this
 * project itself can't move." Project-level for now (the schema's `phase_id` is there for a
 * later phase-scoped view, not wired into this component yet). */
export function DependenciesList({ projectId, dependencies }: { projectId: string; dependencies: ProjectDependency[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleStatus(dep: ProjectDependency) {
    await fetch("/api/project-tracking/dependencies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dep.id, status: dep.status === "open" ? "resolved" : "open" }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this dependency?")) return;
    await fetch("/api/project-tracking/dependencies", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  async function addDependency(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, label: label.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setLabel("");
      router.refresh();
    } catch (err) {
      setError(`Could not add dependency: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {dependencies.length === 0 && <p className="text-sm text-neutral-400">No dependencies yet.</p>}
      {dependencies.map((d) => (
        <div key={d.id} className="flex items-center gap-2 bg-surface rounded-md border border-neutral-200 px-3 py-2">
          <button onClick={() => toggleStatus(d)} className="shrink-0" aria-label="Toggle dependency status">
            <Badge tone={d.status === "open" ? "warning" : "success"}>{d.status === "open" ? "Open" : "Resolved"}</Badge>
          </button>
          <span
            className={
              d.status === "resolved"
                ? "flex-1 min-w-0 truncate text-sm text-neutral-400 line-through"
                : "flex-1 min-w-0 truncate text-sm text-neutral-800"
            }
          >
            {d.label}
          </span>
          <button
            onClick={() => remove(d.id)}
            className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
            aria-label="Delete dependency"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <form onSubmit={addDependency} className="flex items-center gap-2 mt-1">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Waiting on Data Team schema change"
          className="form-input flex-1 text-sm py-1.5"
        />
        <button type="submit" disabled={submitting || !label.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add"}
        </button>
      </form>
      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
