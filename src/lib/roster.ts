import { fetchGas } from "@/lib/gas-client";
import type { RosterMember } from "@/lib/types";

/** Server-side cached fetch of the ROSTER tab (active members only) — drives the employee dropdowns. */
export async function getRoster(): Promise<RosterMember[]> {
  return fetchGas<RosterMember[]>("roster", {}, { next: { revalidate: 300 } });
}
