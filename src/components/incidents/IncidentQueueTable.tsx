"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MessageSquarePlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate } from "@/lib/format";
import { issueGroupTone, jiraIssueUrl, type IncidentTicket } from "@/lib/incidents";
import { IncidentLogDialog } from "@/components/incidents/IncidentLogDialog";
import { RemoveIncidentTicketButton } from "@/components/incidents/RemoveIncidentTicketButton";

/**
 * Tickets tagged in Jira that have no log yet — the manager's actual to-do list, kept above the
 * logged incidents rather than mixed in. These rows are the reason the page shows tickets and
 * logs as two datasets instead of a join: "tagged but not yet written up" is a state that a
 * joined view can only express by fabricating an empty log row.
 */
export function IncidentQueueTable({
  tickets,
  teamMeta,
  jiraBaseUrl,
  aiEnabled,
  rosterNames,
  validatorNames,
}: {
  tickets: IncidentTicket[];
  teamMeta: Record<string, { hasPeerReview: boolean; label: string }>;
  jiraBaseUrl: string;
  aiEnabled: boolean;
  rosterNames: string[];
  /** The designated peer reviewers — the only selectable validators. */
  validatorNames: string[];
}) {
  const router = useRouter();
  const [logging, setLogging] = useState<IncidentTicket | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Writes a manual validator override. Kept as an inline select rather than hidden behind a
   * dialog: correcting a mis-attributed reviewer is a one-value change, and the whole point is to
   * fix it while looking at the row that's wrong.
   */
  async function setValidator(issueKey: string, validator: string) {
    setSavingKey(issueKey);
    setError(null);
    try {
      const res = await fetch("/api/gas/incidents/validator", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_key: issueKey, validator }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  if (!tickets.length) return null;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200/70 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Awaiting your feedback</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Tagged in Jira, no incident log written yet.
          </p>
        </div>
        <Badge tone="warning">{tickets.length}</Badge>
      </div>

      {error && <p className="px-4 py-2 text-xs text-red-600 border-b border-neutral-200/70">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2">Jira Key</th>
              <th className="px-4 py-2">Issue Type</th>
              <th className="px-4 py-2">Team</th>
              <th className="px-4 py-2">Doer</th>
              <th className="px-4 py-2">Validator</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {tickets.map((ticket) => {
              const meta = teamMeta[ticket.team_key] ?? { hasPeerReview: false, label: ticket.team_key };
              return (
                <tr key={ticket.issue_key}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {/* Summary was dropped as a column — it was the one field wide enough to force
                        the whole table into horizontal scrolling. Kept as the link's title so it's
                        still available on hover, at zero layout cost. */}
                    <a
                      href={jiraIssueUrl(jiraBaseUrl, ticket.issue_key)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={ticket.summary || undefined}
                      className="font-semibold text-sprout-700 hover:underline inline-flex items-center gap-1"
                    >
                      {ticket.issue_key}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="block text-neutral-700">{ticket.issue_type || "—"}</span>
                    {/* Blank on DBA/DevOps by design — they file a single issue type, so a group
                        badge there would be decoration rather than information. */}
                    {ticket.issue_group && (
                      <Badge tone={issueGroupTone(ticket.issue_group)}>{ticket.issue_group}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge>{meta.label}</Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{ticket.doer || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                    {/* "n/a" on DBA/DevOps by design — no peer-review step, so no validator exists.
                        Elsewhere this is editable: the derivation is a best guess from the
                        changelog, and only the designated reviewers are selectable. */}
                    {!meta.hasPeerReview ? (
                      "n/a"
                    ) : (
                      <select
                        value={ticket.validator || ""}
                        onChange={(e) => setValidator(ticket.issue_key, e.target.value)}
                        disabled={savingKey === ticket.issue_key}
                        className="form-input w-auto py-1 text-sm disabled:cursor-wait"
                        aria-label={`Validator for ${ticket.issue_key}`}
                        title={
                          ticket.validator_override
                            ? "Set manually — a sync won't overwrite this"
                            : "Derived from the Jira changelog"
                        }
                      >
                        <option value="">—</option>
                        {validatorNames.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    )}
                    {ticket.validator_override && (
                      <span className="block text-[10px] text-neutral-400 mt-0.5">manual</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                    {formatManilaDate(ticket.incident_date)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <button onClick={() => setLogging(ticket)} className="btn-secondary py-1.5 px-3 text-xs">
                        <MessageSquarePlus className="w-3.5 h-3.5" />
                        Log incident
                      </button>
                      {/* The other outcome of reviewing a tagged ticket. Nothing is lost here - a
                          queue row has no feedback on it yet - so it stays a quiet tertiary link
                          rather than a second button competing with the real action. */}
                      <RemoveIncidentTicketButton issueKey={ticket.issue_key} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {logging && (
        <IncidentLogDialog
          ticket={logging}
          hasPeerReview={(teamMeta[logging.team_key] ?? { hasPeerReview: false }).hasPeerReview}
          teamLabel={(teamMeta[logging.team_key] ?? { label: logging.team_key }).label}
          jiraBaseUrl={jiraBaseUrl}
          aiEnabled={aiEnabled}
          rosterNames={rosterNames}
          validatorNames={validatorNames}
          onClose={() => setLogging(null)}
        />
      )}
    </div>
  );
}
