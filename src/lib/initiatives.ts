import { fetchGas } from "@/lib/gas-client";
import type { InitiativeTicket } from "@/lib/types";

/** Jira cod-initiative tickets (DE/DEV) pulled into INITIATIVE_TICKETS. no-store so a fresh
 * "Sync from Jira" is reflected immediately after router.refresh(). */
export async function getInitiativeTickets(
  params: { team?: string; label?: string } = {}
): Promise<InitiativeTicket[]> {
  return fetchGas<InitiativeTicket[]>(
    "initiatives",
    { team: params.team, label: params.label },
    { cache: "no-store" }
  );
}
