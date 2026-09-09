import type { OutcomeKind } from "@/lib/ticket-outcomes";

/**
 * Ticket Outcomes' Gaby's View label overlay — same partial-overlay pattern as
 * lib/backlog-aging-view.ts's BACKLOG_AGING_COPY. Only section intros, per-outcome taglines and
 * empty/no-reason microcopy differ; every number, ranking and filter is identical in both
 * registers (getTicketOutcomeReport/getTicketOutcomeCards never take a theme parameter). Client
 * components read `theme` via useTheme() and pick `gaby` when it's "adhd", same as
 * BacklogHealthCard/InsightsPanel.
 *
 * Kept subtle per the brief: data labels (reason names, counts, "No Reason Provided" itself)
 * never change between registers — only the surrounding prose does.
 */
export const TICKET_OUTCOME_COPY = {
  professional: {
    sectionTitle: "Ticket Outcomes",
    sectionIntro:
      "Tickets that didn't resolve through normal completion — cancelled, archived, or rejected — broken down by why.",
    outcomeTagline: {
      cancelled: "Tickets cancelled before completion.",
      archived: "Tickets archived without being worked.",
      rejected: "Tickets rejected out of the workflow.",
    } as Record<OutcomeKind, string>,
    emptyState: "No tickets met this outcome in this period.",
    noReasonCaption: {
      cancelled: "Cancelled with no reason recorded.",
      archived: "Archived with no reason recorded.",
      rejected: "Rejected with no category recorded.",
    } as Record<OutcomeKind, string>,
  },
  gaby: {
    sectionTitle: "Ticket Outcomes",
    sectionIntro:
      "Not every ticket makes it to the finish line. Let's see who got cancelled, archived, or rejected — and why.",
    outcomeTagline: {
      cancelled: "Cancelled. Gone. Never to be seen again. 🫡",
      archived: "Into the archive it goes. 📦",
      rejected: "The ticket said ‘please’ and the workflow said ‘nope.’ 😌",
    } as Record<OutcomeKind, string>,
    emptyState: "Nothing to see here. Zero tickets met their untimely administrative fate.",
    noReasonCaption: {
      cancelled: "A mystery! Someone cancelled this one, but left us absolutely no lore.",
      archived: "A mystery! Someone archived this one, but left us absolutely no lore.",
      rejected: "A mystery! Someone rejected this one, but left us absolutely no lore.",
    } as Record<OutcomeKind, string>,
  },
} as const;

export type TicketOutcomeCopy = {
  sectionTitle: string;
  sectionIntro: string;
  outcomeTagline: Record<OutcomeKind, string>;
  emptyState: string;
  noReasonCaption: Record<OutcomeKind, string>;
};

export function ticketOutcomeCopy(theme: string | undefined): TicketOutcomeCopy {
  return theme === "adhd" ? TICKET_OUTCOME_COPY.gaby : TICKET_OUTCOME_COPY.professional;
}
