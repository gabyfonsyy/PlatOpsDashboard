"use client";

import {
  EMPTY_PROJECT_FILTERS,
  HEALTH_META,
  PHASE_STATUSES,
  PHASE_STATUS_META,
  isDefaultProjectFilters,
  type ProjectFilterCriteria,
  type ProjectHealth,
  type ProjectPhaseStatus,
  type ProjectStatus,
} from "@/lib/project-tracking";
import { QUADRANT_ORDER, QUADRANT_META, type Quadrant } from "@/lib/work";

const STATUS_OPTIONS: ProjectStatus[] = ["Not Started", "In Progress", "Blocked", "Done"];

/** Client-side filter bar over an already team-scoped in-memory project list — a controlled
 * component (the parent owns `criteria` and re-derives the visible list), not its own data fetch. */
export function FiltersBar({
  criteria,
  onChange,
}: {
  criteria: ProjectFilterCriteria;
  onChange: (next: ProjectFilterCriteria) => void;
}) {
  function set<K extends keyof ProjectFilterCriteria>(key: K, value: ProjectFilterCriteria[K]) {
    onChange({ ...criteria, [key]: value });
  }

  return (
    <div className="card p-3 flex flex-wrap items-center gap-2">
      <select
        value={criteria.status}
        onChange={(e) => set("status", e.target.value as ProjectStatus | "")}
        className="form-input w-auto text-sm py-1.5"
        aria-label="Filter by status"
      >
        <option value="">Status: Any</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        value={criteria.health}
        onChange={(e) => set("health", e.target.value as ProjectHealth)}
        className="form-input w-auto text-sm py-1.5"
        aria-label="Filter by health"
      >
        <option value="">Health: Any</option>
        {(Object.keys(HEALTH_META) as Array<keyof typeof HEALTH_META>).map((h) => (
          <option key={h} value={h}>{HEALTH_META[h].label}</option>
        ))}
      </select>

      <input
        value={criteria.owner}
        onChange={(e) => set("owner", e.target.value)}
        placeholder="Owner"
        className="form-input w-auto text-sm py-1.5"
        aria-label="Filter by owner"
      />

      <select
        value={criteria.quadrant}
        onChange={(e) => set("quadrant", e.target.value as Quadrant | "unsorted" | "")}
        className="form-input w-auto text-sm py-1.5"
        aria-label="Filter by priority"
      >
        <option value="">Priority: Any</option>
        <option value="unsorted">Unsorted</option>
        {QUADRANT_ORDER.map((q) => (
          <option key={q} value={q}>{QUADRANT_META[q].verb}</option>
        ))}
      </select>

      <select
        value={criteria.phaseStatus}
        onChange={(e) => set("phaseStatus", e.target.value as ProjectPhaseStatus | "no_phases" | "")}
        className="form-input w-auto text-sm py-1.5"
        aria-label="Filter by phase status"
      >
        <option value="">Phase: Any</option>
        <option value="no_phases">No phases</option>
        {PHASE_STATUSES.map((s) => (
          <option key={s} value={s}>Has {PHASE_STATUS_META[s].label.toLowerCase()} phase</option>
        ))}
      </select>

      <select
        value={criteria.dueDate}
        onChange={(e) => set("dueDate", e.target.value as ProjectFilterCriteria["dueDate"])}
        className="form-input w-auto text-sm py-1.5"
        aria-label="Filter by due date"
      >
        <option value="">Due Date: Any</option>
        <option value="overdue">Overdue</option>
        <option value="due_soon">Due soon (14d)</option>
        <option value="no_target">No target date</option>
      </select>

      <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={criteria.hasBlocker}
          onChange={(e) => set("hasBlocker", e.target.checked)}
          className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
        />
        Blocked
      </label>
      <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={criteria.hasRisk}
          onChange={(e) => set("hasRisk", e.target.checked)}
          className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
        />
        Has open risk
      </label>
      <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={criteria.hasLinkedTickets}
          onChange={(e) => set("hasLinkedTickets", e.target.checked)}
          className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
        />
        Has linked tickets
      </label>
      <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={criteria.batchEnabled}
          onChange={(e) => set("batchEnabled", e.target.checked)}
          className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
        />
        Batch tracking
      </label>

      {!isDefaultProjectFilters(criteria) && (
        <button
          onClick={() => onChange(EMPTY_PROJECT_FILTERS)}
          className="text-xs text-neutral-500 hover:text-neutral-700 ml-auto"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
