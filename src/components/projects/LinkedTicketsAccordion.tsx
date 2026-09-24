"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { InitiativeTicket } from "@/lib/project-tracking";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { searchInitiativeTickets, ticketsByLabel, ticketsForTeam } from "@/components/projects/ticket-search";

function statusTone(status: string): "neutral" | "warning" | "success" | "danger" {
  const s = status.toLowerCase();
  if (["done", "closed", "resolved", "for checking"].includes(s)) return "success";
  if (["on hold", "blocked", "rejected", "cancelled"].includes(s)) return "danger";
  if (["in progress", "for review"].includes(s)) return "warning";
  return "neutral";
}

/**
 * All tickets resolved to this project — label match, manual assignment, and phase-level links —
 * next to Activity. Search-and-link and link-by-label here both write a manual assignment via
 * `/api/project-tracking/ticket-map`, the same endpoint InitiativeTicketsTable's own bulk-assign
 * bar uses — this is just a second, more discoverable entry point onto the same mechanism, not a
 * new one. Unlinking a label-matched or phase-linked ticket still happens where it always has
 * (the project's Jira Label field, or PhaseTicketPicker for phase-level links) since removing
 * those isn't a plain "delete a row" action from here.
 */
export function LinkedTicketsAccordion({
  projectId,
  teamKey,
  tickets,
  allTickets,
  jiraBaseUrl,
}: {
  projectId: string;
  teamKey: string;
  tickets: InitiativeTicket[];
  allTickets: InitiativeTicket[];
  jiraBaseUrl?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [bulkLabel, setBulkLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedKeys = useMemo(() => new Set(tickets.map((t) => t.issue_key)), [tickets]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const scoped = ticketsForTeam(allTickets, teamKey);
    return searchInitiativeTickets(scoped, query).filter((t) => !linkedKeys.has(t.issue_key)).slice(0, 8);
  }, [allTickets, teamKey, query, linkedKeys]);

  async function assign(issueKeys: string[]) {
    const res = await fetch("/api/project-tracking/ticket-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue_keys: issueKeys, project_id: projectId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  }

  async function link(issueKey: string) {
    setPending(true);
    setError(null);
    try {
      await assign([issueKey]);
      setQuery("");
      router.refresh();
    } catch (err) {
      setError(`Could not link ${issueKey}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPending(false);
    }
  }

  async function linkByLabel() {
    const matches = ticketsByLabel(ticketsForTeam(allTickets, teamKey), bulkLabel).filter(
      (t) => !linkedKeys.has(t.issue_key)
    );
    if (matches.length === 0) {
      setError(`No unlinked tickets found with label "${bulkLabel.trim()}".`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await assign(matches.map((t) => t.issue_key));
    } catch (err) {
      setError(`Could not link tickets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkLabel("");
      setPending(false);
      router.refresh();
    }
  }

  return (
    <Accordion title="Linked Tickets" count={tickets.length} countLabel="tickets" defaultOpen={false}>
      <div className="flex flex-col gap-2">
        {tickets.length === 0 ? (
          <p className="text-sm text-neutral-400">No tickets linked yet.</p>
        ) : (
          tickets.map((t) => (
            <div key={t.issue_key} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                {jiraBaseUrl ? (
                  <a
                    href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issue_key}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sprout-700 hover:underline shrink-0"
                  >
                    {t.issue_key}
                  </a>
                ) : (
                  <span className="shrink-0">{t.issue_key}</span>
                )}
                <span className="text-neutral-600 truncate">{t.summary}</span>
              </div>
              <Badge tone={statusTone(t.status)}>{t.status}</Badge>
            </div>
          ))
        )}

        <div className="relative mt-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets to link…"
            disabled={pending}
            className="form-input text-sm py-1.5 w-full"
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full card p-1 flex flex-col gap-0.5 max-h-48 overflow-y-auto shadow-lg">
              {results.map((t) => (
                <button
                  key={t.issue_key}
                  onClick={() => link(t.issue_key)}
                  disabled={pending}
                  className="text-left px-2 py-1.5 rounded hover:bg-neutral-50 text-sm flex items-center gap-2"
                >
                  <span className="font-medium text-neutral-700 shrink-0">{t.issue_key}</span>
                  <span className="flex-1 min-w-0 truncate text-neutral-500 text-xs">{t.summary}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (bulkLabel.trim() && !pending) linkByLabel();
          }}
          className="flex items-center gap-2"
        >
          <input
            value={bulkLabel}
            onChange={(e) => setBulkLabel(e.target.value)}
            placeholder="Or link all tickets with a Jira label…"
            disabled={pending}
            className="form-input text-sm py-1.5 flex-1"
          />
          <button type="submit" disabled={pending || !bulkLabel.trim()} className="btn-secondary text-xs py-1.5 shrink-0">
            Link all
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}
      </div>
    </Accordion>
  );
}
