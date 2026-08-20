"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { formatManilaDate } from "@/lib/format";
import {
  formatScoreImpact,
  issueGroupTone,
  jiraIssueUrl,
  severityLabel,
  severityTone,
  type IncidentLog,
  type IncidentTicket,
} from "@/lib/incidents";
import { IncidentLogDialog } from "@/components/incidents/IncidentLogDialog";
import { Copy } from "@/components/ui/Copy";

type TeamMeta = { hasPeerReview: boolean; label: string };

/**
 * The logged half of the page, grouped by ticket rather than a flat log list. Grouping is what
 * makes the doer/validator split legible: on SE an incident routinely carries two logs with
 * different severities, and side by side under one Jira key they read as one incident with two
 * accountabilities — flattened, they read as two unrelated incidents that happen to share a key.
 * It's also where "add the other role's log" naturally belongs.
 */
export function IncidentLogsTable({
  tickets,
  logs,
  teamMeta,
  jiraBaseUrl,
  aiEnabled,
  rosterNames,
  validatorNames,
}: {
  tickets: IncidentTicket[];
  logs: IncidentLog[];
  /** team_key -> { hasPeerReview, label }, so a cross-team view still resolves per-row. */
  teamMeta: Record<string, TeamMeta>;
  jiraBaseUrl: string;
  aiEnabled: boolean;
  rosterNames: string[];
  validatorNames: string[];
}) {
  const [editing, setEditing] = useState<{ ticket: IncidentTicket; log?: IncidentLog } | null>(null);

  const ticketsByKey = useMemo(() => {
    const map = new Map<string, IncidentTicket>();
    tickets.forEach((t) => map.set(t.issue_key, t));
    return map;
  }, [tickets]);

  /**
   * Groups in the order the tickets already arrive in (backend sorts by incident_date desc).
   * A log whose ticket fell outside the current filter window still gets a group — synthesised
   * from the log itself — rather than being dropped: a log is a record about a person, and
   * silently hiding one because its ticket row is missing would understate someone's incidents.
   */
  const groups = useMemo(() => {
    const byKey = new Map<string, { ticket: IncidentTicket; logs: IncidentLog[] }>();

    for (const log of logs) {
      const existing = byKey.get(log.issue_key);
      if (existing) {
        existing.logs.push(log);
        continue;
      }
      const ticket = ticketsByKey.get(log.issue_key) ?? synthesizeTicket(log);
      byKey.set(log.issue_key, { ticket, logs: [log] });
    }

    return Array.from(byKey.values())
      .map((g) => ({
        ...g,
        // Doer before Validator, so the pairing reads in the order the work happened.
        logs: g.logs.slice().sort((a, b) => a.role.localeCompare(b.role)),
        scoreImpact: g.logs.reduce((sum, l) => sum + l.score_impact, 0),
      }))
      .sort((a, b) => String(b.ticket.incident_date).localeCompare(String(a.ticket.incident_date)));
  }, [logs, ticketsByKey]);

  if (!groups.length) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-neutral-500">
          <Copy serious="No incident logs in this period." playful="Nothing is on fire ✨" />
        </p>
        <p className="text-xs text-neutral-400 mt-1">
          Tag a ticket&apos;s Report Tagging field in Jira, sync, then add your feedback here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ ticket, logs: ticketLogs, scoreImpact }) => {
        const meta = teamMeta[ticket.team_key] ?? { hasPeerReview: false, label: ticket.team_key };
        return (
          <div key={ticket.issue_key} className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200/70 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={jiraIssueUrl(jiraBaseUrl, ticket.issue_key)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-sprout-700 hover:underline inline-flex items-center gap-1"
                  >
                    {ticket.issue_key}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <Badge>{meta.label}</Badge>
                  {ticket.issue_type && <Badge>{ticket.issue_type}</Badge>}
                  {ticket.issue_group && (
                    <Badge tone={issueGroupTone(ticket.issue_group)}>{ticket.issue_group}</Badge>
                  )}
                  <span className="text-xs text-neutral-400">
                    {formatManilaDate(ticket.incident_date)}
                  </span>
                </div>
                {ticket.summary && (
                  <p className="text-sm text-neutral-600 mt-1 truncate max-w-2xl">{ticket.summary}</p>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-right">
                  <span className="block text-xs text-neutral-400 uppercase tracking-wide">Impact</span>
                  <span className="block text-base font-semibold text-red-600 tabular-nums">
                    {formatScoreImpact(scoreImpact)}
                  </span>
                </span>
                <button
                  onClick={() => setEditing({ ticket })}
                  className="btn-secondary py-1.5 px-3 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add log
                </button>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
                <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Person</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Impact</th>
                  <th className="px-4 py-2">Categories</th>
                  <th className="px-4 py-2">Feedback</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {ticketLogs.map((log) => (
                  <tr key={log.incident_id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={log.role === "Validator" ? "warning" : "neutral"}>{log.role}</Badge>
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                      {log.employee_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={severityTone(log.severity)}>
                        {log.severity} · {severityLabel(log.severity)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-semibold text-red-600 tabular-nums">
                      {formatScoreImpact(log.score_impact)}
                    </td>
                    <td className="px-4 py-3">
                      {log.categories.length === 0 ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {log.categories.map((c) => (
                            <Badge key={c} tone="success">{c}</Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 max-w-md">
                      {/* The shared rewrite is what's shown; the raw note stays behind the edit
                          dialog so a screen-share of this page never exposes blunt private wording. */}
                      <p className="line-clamp-3">
                        {log.feedback_polished || log.feedback_raw || "—"}
                      </p>
                      {log.improvements && (
                        <p className="text-xs text-neutral-400 mt-1 line-clamp-2 whitespace-pre-line">
                          {log.improvements}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setEditing({ ticket, log })}
                          className="text-neutral-400 hover:text-sprout-600 transition-colors"
                          aria-label="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <DeleteButton endpoint="/api/gas/incidents" id={log.incident_id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {editing && (
        <IncidentLogDialog
          ticket={editing.ticket}
          log={editing.log}
          hasPeerReview={(teamMeta[editing.ticket.team_key] ?? { hasPeerReview: false }).hasPeerReview}
          teamLabel={(teamMeta[editing.ticket.team_key] ?? { label: editing.ticket.team_key }).label}
          jiraBaseUrl={jiraBaseUrl}
          aiEnabled={aiEnabled}
          rosterNames={rosterNames}
          validatorNames={validatorNames}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * A stand-in ticket for a log whose Jira row isn't in the current window (see the grouping note
 * above). Only the fields the group header and the edit dialog read are filled — the dialog
 * anchors on issue_key/team_key, and everything else is presentation.
 */
function synthesizeTicket(log: IncidentLog): IncidentTicket {
  return {
    issue_key: log.issue_key,
    team_key: log.team_key,
    project_key: "",
    summary: "",
    issue_type: "",
    issue_group: log.issue_group,
    status: "",
    doer: log.role === "Doer" ? log.employee_name : "",
    validator: log.role === "Validator" ? log.employee_name : "",
    created: "",
    updated: "",
    resolved_datetime: "",
    incident_date: log.incident_date,
    last_synced_at: "",
  };
}
