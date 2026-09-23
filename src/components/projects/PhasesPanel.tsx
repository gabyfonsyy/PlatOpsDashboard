"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Trash2 } from "lucide-react";
import {
  PHASE_STATUSES,
  PHASE_STATUS_META,
  isPhaseDelayed,
  type InitiativeTicket,
  type ProjectNote,
  type ProjectPhase,
  type ProjectPhaseTicket,
} from "@/lib/project-tracking";
import { formatManilaDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NotesSection } from "@/components/projects/NotesSection";
import { PhaseTicketPicker } from "@/components/projects/PhaseTicketPicker";
import { Copy } from "@/components/ui/Copy";

/**
 * A project's phases, ordered by `position` — collapsed rows for a quick scan (status, progress,
 * a delayed flag), expanded for the rest (description, owner, dates, notes, linked tickets).
 * Reordering moves one phase past its neighbor and PATCHes the FULL id order for the project (see
 * `reorderPhases` — a partial list would leave the phases that didn't move with stale positions).
 */
export function PhasesPanel({
  projectId,
  teamKey,
  phases,
  notesByPhase,
  ticketsByPhase,
  allTickets,
  jiraBaseUrl,
}: {
  projectId: string;
  teamKey: string;
  phases: ProjectPhase[];
  notesByPhase: Record<string, ProjectNote[]>;
  ticketsByPhase: Record<string, ProjectPhaseTicket[]>;
  allTickets: InitiativeTicket[];
  jiraBaseUrl?: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    await fetch("/api/project-tracking/phases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    router.refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= phases.length) return;
    const order = phases.map((p) => p.id);
    [order[index], order[target]] = [order[target], order[index]];
    setReordering(true);
    try {
      await fetch("/api/project-tracking/phases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      router.refresh();
    } finally {
      setReordering(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this phase?")) return;
    await fetch("/api/project-tracking/phases", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  async function addPhase(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/phases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, name: name.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setName("");
      router.refresh();
    } catch (err) {
      setError(`Could not add phase: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {phases.length === 0 && (
        <p className="text-sm text-neutral-400">
          <Copy serious="No phases yet — add one below." playful="No phases charted yet — add one below." />
        </p>
      )}

      {phases.map((phase, i) => {
        const isExpanded = expanded.has(phase.id);
        const delayed = isPhaseDelayed(phase);
        return (
          <div
            key={phase.id}
            className={cn("bg-surface rounded-md border border-neutral-200", reordering && "opacity-60")}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex flex-col shrink-0">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-neutral-300 hover:text-neutral-700 disabled:opacity-30"
                  aria-label="Move phase up"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === phases.length - 1}
                  className="text-neutral-300 hover:text-neutral-700 disabled:opacity-30"
                  aria-label="Move phase down"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <button onClick={() => toggle(phase.id)} className="text-neutral-400 shrink-0" aria-label="Expand phase">
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <span className="flex-1 min-w-0 truncate text-sm text-neutral-800">{phase.name}</span>
              {delayed && (
                <span title="Target date has passed and this phase isn't Done" className="text-amber-600 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" />
                </span>
              )}
              <select
                value={phase.status}
                onChange={(e) => patch(phase.id, { status: e.target.value })}
                className="form-input w-auto shrink-0 text-xs py-1"
                aria-label="Phase status"
              >
                {PHASE_STATUSES.map((s) => (
                  <option key={s} value={s}>{PHASE_STATUS_META[s].label}</option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                defaultValue={phase.progress}
                onBlur={(e) => {
                  const next = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                  if (next !== phase.progress) patch(phase.id, { progress: next });
                }}
                className="form-input w-16 shrink-0 text-xs py-1 text-right"
                aria-label="Progress percent"
              />
              <span className="text-xs text-neutral-400 shrink-0">%</span>
              <button
                onClick={() => remove(phase.id)}
                className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
                aria-label="Delete phase"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {isExpanded && (
              <div className="border-t border-neutral-100 px-3 py-3 flex flex-col gap-2 bg-neutral-50/60">
                <input
                  defaultValue={phase.name}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== phase.name) patch(phase.id, { name: next });
                  }}
                  className="form-input text-sm"
                  placeholder="Phase name"
                  aria-label="Phase name"
                />
                <textarea
                  defaultValue={phase.description}
                  onBlur={(e) => e.target.value !== phase.description && patch(phase.id, { description: e.target.value })}
                  rows={2}
                  className="form-input text-sm"
                  placeholder="Description"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    defaultValue={phase.owner}
                    onBlur={(e) => e.target.value !== phase.owner && patch(phase.id, { owner: e.target.value })}
                    className="form-input text-sm"
                    placeholder="Owner"
                  />
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-neutral-500">Actual Completion</span>
                    <input
                      type="date"
                      defaultValue={phase.actual_completion_date ? formatManilaDate(phase.actual_completion_date) : ""}
                      onBlur={(e) => {
                        const current = phase.actual_completion_date ? formatManilaDate(phase.actual_completion_date) : "";
                        if (e.target.value !== current) patch(phase.id, { actual_completion_date: e.target.value || null });
                      }}
                      className="form-input text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-neutral-500">Start</span>
                    <input
                      type="date"
                      defaultValue={phase.start_date ? formatManilaDate(phase.start_date) : ""}
                      onBlur={(e) => {
                        const current = phase.start_date ? formatManilaDate(phase.start_date) : "";
                        if (e.target.value !== current) patch(phase.id, { start_date: e.target.value || null });
                      }}
                      className="form-input text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-neutral-500">Target</span>
                    <input
                      type="date"
                      defaultValue={phase.target_date ? formatManilaDate(phase.target_date) : ""}
                      onBlur={(e) => {
                        const current = phase.target_date ? formatManilaDate(phase.target_date) : "";
                        if (e.target.value !== current) patch(phase.id, { target_date: e.target.value || null });
                      }}
                      className="form-input text-sm"
                    />
                  </label>
                </div>
                <textarea
                  defaultValue={phase.notes}
                  onBlur={(e) => e.target.value !== phase.notes && patch(phase.id, { notes: e.target.value })}
                  rows={2}
                  className="form-input text-sm"
                  placeholder="Notes"
                />
                <div className="border-t border-neutral-200 pt-2 mt-1">
                  <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2">Linked Tickets</p>
                  <PhaseTicketPicker
                    phaseId={phase.id}
                    projectId={projectId}
                    teamKey={teamKey}
                    allTickets={allTickets}
                    linkedTickets={ticketsByPhase[phase.id] ?? []}
                    jiraBaseUrl={jiraBaseUrl}
                  />
                </div>
                <div className="border-t border-neutral-200 pt-2 mt-1">
                  <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2">Discussion</p>
                  <NotesSection projectId={projectId} phaseId={phase.id} notes={notesByPhase[phase.id] ?? []} />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <form onSubmit={addPhase} className="flex items-center gap-2 mt-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Baseline measured"
          className="form-input flex-1 text-sm py-1.5"
        />
        <button type="submit" disabled={submitting || !name.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add phase"}
        </button>
      </form>
      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
