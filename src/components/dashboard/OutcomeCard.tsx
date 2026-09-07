"use client";

import Link from "next/link";
import { ChevronRight, Info, XCircle, Archive, Ban } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/lib/sla-status";
import type { OutcomeKind } from "@/lib/ticket-outcomes";
import { ticketOutcomeCopy } from "@/lib/ticket-outcomes-view";
import { formatNumber } from "@/lib/format";

/**
 * Visual differentiation for the three outcomes via the EXISTING Badge tones + an icon, not a new
 * color — same reuse-over-invention call sla-status.ts's doc comment made for the P1 SLA page
 * ("a fourth distinct hue was deliberately not added to the design system just for this page").
 */
const OUTCOME_META: Record<
  OutcomeKind,
  { badgeLabel: string; icon: typeof XCircle; tone: BadgeTone; barClass: string; trackClass: string }
> = {
  cancelled: { badgeLabel: "Cancelled", icon: XCircle, tone: "neutral", barClass: "bg-neutral-400", trackClass: "bg-neutral-100" },
  archived: { badgeLabel: "Archived", icon: Archive, tone: "warning", barClass: "bg-amber-500", trackClass: "bg-amber-100" },
  rejected: { badgeLabel: "Rejected", icon: Ban, tone: "danger", barClass: "bg-red-500", trackClass: "bg-red-100" },
};

/**
 * A Ticket Outcomes scorecard: count + share of resolved, a compact top-3 reason breakdown, and a
 * click-through to the matching drill-down — the same shell as MetricCard (see its badge/tooltip
 * markup, copied here rather than adding a "breakdown" prop to it, since no other card needs one)
 * plus the mini ranked-bar list, at MetricCard's own scale.
 */
export function OutcomeCard({
  label,
  outcome,
  value,
  sublabel,
  tooltip,
  href,
  breakdown,
}: {
  label: string;
  outcome: OutcomeKind;
  value: string;
  sublabel?: string;
  tooltip?: string;
  href: string;
  /** Already sorted descending by count (see toCountRows in lib/ticket-outcomes.ts). */
  breakdown: { key: string; count: number }[];
}) {
  const { theme } = useTheme();
  const copy = ticketOutcomeCopy(theme);
  const meta = OUTCOME_META[outcome];
  const Icon = meta.icon;
  const top = breakdown.slice(0, 3);
  const max = top.reduce((m, r) => Math.max(m, r.count), 0);

  return (
    <Link href={href} className="card card-interactive p-5 block">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</p>
        {tooltip && (
          <span className="group relative inline-flex">
            <Info className="w-3.5 h-3.5 text-neutral-300 hover:text-neutral-500 cursor-help transition-colors" />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56
                         rounded-lg bg-neutral-900 text-white text-[11px] leading-snug font-normal normal-case tracking-normal
                         px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30 shadow-lg"
            >
              {tooltip}
            </span>
          </span>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-neutral-300 ml-auto" />
      </div>
      <p className="text-2xl font-semibold text-neutral-900 mt-1">{value}</p>
      {sublabel && <p className="text-xs text-neutral-400 mt-1">{sublabel}</p>}
      <p className="text-xs text-neutral-400 mt-1">{copy.outcomeTagline[outcome]}</p>

      {top.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {top.map((r) => (
            <li key={r.key}>
              <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span className="truncate min-w-0">{r.key}</span>
                <span className="tabular-nums shrink-0">{formatNumber(r.count)}</span>
              </div>
              <span className={`block mt-0.5 h-1 rounded-full ${meta.trackClass} overflow-hidden`}>
                <span
                  className={`block h-full ${meta.barClass}`}
                  style={{ width: max ? `${Math.max(4, (r.count / max) * 100)}%` : "0%" }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-neutral-400 mt-3">{copy.emptyState}</p>
      )}
      <div className="mt-3 flex items-center gap-1">
        <Badge tone={meta.tone}>{meta.badgeLabel}</Badge>
      </div>
    </Link>
  );
}
