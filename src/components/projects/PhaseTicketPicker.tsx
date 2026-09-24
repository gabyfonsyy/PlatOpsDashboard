"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { InitiativeTicket, ProjectPhaseTicket } from "@/lib/project-tracking";
import { searchInitiativeTickets, ticketsByLabel, ticketsForTeam } from "@/components/projects/ticket-search";
import { Copy } from "@/components/ui/Copy";

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
  const [bulkLabel, setBulkLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUnlink, setSelectedUnlink] = useState<Set<string>>(new Set());

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

  async function linkOne(issueKey: string) {
    const res = await fetch("/api/project-tracking/phase-tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase_id: phaseId, project_id: projectId, issue_key: issueKey }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  }

  async function link(issueKey: string) {
    setPending(true);
    setError(null);
    try {
      await linkOne(issueKey);
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
    const results = await Promise.allSettled(matches.map((t) => linkOne(t.issue_key)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      setError(`Linked ${matches.length - failed} of ${matches.length} tickets — ${failed} failed.`);
    }
    setBulkLabel("");
    setPending(false);
    router.refresh();
  }

  async function unlinkOne(id: string) {
    const res = await fetch("/api/project-tracking/phase-tickets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  }

  async function unlink(id: string) {
    await unlinkOne(id);
    router.refresh();
  }

  function toggleUnlinkSelection(id: string) {
    setSelectedUnlink((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function unlinkSelected() {
    const ids = Array.from(selectedUnlink);
    if (ids.length === 0) return;
    setPending(true);
    setError(null);
    const results = await Promise.allSettled(ids.map((id) => unlinkOne(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      setError(`Unlinked ${ids.length - failed} of ${ids.length} tickets — ${failed} failed.`);
    }
    setSelectedUnlink(new Set());
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      {linkedTickets.length === 0 && (
        <p className="text-xs text-neutral-400">
          <Copy serious="No tickets linked to this phase yet." playful="This phase isn't linked to any tickets yet." />
        </p>
      )}

      {linkedTickets.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={selectedUnlink.size > 0 && selectedUnlink.size === linkedTickets.length}
              onChange={(e) =>
                setSelectedUnlink(e.target.checked ? new Set(linkedTickets.map((l) => l.id)) : new Set())
              }
              className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500"
              aria-label="Select all linked tickets"
            />
            {selectedUnlink.size > 0 ? `${selectedUnlink.size} selected` : "Select all"}
          </label>
          {selectedUnlink.size > 0 && (
            <button
              type="button"
              onClick={unlinkSelected}
              disabled={pending}
              className="text-red-600 hover:text-red-700 font-medium transition-colors"
            >
              Unlink selected
            </button>
          )}
        </div>
      )}

      {linkedTickets.map((link) => {
        const ticket = ticketByKey.get(link.issue_key);
        const href = jiraLink(link.issue_key);
        return (
          <div key={link.id} className="flex items-center gap-2 bg-neutral-50 rounded-md border border-neutral-200 px-2.5 py-1.5">
            <input
              type="checkbox"
              checked={selectedUnlink.has(link.id)}
              onChange={() => toggleUnlinkSelection(link.id)}
              className="rounded border-neutral-300 text-sprout-600 focus:ring-sprout-500 shrink-0"
              aria-label={`Select ${link.issue_key}`}
            />
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

      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
