"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { InitiativeTicket, ProjectPhaseTicket } from "@/lib/project-tracking";
import { searchInitiativeTickets, ticketsForTeam } from "@/components/projects/ticket-search";

/** Links Jira tickets to ONE phase — additional to, never instead of, the project-level linking
 * `InitiativeTicketsTable.tsx` already does. Scoped to the project's own team so the search
 * doesn't surface tickets from teams this project has nothing to do with. */
export function PhaseTicketPicker({
  phaseId,
  projectId,
  teamKey,
  allTickets,
  linkedTickets,
  jiraBaseUrl,
}: {
  phaseId: string;
  projectId: string;
  teamKey: string;
  allTickets: InitiativeTicket[];
  linkedTickets: ProjectPhaseTicket[];
  jiraBaseUrl?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedKeys = useMemo(() => new Set(linkedTickets.map((l) => l.issue_key)), [linkedTickets]);
  const ticketByKey = useMemo(() => new Map(allTickets.map((t) => [t.issue_key, t])), [allTickets]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const scoped = ticketsForTeam(allTickets, teamKey);
    return searchInitiativeTickets(scoped, query).filter((t) => !linkedKeys.has(t.issue_key)).slice(0, 8);
  }, [allTickets, teamKey, query, linkedKeys]);

  function jiraLink(key: string) {
    return jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${key}` : null;
  }

  async function link(issueKey: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/phase-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase_id: phaseId, project_id: projectId, issue_key: issueKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setQuery("");
      router.refresh();
    } catch (err) {
      setError(`Could not link ${issueKey}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPending(false);
    }
  }

  async function unlink(id: string) {
    await fetch("/api/project-tracking/phase-tickets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      {linkedTickets.length === 0 && <p className="text-xs text-neutral-400">No tickets linked to this phase yet.</p>}
      {linkedTickets.map((link) => {
        const ticket = ticketByKey.get(link.issue_key);
        const href = jiraLink(link.issue_key);
        return (
          <div key={link.id} className="flex items-center gap-2 bg-neutral-50 rounded-md border border-neutral-200 px-2.5 py-1.5">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-xs font-medium text-sprout-700 hover:underline shrink-0">
                {link.issue_key}
              </a>
            ) : (
              <span className="text-xs font-medium text-neutral-700 shrink-0">{link.issue_key}</span>
            )}
            <span className="flex-1 min-w-0 truncate text-xs text-neutral-500" title={ticket?.summary}>
              {ticket?.summary ?? "—"}
            </span>
            <button onClick={() => unlink(link.id)} className="text-neutral-400 hover:text-red-600 transition-colors shrink-0" aria-label={`Unlink ${link.issue_key}`}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      <div className="relative mt-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tickets by key or summary…"
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
      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
