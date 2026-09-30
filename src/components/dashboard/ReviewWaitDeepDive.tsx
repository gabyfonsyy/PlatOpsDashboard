"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Target } from "lucide-react";
import type { ReviewWaitReport } from "@/lib/review-wait";
import { useTheme } from "@/components/theme/ThemeProvider";
import { reviewWaitCopy, fmtDays, fmtDur, fmtPct, persistReviewTargetCookie } from "@/lib/review-wait-view";
import { formatNumber } from "@/lib/format";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { ExcludedLabelsEditor } from "@/components/dashboard/ExcludedLabelsEditor";
import { ReviewWaitReviewerTable, ReviewWaitQueueCard, ReviewWaitLongestTable, ReviewWaitSegmentsPanel } from "@/components/dashboard/ReviewWaitTables";
import { ReviewWaitTrendChart } from "@/components/dashboard/ReviewWaitTrendChart";
import { cn } from "@/lib/utils";

/** Lower wait is the improvement — same convention as the Cycle Time deep-dive. */
function waitTrend(delta: { deltaPct: number | null } | undefined, lowerIsBetter = true) {
  if (!delta || delta.deltaPct === null || Math.abs(delta.deltaPct) < 0.005) return undefined;
  const pct = Math.round(delta.deltaPct * 1000) / 10;
  return {
    direction: (delta.deltaPct > 0 ? "up" : "down") as "up" | "down",
    label: `${delta.deltaPct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs previous period`,
    positive: lowerIsBetter ? delta.deltaPct < 0 : delta.deltaPct > 0,
  };
}

