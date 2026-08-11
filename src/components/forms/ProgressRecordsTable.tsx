"use client";

import { useMemo, useState } from "react";
import { Pencil, ArrowUpDown } from "lucide-react";
import type { ProgressRecord } from "@/lib/types";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EditProgressDialog } from "@/components/forms/EditProgressDialog";
import type { ProgressProjectOption, ProgressTicketOption } from "@/components/forms/progress-fields";

const UNASSIGNED = "__unassigned__";

export function ProgressRecordsTable({
  records,
  projects,
  teams,
  tickets,
  jiraBaseUrl,
}: {
  records: ProgressRecord[];
  projects: ProgressProjectOption[];
  teams: TeamConfig[];
  tickets: ProgressTicketOption[];
  jiraBaseUrl?: string;
}) {
  const [editing, setEditing] = useState<ProgressRecord | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const nameById = new Map(projects.map((p) => [p.project_id, p.project_name]));
  const ownerByProject = new Map(projects.map((p) => [p.project_id, p.owning_team || UNASSIGNED]));
  const teamNameByKey = new Map(teams.map((t) => [t.team_key, t.team_name]));
  const teamOrderByKey = new Map(teams.map((t) => [t.team_key, t.sort_order]));

  const projectChoices = useMemo(
    () => [...projects].sort((a, b) => a.project_name.localeCompare(b.project_name)),
    [projects]
  );

  function handleProjectChange(id: string) {
    setProjectFilter(id);
    // Picking a single project reads most naturally as a chronological log of its own progress.
    setSortDir(id ? "asc" : "desc");
  }

  const base = projectFilter ? records.filter((r) => r.project_id === projectFilter) : records;
  const sorted = [...base].sort((a, b) =>
    sortDir === "asc"
      ? String(a.date).localeCompare(String(b.date))
      : String(b.date).localeCompare(String(a.date))
  );

  // When viewing all projects together, break the log into per-team sections so it stays
  // readable as more batches accumulate across projects instead of one long consolidated list.
  const groups = useMemo(() => {
    if (projectFilter) return null;
    const map = new Map<string, ProgressRecord[]>();
    for (const r of sorted) {
      const key = ownerByProject.get(r.project_id) || UNASSIGNED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return (teamOrderByKey.get(a) ?? 999) - (teamOrderByKey.get(b) ?? 999);
    });
  }, [sorted, projectFilter, ownerByProject, teamOrderByKey]);

  function renderRows(list: ProgressRecord[]) {
    return (
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Project</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3 text-right">Processed</th>
            <th className="px-4 py-3">Notes</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {list.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">No processed batches logged yet.</td>
            </tr>
          )}
          {list.map((r) => (
            <tr key={r.progress_id}>
              <td className="px-4 py-3 font-medium text-neutral-900">{nameById.get(r.project_id) ?? r.project_id}</td>
              <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(r.date)}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {r.issue_key ? (
                  jiraBaseUrl ? (
                    <a
                      href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${r.issue_key}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sprout-700 hover:underline"
                    >
                      {r.issue_key}
                    </a>
                  ) : (
                    r.issue_key
                  )
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-medium text-neutral-900">
                {Number(r.items_processed).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-neutral-600">{r.notes || <span className="text-neutral-400">—</span>}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setEditing(r)}
                    className="text-neutral-400 hover:text-sprout-600 transition-colors"
                    aria-label="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <DeleteButton endpoint="/api/gas/project-progress" id={r.progress_id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-neutral-200 bg-neutral-50">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Project</label>
          <select
            value={projectFilter}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="form-input w-auto text-sm py-1.5"
          >
            <option value="">All Projects</option>
            {projectChoices.map((p) => (
              <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="btn-ghost flex items-center gap-1.5 text-sm py-1.5"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortDir === "asc" ? "Oldest first" : "Newest first"}
        </button>
      </div>

      {groups ? (
        groups.map(([key, list]) => (
          <div key={key} className="border-b border-neutral-200 last:border-b-0">
            <div className="px-4 py-2 bg-neutral-50/60 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              {key === UNASSIGNED ? "No Team" : teamLabel(teamNameByKey.get(key) ?? key)}
              <span className="ml-2 text-neutral-400 font-normal normal-case">({list.length})</span>
            </div>
            {renderRows(list)}
          </div>
        ))
      ) : (
        renderRows(sorted)
      )}

      {editing && (
        <EditProgressDialog
          record={editing}
          projects={projects}
          tickets={tickets}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
