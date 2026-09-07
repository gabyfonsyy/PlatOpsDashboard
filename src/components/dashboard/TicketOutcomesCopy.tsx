"use client";

import { useTheme } from "@/components/theme/ThemeProvider";
import { ticketOutcomeCopy } from "@/lib/ticket-outcomes-view";
import type { OutcomeKind } from "@/lib/ticket-outcomes";

/** The Ticket Outcomes section's Gaby's View intro line on the Team Stats page. */
export function TicketOutcomesSectionIntro() {
  const { theme } = useTheme();
  return <p className="text-sm text-neutral-500 mt-1">{ticketOutcomeCopy(theme).sectionIntro}</p>;
}

/** One outcome's Gaby's View tagline, for a drill-down page header. */
export function TicketOutcomeTagline({ outcome }: { outcome: OutcomeKind }) {
  const { theme } = useTheme();
  return <p className="text-sm text-neutral-500 mt-1">{ticketOutcomeCopy(theme).outcomeTagline[outcome]}</p>;
}
