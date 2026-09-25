import Link from "next/link";
import { Server, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

/**
 * The built-in, first reference tile — always rendered above user references (see references
 * page.tsx, which renders it outside the Supabase-backed ReferencesView so it shows even when
 * that table isn't set up yet). Not a work_references row: it has no reference_id, can't be
 * edited/deleted/reordered, and is never counted in "N saved". Links out to the dedicated Site
 * Monitoring page rather than rendering the table here.
 *
 * Deliberately the SAME footprint as a normal reference tile (see ReferencesView) — "featured
 * card, not featured section". Only the accent color and the "Built-in" badge set it apart.
 *
 * Contrast note: the featured border is a `background-color` frame around the `.card`, not a
 * `border-2` utility on the card itself. `[data-theme="adhd"] .card` sets `border-color` (and
 * `box-shadow`) as unlayered rules in globals.css, which beat any Tailwind border/ring utility
 * regardless of specificity — a `border-2 border-sprout-300` accent silently disappeared in Gaby
 * View. Wrapping the card in a thin padded box whose own background IS the accent colour survives
 * every theme instead, since it never touches the `.card` element's own border-color — same
 * technique as HealthDot.tsx's `healthAccentBg`, generalised to all four edges.
 */
export function SiteMonitoringCard() {
  return (
    <div className="rounded-2xl p-[2px] bg-sprout-300 h-full">
      <Link
        href="/references/site-monitoring"
        className="card p-4 flex flex-col gap-3 h-full bg-sprout-50 shadow-lg hover:bg-sprout-100/70 transition-colors group"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="w-9 h-9 rounded-lg bg-sprout-100 text-sprout-700 flex items-center justify-center shrink-0">
            <Server className="w-4.5 h-4.5" />
          </span>
          <div className="flex items-center gap-1.5">
            {/* A breathing signal light, not an alarm — reads as "live", costs nothing extra to
                justify since this card IS the operational one. */}
            <span className="w-1.5 h-1.5 rounded-full bg-sprout-500 animate-signal-pulse" aria-hidden="true" />
            <Badge tone="success">Built-in</Badge>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-medium text-neutral-900">Site Monitoring</span>
          <p className="text-xs text-neutral-500 mt-0.5">Operational Reference</p>
          <p className="text-sm text-neutral-600 mt-1.5 line-clamp-3">
            Client and infrastructure lookup for P1 incidents, impact assessment, and troubleshooting.
          </p>
        </div>

        <span className="inline-flex items-center gap-1 text-sm font-medium text-sprout-700 group-hover:text-sprout-800 transition-colors">
          Open Site Monitoring
          <ArrowRight className="w-4 h-4" />
        </span>
      </Link>
    </div>
  );
}
