import type { InitiativeTicket } from "@/lib/project-tracking";

/** Tickets belonging to one team (`InitiativeTicket.project_key`, the Jira project key — DE/DEV/
 * ST). Same team scoping `InitiativeTicketsTable.tsx`'s own team filter already used inline;
 * pulled out here so `PhaseTicketPicker` can scope to a project's own team without duplicating it. */
export function ticketsForTeam(tickets: InitiativeTicket[], teamKey: string): InitiativeTicket[] {
  return teamKey ? tickets.filter((t) => t.project_key === teamKey) : tickets;
}

/** Free-text search over initiative tickets — matches issue key or summary, case-insensitive. */
export function searchInitiativeTickets(tickets: InitiativeTicket[], query: string): InitiativeTicket[] {
  const q = query.trim().toLowerCase();
  if (!q) return tickets;
  return tickets.filter(
    (t) => t.issue_key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)
  );
}
