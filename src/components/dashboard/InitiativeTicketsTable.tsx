"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { InitiativeTicket, TicketAssignment } from "@/lib/project-tracking";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { ticketsForTeam } from "@/components/projects/ticket-search";

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

  // Teams whose initiatives are pulled from Jira (kept in sync with GAS COD_INITIATIVE_TEAM_KEYS).
  const initiativeTeams = teams.filter((t) => ["DE", "DEV", "ST"].includes(t.team_key));

  const filtered = useMemo(() => ticketsForTeam(tickets, team), [tickets, team]);

  // Only tickets not yet resolved to a project — by label or manual assignment. Once a ticket is
  // linked, it belongs to that project's own view (the drill-down's Linked Tickets accordion, or
  // this table filtered/grouped elsewhere) — this table's whole job now is surfacing the backlog
  // still waiting to be categorized, not re-showing what's already sorted.
  const unlinked = useMemo(
    () => filtered.filter((t) => !resolveProjectId(t)),
    [filtered, resolveProjectId]
  );

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
      const res = await fetch("/api/project-tracking/initiative-tickets", { method: "POST" });
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
      const res = await fetch("/api/project-tracking/ticket-map", {
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
            <code className="text-xs">se-initiative</code>, created 2026+. Showing only tickets not yet
            linked to a project — assign them below, or set a project&apos;s Jira Label to pick up
            matching tickets automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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

      <div className="card overflow-x-auto">
        <TicketTable
          tickets={unlinked}
          jiraBaseUrl={jiraBaseUrl}
          emptyLabel="No unlinked tickets — everything synced is already categorized."
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
        />
      </div>
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
}: {
  tickets: InitiativeTicket[];
  jiraBaseUrl?: string;
  emptyLabel: string;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], checked: boolean) => void;
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
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {tickets.length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">{emptyLabel}</td>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
