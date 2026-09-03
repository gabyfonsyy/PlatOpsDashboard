"use client";

import { ArrowRight } from "lucide-react";
import type { CycleTimePulse } from "@/lib/lead-cycle-time";
import type { LeadTimeInsight } from "@/lib/lead-cycle-time";
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
 * The SE-only centerpiece: Total / Doer / Validator as three connected values (not three
 * unrelated KPI cards), a stacked bar making the split visually obvious, and the dynamic
 * "Where is the time going?" read directly underneath. This is the page's core analytical claim
 * (brief section 4/5/12), so it gets the most visual weight — everything below it (trend,
 * breakdown, longest work) exists to explain WHY the split looks the way it does here.
 *
 * doerLabel/validatorLabel/totalLabel are passed in so Gaby's View can relabel them (see
 * lib/cycle-time-view.ts) without this component knowing anything about themes itself.
 */
export function CycleTimeDoerValidatorBar({
  pulse,
  insight,
  doerLabel,
  validatorLabel,
  totalLabel,
}: {
  pulse: CycleTimePulse;
  insight: LeadTimeInsight | null;
  doerLabel: string;
  validatorLabel: string;
  totalLabel: string;
}) {
  const { theme } = useTheme();
  const gaby = theme === "adhd";

  if (!pulse.doer || !pulse.validator || pulse.total.avgMinutes === null) {
    return <div className="card p-8 text-center text-sm text-neutral-400">No completed tickets for this period yet.</div>;
  }

  const doerAvg = pulse.doer.avgMinutes;
  const validatorAvg = pulse.validator.avgMinutes ?? 0;
  const totalAvg = pulse.total.avgMinutes;
  const doerPct = pulse.doerSharePct !== null ? Math.round(pulse.doerSharePct * 1000) / 10 : null;
  const validatorPct = pulse.validatorSharePct !== null ? Math.round(pulse.validatorSharePct * 1000) / 10 : null;

  return (
    <div className="card p-5">
      {/* Task Started -> Doer Executes -> Work Submitted -> Validator Reviews -> Task Completed */}
      <div className="flex items-center justify-center gap-2 text-xs text-neutral-400 mb-5 flex-wrap">
        <span>Task Started</span>
        <ArrowRight className="w-3 h-3" />
        <span className="font-medium text-neutral-600">Doer Executes</span>
        <ArrowRight className="w-3 h-3" />
        <span>Work Submitted</span>
        <ArrowRight className="w-3 h-3" />
        <span className="font-medium text-neutral-600">Validator Reviews</span>
        <ArrowRight className="w-3 h-3" />
        <span>Task Completed</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <div className="text-center sm:text-left">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{doerLabel}</p>
          <p className="text-2xl font-semibold text-neutral-900 mt-1">{fmtDays(doerAvg)}</p>
          <p className="text-xs text-neutral-400 mt-1">{formatDurationBreakdown(doerAvg)} avg{doerPct !== null ? ` · ${doerPct}%` : ""}</p>
        </div>
        <div className="flex items-center justify-center gap-3 text-neutral-300">
          <span className="text-lg font-light">+</span>
          <div className="text-center">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{validatorLabel}</p>
            <p className="text-2xl font-semibold text-neutral-900 mt-1">{fmtDays(validatorAvg)}</p>
            <p className="text-xs text-neutral-400 mt-1">{formatDurationBreakdown(validatorAvg)} avg{validatorPct !== null ? ` · ${validatorPct}%` : ""}</p>
          </div>
          <span className="text-lg font-light">=</span>
        </div>
        <div className="text-center sm:text-right">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{totalLabel}</p>
          <p className="text-2xl font-semibold text-sprout-700 mt-1">{fmtDays(totalAvg)}</p>
          <p className="text-xs text-neutral-400 mt-1">{formatDurationBreakdown(totalAvg)} avg · {pulse.count} tickets</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100">
          <div style={{ width: `${Math.max(2, doerPct ?? 0)}%` }} className="bg-[rgb(var(--a-500))]" title={`${doerLabel}: ${doerPct}%`} />
          <div style={{ width: `${Math.max(2, validatorPct ?? 0)}%` }} className="bg-[rgb(var(--n-300))]" title={`${validatorLabel}: ${validatorPct}%`} />
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-500 mt-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[rgb(var(--a-500))]" /> {doerLabel} — {doerPct ?? "—"}%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[rgb(var(--n-300))]" /> {validatorLabel} — {validatorPct ?? "—"}%
          </span>
        </div>
      </div>

      {insight && (
        <p className="text-sm text-neutral-700 mt-5 pt-4 border-t border-neutral-100">
          {renderBoldSegments(gaby ? insight.text.gaby : insight.text.professional)}
        </p>
      )}
    </div>
  );
}
