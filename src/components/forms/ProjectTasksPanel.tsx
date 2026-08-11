"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ExternalLink } from "lucide-react";
import type { TaskRecord } from "@/lib/types";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";
import { formatManilaDate } from "@/lib/format";

/**
 * Inline task checklist for one project — expanded under its row in ProjectsTable. Each task has
 * its own start/target date (rendered as its own bar on the Gantt timeline) and a done checkbox;
 * done/total across these tasks becomes the project's displayed percent once it has any tasks
 * (see resolveDisplayPercent in lib/projection.ts), so toggling a checkbox here moves that number.
 */
export function ProjectTasksPanel({
  projectId,
  tasks,
  tickets = [],
  jiraBaseUrl,
}: {
  projectId: string;
  tasks: TaskRecord[];
  /** Jira initiative tickets, scoped to this project when possible (falls back to the full list). */
  tickets?: ProgressTicketOption[];
  jiraBaseUrl?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [issueKey, setIssueKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticketOptions = useMemo(() => {
    const scoped = tickets.filter((t) => t.project_id === projectId);
    const list = scoped.length ? scoped : tickets;
    return [...list].sort((a, b) =>
      a.issue_key.localeCompare(b.issue_key, undefined, { numeric: true, sensitivity: "base" }));
  }, [tickets, projectId]);

  function jiraLink(key: string) {
    return jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${key}` : null;
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/gas/project-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          task_name: name.trim(),
          start_date: startDate,
          target_date: targetDate,
          issue_key: issueKey,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setName("");
      setStartDate("");
      setTargetDate("");
      setIssueKey("");
      router.refresh();
    } catch (err) {
      setError(`Could not add task: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleDone(task: TaskRecord) {
    await fetch("/api/gas/project-tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.task_id, done: !task.done }),
    });
    router.refresh();
  }

  async function updateDates(task: TaskRecord, patch: { start_date?: string; target_date?: string }) {
    await fetch("/api/gas/project-tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.task_id, ...patch }),
    });
    router.refresh();
  }

  async function updateTicket(task: TaskRecord, nextIssueKey: string) {
    await fetch("/api/gas/project-tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.task_id, issue_key: nextIssueKey }),
    });
    router.refresh();
  }

  async function removeTask(taskId: string) {
    if (!confirm("Delete this task?")) return;
    await fetch("/api/gas/project-tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });
    router.refresh();
  }

  return (
    <div className="bg-neutral-50 border-t border-neutral-200 p-4">
      <div className="flex flex-col gap-1.5">
        {tasks.length === 0 && <p className="text-sm text-neutral-400">No tasks yet — add one below.</p>}
        {tasks.map((t) => (
          <div key={t.task_id} className="flex items-center gap-3 bg-white rounded-md border border-neutral-200 px-3 py-2">
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggleDone(t)}
              className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
            />
            <span className={t.done ? "flex-1 min-w-0 truncate text-sm text-neutral-400 line-through" : "flex-1 min-w-0 truncate text-sm text-neutral-800"}>
              {t.task_name}
            </span>
            <select
              value={t.issue_key || ""}
              onChange={(e) => updateTicket(t, e.target.value)}
              className="form-input w-36 shrink-0 truncate text-xs py-1"
              aria-label="Jira ticket"
            >
              <option value="">— ticket —</option>
              {ticketOptions.map((opt) => (
                <option key={opt.issue_key} value={opt.issue_key}>
                  {opt.issue_key}{opt.summary ? ` — ${opt.summary}` : ""}
                </option>
              ))}
            </select>
            {t.issue_key && (
              jiraLink(t.issue_key) ? (
                <a
                  href={jiraLink(t.issue_key)!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-400 hover:text-sprout-600 transition-colors"
                  aria-label={`Open ${t.issue_key} in Jira`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <ExternalLink className="w-3.5 h-3.5 text-neutral-200" aria-hidden />
              )
            )}
            <input
              type="date"
              defaultValue={t.start_date ? formatManilaDate(t.start_date) : ""}
              onBlur={(e) => e.target.value !== (t.start_date ? formatManilaDate(t.start_date) : "") && updateDates(t, { start_date: e.target.value })}
              className="form-input !w-auto text-xs py-1"
              aria-label="Start date"
            />
            <span className="text-neutral-300">→</span>
            <input
              type="date"
              defaultValue={t.target_date ? formatManilaDate(t.target_date) : ""}
              onBlur={(e) => e.target.value !== (t.target_date ? formatManilaDate(t.target_date) : "") && updateDates(t, { target_date: e.target.value })}
              className="form-input !w-auto text-xs py-1"
              aria-label="Target date"
            />
            <button
              onClick={() => removeTask(t.task_id)}
              className="text-neutral-400 hover:text-red-600 transition-colors"
              aria-label="Delete task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={addTask} className="flex items-center gap-2 mt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Review KT"
          className="form-input flex-1 text-sm py-1.5"
        />
        <select
          value={issueKey}
          onChange={(e) => setIssueKey(e.target.value)}
          className="form-input w-36 shrink-0 truncate text-sm py-1.5"
          aria-label="Jira ticket"
        >
          <option value="">— ticket —</option>
          {ticketOptions.map((opt) => (
            <option key={opt.issue_key} value={opt.issue_key}>
              {opt.issue_key}{opt.summary ? ` — ${opt.summary}` : ""}
            </option>
          ))}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input !w-auto text-sm py-1.5" aria-label="Start date" />
        <span className="text-neutral-300">→</span>
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="form-input !w-auto text-sm py-1.5" aria-label="Target date" />
        <button type="submit" disabled={submitting || !name.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add task"}
        </button>
      </form>
      {error && <p className="form-error mt-2">{error}</p>}
    </div>
  );
}
