"use client";

import { useTheme } from "@/components/theme/ThemeProvider";
import { ticketOutcomeCopy } from "@/lib/ticket-outcomes-view";
import { NO_REASON_LABEL, type OutcomeKind } from "@/lib/ticket-outcomes";
import type { CountRow } from "@/lib/ticket-breakdowns";
import { CountRankTable } from "@/components/dashboard/BreakdownTables";

/**
 * The reason/category breakdown table for one outcome's drill-down — CountRankTable with the
 * Gaby's View caption swapped in when the population actually contains a "No Reason Provided"
 * row, so the flourish never appears when every ticket has a real reason on file.
 */
export function TicketOutcomeReasonBreakdown({
  outcome,
  reasonLabel,
  rows,
  range,
  period,
  issueType,
}: {
  outcome: OutcomeKind;
  reasonLabel: string;
  rows: CountRow[];
  range: string;
  period: string;
  issueType?: string;
}) {
  const { theme } = useTheme();
  const copy = ticketOutcomeCopy(theme);
  const hasNoReasonRows = rows.some((r) => r.key === NO_REASON_LABEL);

  // Built here, not passed in from the server component — a plain function can't cross the
  // server->client boundary as a prop (only "use server" actions can), so the drill-down page
  // hands over the raw filter values instead and this client component builds its own hrefs.
  const hrefForKey = (reason: string) => {
    const params = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}), reason });
    return `?${params.toString()}`;
  };

  return (
    <CountRankTable
      title={reasonLabel}
      keyLabel={reasonLabel}
      rows={rows}
      emptyMessage="No tickets for this period."
      description={hasNoReasonRows ? copy.noReasonCaption[outcome] : undefined}
      hrefForKey={hrefForKey}
    />
  );
}
