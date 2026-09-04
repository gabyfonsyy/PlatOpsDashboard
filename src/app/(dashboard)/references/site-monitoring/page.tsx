import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSiteMonitoringSnapshot } from "@/lib/site-monitoring-store";
import { Copy } from "@/components/ui/Copy";
import { SiteMonitoringSection } from "@/components/references/SiteMonitoringSection";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Dedicated Site Monitoring page, reached only via the built-in card on /references (see
 * SiteMonitoringCard) — not on the top-level nav, so there's no PAGE_NAMES entry for it.
 *
 * Reads the cached snapshot (Supabase, fast) rather than the Google Sheet directly — the source
 * sheet changes ~quarterly, so making every page visit wait on a live GAS round-trip was pure
 * latency with no freshness benefit. The Sheet is only ever touched by an explicit "Sync Site
 * Monitoring" click — see api/site-monitoring/sync/route.ts and SiteMonitoringSection.
 */
export default async function SiteMonitoringPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return <p className="text-sm text-neutral-500">Sign in to see Site Monitoring.</p>;
  }

  const snapshot = await getSiteMonitoringSnapshot().catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/references"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 transition-colors mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to References
        </Link>
        <h1>
          <Copy serious="Site Monitoring" playful="Site Monitoring" />
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          <Copy
            serious="Client and infrastructure reference for P1 investigation."
            playful="Your P1 launchpad. Find the client, trace the stack, figure out what broke."
          />
        </p>
      </div>

      <SiteMonitoringSection
        initialClients={snapshot?.clients ?? []}
        initialSyncedAt={snapshot?.syncedAt ?? null}
      />
    </div>
  );
}
