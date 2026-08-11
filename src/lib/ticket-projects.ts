import { fetchGas } from "@/lib/gas-client";
import type { TicketAssignment } from "@/lib/types";

/** Manual ticket→project assignments (TICKET_PROJECT_MAP). no-store so a fresh assign shows
 * immediately after router.refresh(). */
export async function getTicketAssignments(): Promise<TicketAssignment[]> {
  return fetchGas<TicketAssignment[]>("ticket-projects", {}, { cache: "no-store" });
}
