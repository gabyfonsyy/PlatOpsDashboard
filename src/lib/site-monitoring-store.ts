import { getSupabaseClient } from "@/lib/supabase";
import type { SiteMonitoringClient } from "@/lib/site-monitoring";

/**
 * Server-only cache access for the Site Monitoring snapshot. The Sheet itself is only touched by
 * an explicit sync (see api/site-monitoring/sync/route.ts) — every page load reads this instead,
 * which is what makes opening the page fast regardless of how slow the GAS round-trip is.
 */

export type SiteMonitoringSnapshot = {
  clients: SiteMonitoringClient[];
  syncedAt: string;
};

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = error.message ?? "";
  return /relation .* does not exist/i.test(message) || /could not find the table/i.test(message);
}

/** Null means "never synced yet" (including: table not migrated) — both are the same UI state. */
export async function getSiteMonitoringSnapshot(): Promise<SiteMonitoringSnapshot | null> {
  const { data, error } = await getSupabaseClient()
    .from("site_monitoring_snapshot")
    .select("data, synced_at")
    .eq("id", "current")
    .maybeSingle();
  if (isMissingTable(error)) return null;
  if (error) throw new Error(`Could not load the Site Monitoring snapshot: ${error.message}`);
  if (!data) return null;
  return { clients: (data.data as SiteMonitoringClient[]) ?? [], syncedAt: data.synced_at as string };
}

export async function saveSiteMonitoringSnapshot(clients: SiteMonitoringClient[]): Promise<SiteMonitoringSnapshot> {
  const syncedAt = new Date().toISOString();
  const { error } = await getSupabaseClient()
    .from("site_monitoring_snapshot")
    .upsert({ id: "current", data: clients, synced_at: syncedAt });
  if (isMissingTable(error)) {
    throw new Error("Site Monitoring's cache table isn't set up yet — run supabase/site-monitoring.sql in the Supabase SQL editor.");
  }
  if (error) throw new Error(`Could not save the Site Monitoring snapshot: ${error.message}`);
  return { clients, syncedAt };
}
