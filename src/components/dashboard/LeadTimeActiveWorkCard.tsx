"use client";

import type { LeadTimePulse, LeadTimeActiveWorkContext, LeadTimeInsight } from "@/lib/lead-cycle-time";
import { formatDaysValue, formatDurationBreakdown } from "@/lib/format";
import { useTheme } from "@/components/theme/ThemeProvider";

/** Same "**bold** headline" convention as InsightsPanel's renderBoldSegments — duplicated locally
 * rather than imported since it isn't exported from that module (kept small on purpose). */
function renderBoldSegments(text: string) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  if (segments.length === 1) return text;
  return segments.map((segment, i) =>
    segment.startsWith("**") && segment.endsWith("**") ? (
      <strong key={i} className="font-semibold text-neutral-900">
        {segment.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{segment}</span>
    )
  );
}

function fmtDays(minutes: number | null): string {
  return minutes === null ? "—" : `${formatDaysValue(minutes)}d`;
}

/**
 * "Lead Time vs. Active Work" — the brief's central Lead Time claim (sections 5/6/12): show the
 * REAL Cycle Time for this scope as context next to Lead Time, so the reader can see "this ticket
 * took 2.4 days to complete, but only 7.2 hours were actually spent working on it" at a glance,
 * WITHOUT re-deriving a second Doer/Validator breakdown here (that stays on the Cycle Time page —
 * see LeadTimeActiveWorkContext's doc comment in lib/lead-cycle-time.ts).
 *
 * Renders nothing when activeWork is unavailable (a lookup failure) rather than a broken card —
 * the rest of the Lead Time page still works without this contextual comparison.
 */
export function LeadTimeActiveWorkCard({
  pulse,
  activeWork,
  insight,
  title,
  leadTimeLabel,
  activeWorkLabel,
  waitingLabel,
}: {
  pulse: LeadTimePulse;
  activeWork: LeadTimeActiveWorkContext | null;
  insight: LeadTimeInsight | null;
  title: string;
  leadTimeLabel: string;
  activeWorkLabel: string;
  waitingLabel: string;
}) {
  const { theme } = useTheme();
  const gaby = theme === "adhd";

  if (!activeWork || activeWork.cycleAvgMinutes === null || pulse.avgMinutes === null) return null;

  const activePct = activeWork.activeSharePct !== null ? Math.round(activeWork.activeSharePct * 1000) / 10 : null;
  const otherPct = activePct !== null ? Math.round((100 - activePct) * 10) / 10 : null;

  return (
    <div className="card p-5">
      <p className="text-sm font-medium text-neutral-700 mb-1">{title}</p>
      <p className="text-xs text-neutral-400 mb-4">
        {activeWorkLabel} is the real Cycle Time for this scope, shown for context — not a second execution/review breakdown. Go to the Cycle
        Time deep-dive for that.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <div className="text-center sm:text-left">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{leadTimeLabel}</p>
          <p className="text-2xl font-semibold text-neutral-900 mt-1">{fmtDays(pulse.avgMinutes)}</p>
          <p className="text-xs text-neutral-400 mt-1">{formatDurationBreakdown(pulse.avgMinutes)} avg</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{activeWorkLabel}</p>
          <p className="text-2xl font-semibold text-sprout-700 mt-1">{fmtDays(activeWork.cycleAvgMinutes)}</p>
          <p className="text-xs text-neutral-400 mt-1">
            {formatDurationBreakdown(activeWork.cycleAvgMinutes)} avg
            {activeWork.workflowModel === "doer-validator" && activeWork.doerAvgMinutes !== null && (
              <>
                {" "}
                <span className="text-neutral-300">·</span> {fmtDays(activeWork.doerAvgMinutes)} doer
                {activeWork.validatorAvgMinutes !== null && <> / {fmtDays(activeWork.validatorAvgMinutes)} validator</>}
              </>
            )}
          </p>
        </div>
        <div className="text-center sm:text-right">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{waitingLabel} / Other</p>
          <p className="text-2xl font-semibold text-neutral-900 mt-1">
            {pulse.avgMinutes !== null && activeWork.cycleAvgMinutes !== null
              ? fmtDays(Math.max(0, pulse.avgMinutes - activeWork.cycleAvgMinutes))
              : "—"}
          </p>
          <p className="text-xs text-neutral-400 mt-1">outside active execution</p>
        </div>
      </div>

      {activePct !== null && (
        <div className="mt-5">
          <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100">
            <div style={{ width: `${Math.max(2, activePct)}%` }} className="bg-[rgb(var(--a-500))]" title={`${activeWorkLabel}: ${activePct}%`} />
            <div style={{ width: `${Math.max(2, otherPct ?? 0)}%` }} className="bg-[rgb(var(--n-300))]" title={`${waitingLabel} / Other: ${otherPct}%`} />
          </div>
          <div className="flex items-center justify-between text-xs text-neutral-500 mt-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[rgb(var(--a-500))]" /> {activeWorkLabel} — {activePct}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[rgb(var(--n-300))]" /> {waitingLabel} / Other — {otherPct}%
            </span>
          </div>
        </div>
      )}

      {insight && (
        <p className="text-sm text-neutral-700 mt-5 pt-4 border-t border-neutral-100">
          {renderBoldSegments(gaby ? insight.text.gaby : insight.text.professional)}
        </p>
      )}
    </div>
  );
}
