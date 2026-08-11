"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ChevronRight } from "lucide-react";
import type { InitiativeTicket, TicketAssignment } from "@/lib/types";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

/** Minimal project shape the table needs for label-based grouping + manual assignment. */
export type ProjectLink = {
  project_id: string;
  project_name: string;
  jira_label: string;
  owning_team: string;
};

function statusTone(status: string): "neutral" | "warning" | "success" | "danger" {
  const s = status.toLowerCase();
  if (["done", "closed", "resolved", "for checking"].includes(s)) return "success";
  if (["on hold", "blocked", "rejected", "cancelled"].includes(s)) return "danger";
  if (["in progress", "for review"].includes(s)) return "warning";
  return "neutral";
}

function ticketLabels(t: InitiativeTicket): string[] {
  return String(t.labels || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function InitiativeTicketsTable({
  tickets,
  teams,
  projects = [],
  assignments = [],
  jiraBaseUrl,
}: {
  tickets: InitiativeTicket[];
  teams: TeamConfig[];
  projects?: ProjectLink[];
  assignments?: TicketAssignment[];
  jiraBaseUrl?: string;
}) {
  const router = useRouter();
  const [team, setTeam] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState("");
  const [assigning, setAssigning] = useState(false);

  const labelledProjects = useMemo(
    () => projects.filter((p) => String(p.jira_label || "").trim()),
    [projects]
  );

  // issue_key -> manually-assigned project_id (manual wins over label match).
  const manualMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments) if (a.project_id) m.set(a.issue_key, a.project_id);
    return m;
  }, [assignments]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.project_id, p])), [projects]);

  // Resolve each ticket to at most one project: manual assignment first, else first label match.
  const resolveProjectId = useMemo(() => {
    return (t: InitiativeTicket): string | undefined => {
      const manual = manualMap.get(t.issue_key);
      if (manual && projectById.has(manual)) return manual;
      const labels = ticketLabels(t);
      const hit = labelledProjects.find((p) => labels.includes(p.jira_label.trim().toLowerCase()));
      return hit?.project_id;
    };
  }, [manualMap, projectById, labelledProjects]);

  const groupingAvailable = labelledProjects.length > 0 || manualMap.size > 0;
  const [grouped, setGrouped] = useState(groupingAvailable);

  // Teams whose initiatives are pulled from Jira (kept in sync with GAS COD_INITIATIVE_TEAM_KEYS).
  const initiativeTeams = teams.filter((t) => ["DE", "DEV", "ST"].includes(t.team_key));

  const filtered = useMemo(
    () => (team ? tickets.filter((t) => t.project_key === team) : tickets),
    [tickets, team]
  );

  const groups = useMemo(() => {
    const byProject = new Map<string, InitiativeTicket[]>();
    const other: InitiativeTicket[] = [];
    for (const t of filtered) {
      const pid = resolveProjectId(t);
      if (pid) {
        if (!byProject.has(pid)) byProject.set(pid, []);
        byProject.get(pid)!.push(t);
      } else {
        other.push(t);
      }
    }
    // Show a group for every project that has a label OR has resolved tickets.
    const shown = projects.filter((p) => p.jira_label.trim() || (byProject.get(p.project_id)?.length ?? 0) > 0);
    return { shown, byProject, other };
  }, [filtered, projects, resolveProjectId]);

  // Accordion open-state. Defaults to open for any group that has tickets (so data is visible on
  // load); once the user toggles anything we track their explicit set instead. "__other__" = the
  // unassigned bucket.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const defaultExpanded = useMemo(() => {
    const s = new Set<string>();
    groups.shown.forEach((p) => { if ((groups.byProject.get(p.project_id)?.length ?? 0) > 0) s.add(p.project_id); });
    if (groups.other.length) s.add("__other__");
    return s;
  }, [groups]);
  const openSet = expanded ?? defaultExpanded;
  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev ?? defaultExpanded);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll(keys: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (checked ? next.add(k) : next.delete(k)));
      return next;
    });
  }

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/gas/initiatives", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      const n = body.data?.synced;
      setSyncMsg(typeof n === "number" ? `Synced ${n} ticket${n === 1 ? "" : "s"} from Jira.` : "Sync complete.");
      router.refresh();
    } catch (err) {
      setSyncMsg(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }

  async function applyAssign() {
    if (selected.size === 0) return;
    setAssigning(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/gas/ticket-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_keys: Array.from(selected), project_id: assignTarget }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      const target = projectById.get(assignTarget);
      setSyncMsg(
        assignTarget
          ? `Assigned ${selected.size} ticket${selected.size === 1 ? "" : "s"} to ${target?.project_name ?? "project"}.`
          : `Unassigned ${selected.size} ticket${selected.size === 1 ? "" : "s"}.`
      );
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setSyncMsg(`Assign failed: ${err instanceof Error ? err.message : String(err)}. If "Unauthorized", sign out and back in.`);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">Jira Initiative Tickets</h2>
          <p className="text-sm text-neutral-500">
            Pulled from Jira — DBA/DevOps <code className="text-xs">cod-initiative</code> + Support Experts{" "}
            <code className="text-xs">se-initiative</code>, created 2026+.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {groupingAvailable && (
            <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
              <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)}
                className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500" />
              Group by project
            </label>
          )}
          <select value={team} onChange={(e) => setTeam(e.target.value)} className="form-input !w-auto py-1.5">
            <option value="">All teams</option>
            {initiativeTeams.map((t) => (
              <option key={t.team_key} value={t.jira_project_key}>{teamLabel(t.team_name)}</option>
            ))}
          </select>
          <button onClick={sync} disabled={syncing} className="btn-secondary inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from Jira"}
          </button>
        </div>
      </div>

      {/* Bulk assignment bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
        <span className="text-neutral-600">
          {selected.size} selected
        </span>
        <span className="text-neutral-400">→</span>
        <select value={assignTarget} onChange={(e) => setAssignTarget(e.target.value)} className="form-input !w-auto py-1.5" disabled={selected.size === 0}>
          <option value="">— Unassign —</option>
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
          ))}
        </select>
        <button onClick={applyAssign} disabled={selected.size === 0 || assigning} className="btn-primary py-1.5">
          {assigning ? "Applying…" : assignTarget ? "Assign" : "Unassign"}
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-xs text-neutral-500 hover:text-neutral-700">Clear</button>
        )}
      </div>

      {syncMsg && <p className="text-sm text-neutral-600">{syncMsg}</p>}

      {!grouped && (
        <div className="card overflow-x-auto">
          <TicketTable
            tickets={filtered}
            jiraBaseUrl={jiraBaseUrl}
            emptyLabel='No initiative tickets synced yet. Click "Sync from Jira".'
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            manualMap={manualMap}
          />
        </div>
      )}

      {grouped && (
        <div className="flex flex-col gap-3">
          {groups.shown.map((project) => {
            const group = groups.byProject.get(project.project_id) ?? [];
            const open = openSet.has(project.project_id);
            return (
              <div key={project.project_id} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(project.project_id)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronRight className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                    <h3 className="text-sm font-semibold text-neutral-800 truncate">{project.project_name}</h3>
                    {project.jira_label.trim() && <code className="text-xs text-neutral-500 shrink-0">{project.jira_label}</code>}
                  </div>
                  <span className="text-xs text-neutral-400 shrink-0 whitespace-nowrap">
                    {group.length} ticket{group.length === 1 ? "" : "s"}
                  </span>
                </button>
                {open && (
                  <div className="overflow-x-auto border-t border-neutral-200">
                    <TicketTable
                      tickets={group}
                      jiraBaseUrl={jiraBaseUrl}
                      emptyLabel="No tickets linked yet (by label or manual assignment)."
                      selected={selected}
                      onToggle={toggle}
                      onToggleAll={toggleAll}
                      manualMap={manualMap}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {groups.other.length > 0 && (
            <div className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggleGroup("__other__")}
                aria-expanded={openSet.has("__other__")}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronRight className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${openSet.has("__other__") ? "rotate-90" : ""}`} />
                  <h3 className="text-sm font-semibold text-neutral-800">Other / unassigned</h3>
                </div>
                <span className="text-xs text-neutral-400 shrink-0 whitespace-nowrap">
                  {groups.other.length} ticket{groups.other.length === 1 ? "" : "s"}
                </span>
              </button>
              {openSet.has("__other__") && (
                <div className="overflow-x-auto border-t border-neutral-200">
                  <TicketTable
                    tickets={groups.other}
                    jiraBaseUrl={jiraBaseUrl}
                    emptyLabel="No unassigned tickets — every ticket is linked to a project."
                    selected={selected}
                    onToggle={toggle}
                    onToggleAll={toggleAll}
                    manualMap={manualMap}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TicketTable({
  tickets,
  jiraBaseUrl,
  emptyLabel,
  selected,
  onToggle,
  onToggleAll,
  manualMap,
}: {
  tickets: InitiativeTicket[];
  jiraBaseUrl?: string;
  emptyLabel: string;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], checked: boolean) => void;
  manualMap: Map<string, string>;
}) {
  const keys = tickets.map((t) => t.issue_key);
  const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));

  return (
    <table className="w-full text-sm">
      <thead className="bg-neutral-50 border-b border-neutral-200">
        <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
          <th className="px-4 py-3 w-8">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onToggleAll(keys, e.target.checked)}
              className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
              aria-label="Select all"
              disabled={keys.length === 0}
            />
          </th>
          <th className="px-4 py-3">Key</th>
          <th className="px-4 py-3">Summary</th>
          <th className="px-4 py-3">Type</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Assignee</th>
          <th className="px-4 py-3">Due</th>
          <th className="px-4 py-3">Link</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {tickets.length === 0 && (
          <tr>
            <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">{emptyLabel}</td>
          </tr>
        )}
        {tickets.map((t) => (
          <tr key={t.issue_key} className={selected.has(t.issue_key) ? "bg-sprout-50/50" : undefined}>
            <td className="px-4 py-3">
              <input
                type="checkbox"
                checked={selected.has(t.issue_key)}
                onChange={() => onToggle(t.issue_key)}
                className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
                aria-label={`Select ${t.issue_key}`}
              />
            </td>
            <td className="px-4 py-3 font-medium whitespace-nowrap">
              {jiraBaseUrl ? (
                <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issue_key}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
                  {t.issue_key}
                </a>
              ) : (
                t.issue_key
              )}
            </td>
            <td className="px-4 py-3 text-neutral-900 max-w-md truncate" title={t.summary}>{t.summary}</td>
            <td className="px-4 py-3 whitespace-nowrap">{t.issue_type}</td>
            <td className="px-4 py-3 whitespace-nowrap"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
            <td className="px-4 py-3 whitespace-nowrap">{t.assignee_display_name || "—"}</td>
            <td className="px-4 py-3 whitespace-nowrap">{t.duedate ? formatManilaDate(t.duedate) : "—"}</td>
            <td className="px-4 py-3 whitespace-nowrap">
              {manualMap.has(t.issue_key) ? (
                <Badge tone="neutral">manual</Badge>
              ) : (
                <span className="text-xs text-neutral-400">by label</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
