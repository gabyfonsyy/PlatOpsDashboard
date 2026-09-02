import type { P1SlaReport } from "@/lib/p1-sla";
import { formatNumber, formatPercent } from "@/lib/format";

const SEGMENTS: { key: keyof P1SlaReport["controllability"]; label: string; description: string; colorVar: string }[] = [
  {
    key: "internal",
    label: "Internal",
    description: "Ticket break, missing details, resolution/script not approved, blocked by another P1 — the team's own process.",
    colorVar: "--a-500",
  },
  {
    key: "dependency",
    label: "Dependency",
    description: "Escalated to another team, or held on Platform Operations / L3 Support / Security Operations dependency.",
    colorVar: "--warn-500",
  },
  {
    key: "external",
    label: "External",
    description: "Awaiting client/requester feedback.",
    colorVar: "--n-400",
  },
];

/**
 * Real 3-way split of WHY overdue P1s stalled, so a breach doesn't automatically read as a
 * team-performance problem — see controllabilityOf() in lib/p1-sla.ts for exactly which real
 * holding-reason/escalation values land in which bucket.
 */
export function P1ControllabilityBreakdown({ controllability }: { controllability: P1SlaReport["controllability"] }) {
  const total = SEGMENTS.reduce((sum, s) => sum + controllability[s.key].count, 0);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-sm font-semibold text-neutral-900">Is the Delay Within the Team&apos;s Control?</h3>
      </div>
      {total === 0 ? (
        <p className="text-sm text-neutral-400 py-4 text-center">No overdue P1 tickets this period.</p>
      ) : (
        <>
          <div className="flex h-3 w-full rounded-full overflow-hidden bg-neutral-100">
            {SEGMENTS.map((s) => {
              const share = controllability[s.key].count / total;
              if (!share) return null;
              return <span key={s.key} style={{ width: `${share * 100}%`, backgroundColor: `rgb(var(${s.colorVar}))` }} />;
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {SEGMENTS.map((s) => {
              const seg = controllability[s.key];
              return (
                <div key={s.key} className="group relative">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `rgb(var(${s.colorVar}))` }} />
                    <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{s.label}</p>
                  </div>
                  <p className="text-lg font-semibold text-neutral-900 mt-0.5">
                    {formatNumber(seg.count)} <span className="text-xs font-normal text-neutral-400">({seg.share === null ? "—" : formatPercent(seg.share)})</span>
                  </p>
                  <p className="text-[11px] text-neutral-400 leading-snug mt-0.5">{s.description}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