/** Percentage-point change for a rate, which reads better than a % of a %. */
function rateTrend(delta: { current: number | null; previous: number | null } | undefined) {
  if (!delta || delta.current === null || delta.previous === null) return undefined;
  const pts = Math.round((delta.current - delta.previous) * 1000) / 10;
  if (Math.abs(pts) < 0.5) return undefined;
  return { direction: (pts > 0 ? "up" : "down") as "up" | "down", label: `${pts > 0 ? "+" : ""}${pts} pts vs previous period`, positive: pts > 0 };
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The Review Wait Time deep-dive body, top to bottom in the brief's "Gaby view" hierarchy:
 * big picture -> where is the wait -> what's getting stuck -> why -> trend. Gaby's View changes
 * wording only (lib/review-wait-view.ts); every number is the same in both registers.
 */
export function ReviewWaitDeepDive({
  report,
  jiraBaseUrl,
  extraExcludedLabels,
}: {
  report: ReviewWaitReport;
  jiraBaseUrl?: string;
  extraExcludedLabels: string[];
}) {
  const { theme } = useTheme();
  const copy = reviewWaitCopy(theme);
  const p = report.pulse;
  const c = report.comparison;
  const t = report.target;
  const hasTarget = t.minutes !== null;
  const smallSample = p.count > 0 && p.count < 10;

  return (
    <div className="flex flex-col gap-8">
      {/* ============================================================ 1 · BIG PICTURE */}
      <Section title={copy.bigPicture}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label={`${copy.avgLabel} · avg`}
            value={`${fmtDays(p.avgMinutes)} days`}
            sublabel={p.avgMinutes === null ? undefined : `${fmtDur(p.avgMinutes)} average`}
            trend={waitTrend(c?.avgMinutes)}
            tooltip="Mean time a ticket sat in For Peer Review before moving to On Hold, For Checking, Archived or Rejected — per review cycle that started in the period. Pass-throughs under a minute aren't reviews and aren't counted. Calendar time, same basis as Cycle Time. A few very long reviews pull this up; read it next to the median."
          />
          <MetricCard
            label={copy.medianLabel}
            value={`${fmtDays(p.medianMinutes)} days`}
            sublabel={p.medianMinutes === null ? undefined : `${fmtDur(p.medianMinutes)} · P75 ${fmtDur(p.p75Minutes)}`}
            trend={waitTrend(c?.medianMinutes)}
            tooltip="The midpoint review — half finished faster, half slower. The fairest read of a typical wait. P75: 3 in 4 reviews finished by this."
          />
          <MetricCard
            label={copy.p90Label}
            value={p.p90Minutes === null ? "N/A" : `${fmtDays(p.p90Minutes)} days`}
            sublabel={p.p90Minutes === null ? `Needs 10+ reviews (have ${p.count})` : `${fmtDur(p.p90Minutes)} · the long tail`}
            trend={waitTrend(c?.p90Minutes)}
            tooltip="9 in 10 reviews finished by this. Shows how bad the slowest reviews get."
          />
          <MetricCard
            label={copy.withinTargetLabel}
            value={fmtPct(p.withinTargetPct)}
            sublabel={hasTarget ? `${formatNumber(p.withinTargetCount)} of ${formatNumber(p.count)} within ${fmtDur(t.minutes)}` : "No target set"}
            trend={rateTrend(c?.withinTargetPct)}
            tooltip="Share of finished reviews that took no longer than the target. The target defaults to the Q1+Q2 2026 average review wait; change it below."
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-neutral-500">
          <span>
            <span className="font-medium text-neutral-700">{formatNumber(p.count)}</span> finished review{p.count === 1 ? "" : "s"} across{" "}
            <span className="font-medium text-neutral-700">{formatNumber(p.ticketCount)}</span> ticket{p.ticketCount === 1 ? "" : "s"}
            {c && <> · previous period {formatNumber(c.count.previous)}</>}
            {smallSample && <span className="ml-2 text-amber-700">Small sample — treat percentiles as rough.</span>}
          </span>
          <TargetControl target={t} />
        </div>
      </Section>

      <InsightsPanel insights={report.insights} positiveHighlights={[]} title={copy.whatShouldIKnow} />

      {/* ============================================================ 2 · WHERE IS THE WAIT? */}
      <Section title={copy.whereIsTheWait}>
        <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4 items-start">
          <div className="2xl:col-span-3 min-w-0">
            <ReviewWaitReviewerTable rows={report.reviewers} hasTarget={hasTarget} copy={copy} />
          </div>
          <div className="2xl:col-span-2 min-w-0">
            <ReviewWaitQueueCard queue={report.queue} targetMinutes={t.minutes} withinTargetPct={p.withinTargetPct} copy={copy} jiraBaseUrl={jiraBaseUrl} />
          </div>
        </div>
      </Section>

      {/* ============================================================ 3 · WHAT'S GETTING STUCK? */}
      <Section title={copy.whatsStuck}>
        <ReviewWaitLongestTable
          rows={report.longest}
          outlier={report.outlier}
          targetMinutes={t.minutes}
          assigneeLabel={report.assigneeLabel}
          jiraBaseUrl={jiraBaseUrl}
          copy={copy}
        />
      </Section>

      {/* ============================================================ 4 · WHY? */}
      <Section title={copy.why}>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
          <div className="xl:col-span-3 min-w-0">
            <ReviewWaitSegmentsPanel segments={report.segments} hasTarget={hasTarget} overallMedian={p.medianMinutes} copy={copy} />
          </div>
          <div className="xl:col-span-2 min-w-0 flex flex-col gap-4">
            <PatternsCard patterns={report.patterns} title={copy.patterns} caveat={copy.patternsCaveat} />
          </div>
        </div>
        <EfficiencyRow report={report} title={copy.efficiency} />
      </Section>

      {/* ============================================================ 5 · TREND */}
      <ReviewWaitTrendChart
        trend={report.trend}
        grain={report.grain}
        title={copy.trend}
        waitTitle={copy.trendChart}
        queueTitle={copy.queueChart}
        targetMinutes={t.minutes}
      />

      <DataQualityPanel report={report} title={copy.dataQuality} jiraBaseUrl={jiraBaseUrl} />
      <ExcludedLabelsEditor labels={extraExcludedLabels} />
    </div>
  );
}

// ------------------------------------------------------------------------------ Target control

function TargetControl({ target }: { target: ReviewWaitReport["target"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(target.minutes !== null ? String(Math.round((target.minutes / 60) * 10) / 10) : "");

  const sourceText =
    target.source === "override"
      ? "custom target"
      : target.source === "baseline"
        ? `${target.baselinePeriodLabel} baseline (${formatNumber(target.baselineSampleCount)} reviews)`
        : target.source === "live-baseline"
          ? `${target.baselinePeriodLabel} average (${formatNumber(target.baselineSampleCount)} reviews, computed live)`
          : "no baseline data";

  const apply = (minutes: number | null) => {
    persistReviewTargetCookie(minutes);
    setEditing(false);
    router.refresh();
  };

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <Target className="w-3.5 h-3.5 text-sprout-600" />
      {!editing ? (
        <>
          <span>
            Target <span className="font-medium text-neutral-700">{target.minutes === null ? "—" : `${fmtDays(target.minutes)}d (${fmtDur(target.minutes)})`}</span> · {sourceText}
            {target.source === "override" && target.baselineMinutes !== null && <> · baseline {fmtDur(target.baselineMinutes)}</>}
          </span>
          <button onClick={() => setEditing(true)} className="text-neutral-500 hover:text-sprout-700 underline-offset-2 hover:underline transition-colors">
            Change
          </button>
          {target.source === "override" && (
            <button onClick={() => apply(null)} className="text-neutral-500 hover:text-sprout-700 underline-offset-2 hover:underline transition-colors">
              Reset to baseline
            </button>
          )}
        </>
      ) : (
        <form
          className="inline-flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const h = Number(hours);
            if (Number.isFinite(h) && h > 0) apply(h * 60);
          }}
        >
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-20 rounded-md border border-neutral-200 bg-surface px-2 py-1 text-xs text-neutral-900"
            autoFocus
          />
          <span>hours</span>
          <button type="submit" className="rounded-md bg-sprout-600 text-white px-2 py-1 hover:bg-sprout-700 transition-colors">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-neutral-500 hover:text-neutral-800">Cancel</button>
        </form>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------ Patterns

function PatternsCard({ patterns, title, caveat }: { patterns: ReviewWaitReport["patterns"]; title: string; caveat: string }) {
  const { theme } = useTheme();
  const gaby = theme === "adhd";
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="text-xs text-neutral-500 mt-1 mb-3">{caveat}</p>
      {patterns.length === 0 ? (
        <p className="text-sm text-neutral-400">Nothing stands out — no segment with enough reviews runs well above the team&apos;s typical wait.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {patterns.map((pt, i) => {
            const text = gaby ? pt.text.gaby : pt.text.professional;
            const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
            return (
              <li key={i} className="flex gap-2 text-sm text-neutral-700">
                <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", pt.tone === "positive" ? "bg-emerald-500" : pt.tone === "negative" ? "bg-red-500" : "bg-sprout-400")} />
                <span>
                  {parts.map((s, j) =>
                    s.startsWith("**") && s.endsWith("**") ? <strong key={j} className="font-semibold text-neutral-900">{s.slice(2, -2)}</strong> : <span key={j}>{s}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ Efficiency

function EffTile({ label, value, sub, tooltip }: { label: string; value: string; sub?: string; tooltip: string }) {
  return (
    <div className="rounded-2xl bg-neutral-50 px-4 py-3 transition-transform hover:-translate-y-0.5" title={tooltip}>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-xl font-semibold text-neutral-900 tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function EfficiencyRow({ report, title }: { report: ReviewWaitReport; title: string }) {
  const e = report.efficiency;
  const share = e.reviewShareOfCycleTime;
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <EffTile
          label="Review completion"
          value={fmtPct(e.completion.rate)}
          sub={`${e.completion.numerator} of ${e.completion.denominator} reviews started`}
          tooltip="Of the review cycles that STARTED in the period, the share that had left review by the period's end (any exit)."
        />
        <EffTile
          label="First-pass review"
          value={fmtPct(e.firstPass.rate)}
          sub={`${e.firstPass.numerator} of ${e.firstPass.denominator} reached For Checking`}
          tooltip="Of tickets reviewed this period that have reached For Checking, the share whose FIRST review went straight to For Checking."
        />
        <EffTile
          label="Review rework"
          value={fmtPct(e.rework.rate)}
          sub={`${e.rework.numerator} of ${e.rework.denominator} tickets`}
          tooltip="Of tickets reviewed this period, the share that has been through review more than once (whole ticket history)."
        />
        <EffTile
          label="Cycles to For Checking"
          value={e.avgCyclesToForChecking === null ? "—" : e.avgCyclesToForChecking.toFixed(2)}
          sub="avg review cycles per ticket"
          tooltip="Average number of times a ticket entered For Peer Review up to and including the review that sent it to For Checking."
        />
        <EffTile
          label="Total review / ticket"
          value={e.totalReviewPerTicket.avgMinutes === null ? "—" : `${fmtDays(e.totalReviewPerTicket.avgMinutes)}d`}
          sub={`1 cycle ${fmtDur(e.singleCycle.avgTotalMinutes)} (${e.singleCycle.tickets}) · 2+ ${fmtDur(e.multiCycle.avgTotalMinutes)} (${e.multiCycle.tickets})`}
          tooltip="Sum of every finished review on a ticket, across its whole history. Split by tickets reviewed once vs more than once — two 2h reviews and one 4h review are different stories."
        />
        <EffTile
          label="Share of Cycle Time"
          value={fmtPct(share.share)}
          sub={share.tickets ? `review ${fmtDur(share.avgReviewMinutes)} vs execution ${fmtDur(share.avgExecutionMinutes)} avg` : "no execution spans yet"}
          tooltip="Total review time ÷ (execution span + total review time), over tickets reviewed this period that have an execution span — how much of SE Cycle Time is peer review."
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Data quality

function DataQualityPanel({ report, title, jiraBaseUrl }: { report: ReviewWaitReport; title: string; jiraBaseUrl?: string }) {
  const [open, setOpen] = useState(false);
  const dq = report.dataQuality;
  const total = dq.otherExitCount + dq.invalidCount + dq.missingReviewerCount + dq.staleOpenCount + dq.skippedCount;

  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2">
          <AlertTriangle className={cn("w-4 h-4", total ? "text-amber-600" : "text-neutral-300")} />
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          <span className="text-xs text-neutral-500">
            {total === 0
              ? "Every review cycle in this period is clean."
              : [
                  dq.otherExitCount && `${dq.otherExitCount} other exit${dq.otherExitCount === 1 ? "" : "s"}`,
                  dq.missingReviewerCount && `${dq.missingReviewerCount} missing reviewer`,
                  dq.invalidCount && `${dq.invalidCount} invalid`,
                  dq.staleOpenCount && `${dq.staleOpenCount} stale open`,
                  dq.skippedCount && `${dq.skippedCount} skipped review${dq.skippedCount === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-3 text-sm animate-dropdown-in">
          <ul className="text-xs text-neutral-600 flex flex-col gap-1">
            <li>
              <span className="font-medium text-neutral-800">Other exits</span> — left review to a status outside On Hold / For Checking / Archived / Rejected
              {dq.otherExits.length > 0 && <> ({dq.otherExits.map((o) => `${o.status} ${o.count}`).join(", ")})</>}. Real transitions, not counted in Review Wait Time.
            </li>
            <li><span className="font-medium text-neutral-800">Missing reviewer</span> — counted in team totals as &quot;(unassigned)&quot;; <code>runStPeerReviewRebackfill</code> fills these in.</li>
            <li><span className="font-medium text-neutral-800">Invalid</span> — missing or backwards timestamps; excluded.</li>
            <li>
              <span className="font-medium text-neutral-800">Skipped review</span> — passed through For Peer Review in under a minute ({dq.skippedCount} this period), so
              nobody actually reviewed it. Not counted anywhere on this page — not as a review, a reviewer&apos;s workload, or a review cycle.
              {dq.skippedBy.length > 0 && <> Held by: {dq.skippedBy.map((b) => `${b.name} ${b.count}`).join(", ")}.</>}
            </li>
            <li><span className="font-medium text-neutral-800">Stale open</span> — a review with no exit on a ticket that has since moved on (a missed sync); left out of the queue.</li>
          </ul>
          {dq.samples.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-neutral-500 bg-neutral-50 border-b border-neutral-200">
                    <th className="px-3 py-2">Ticket</th>
                    <th className="px-3 py-2">Issue</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {dq.samples.map((s, i) => (
                    <tr key={`${s.issueKey}-${i}`}>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">
                        {jiraBaseUrl ? (
                          <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${s.issueKey}`} target="_blank" rel="noreferrer" className="hover:text-sprout-700">{s.issueKey}</a>
                        ) : (
                          s.issueKey
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.reason}</td>
                      <td className="px-3 py-2 text-neutral-500">{s.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
