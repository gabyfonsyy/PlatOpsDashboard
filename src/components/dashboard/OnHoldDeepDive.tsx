"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Clock, X } from "lucide-react";
import { ComposedChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { OnHoldReport, EpisodeView, QueueTicket, ReasonRow, HoldSegmentRow, TimeSplit } from "@/lib/on-hold";
import type { FcrSegmentDimension } from "@/lib/fcr";
import { useTheme } from "@/components/theme/ThemeProvider";
import { onHoldCopy, fmtHold, holdText, persistOnHoldThresholdCookie } from "@/lib/on-hold-view";
import { SEGMENT_LABELS } from "@/lib/fcr-view";
import { formatManilaDate, formatNumber, formatPercent } from "@/lib/format";
import { vsPreviousTrend } from "@/lib/period-trend";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { GrainToggle } from "@/components/dashboard/ReviewWaitTrendChart";
import { Section, useHref, JiraLink, DimTabs, Tile, formatBucketLabel, tooltipStyle } from "@/components/dashboard/FcrDeepDive";
import { cn } from "@/lib/utils";

const pct = (n: number | null | undefined, d = 1) => formatPercent(n ?? null, d);
const segLabel = (dim: FcrSegmentDimension, key: string) => (dim === "dow" ? key.replace(/^\d+ · /, "") : key);
const days = (m: number | null | undefined) => (m === null || m === undefined ? null : Math.round((m / 1440) * 100) / 100);

/** Muted, theme-aware series colours for the per-reason trend lines. */
const SERIES = ["rgb(var(--a-600))", "rgb(var(--a-400))", "rgb(var(--n-500))", "rgb(var(--a-800))", "rgb(var(--n-400))", "rgb(var(--a-300))"];

function ReasonChip({ name, sePause }: { name: string; sePause?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className={cn(name === "Not specified" ? "text-amber-700" : "text-neutral-900")}>{name}</span>
      {sePause && <span className="text-[10px] uppercase tracking-wide bg-neutral-100 text-neutral-500 rounded px-1 py-0.5" title="An SE pausing their own work. Still counted as waiting.">SE-side pause</span>}
    </span>
  );
}

function SmallTag() {
  return <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 rounded px-1 py-0.5">small</span>;
}

/**
 * On-Hold Wait Time deep-dive, in the brief's Gaby hierarchy: How much time are we waiting? →
 * What's keeping us waiting? → Who's been waiting the longest? → Where do tickets go after the
 * wait? → How much of our cycle is waiting? → Is it changing? → episodes → data quality. Gaby's
 * View changes wording only (lib/on-hold-view.ts).
 */
export function OnHoldDeepDive({ report, jiraBaseUrl, teamSlug, query }: { report: OnHoldReport; jiraBaseUrl?: string; teamSlug: string; query: string }) {
  const { theme } = useTheme();
  const copy = onHoldCopy(theme);
  const c = report.current;
  const p = report.previous;
  const head = fmtHold(c.wait.avgMinutes);
  const e = report.efficiency;
  const href = useHref();

  return (
    <div className="flex flex-col gap-8">
      {report.coverage.legacyTickets > 0 && <CoverageBanner report={report} />}

      {/* ============================================================ 1 · HOW MUCH */}
      <Section title={copy.howMuch} right={<ThresholdControl threshold={report.threshold} />}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            label={copy.waitLabel}
            value={head.primary}
            sublabel={
              c.legacyMode
                ? `per held ticket · hold history not synced yet`
                : `${head.secondary ?? ""} average · median ${holdText(c.wait.medianMinutes)} · P75 ${holdText(c.wait.p75Minutes)} · P90 ${holdText(c.wait.p90Minutes)}`
            }
            trend={vsPreviousTrend(c.wait.avgMinutes, p?.wait.avgMinutes, { better: "lower", mode: "abs", formatAbs: holdText })}
            baseline={
              p && p.wait.avgMinutes !== null
                ? {
                    label: `Previous ${holdText(p.wait.avgMinutes)} (${formatNumber(p.wait.episodes)} ${p.legacyMode ? "tickets" : "holds"})${
                      c.wait.avgMinutes !== null && p.wait.avgMinutes ? ` · ${c.wait.avgMinutes >= p.wait.avgMinutes ? "+" : "−"}${Math.abs(Math.round(((c.wait.avgMinutes - p.wait.avgMinutes) / p.wait.avgMinutes) * 100))}%` : ""
                    }${report.threshold.baseline.avgMinutes !== null ? ` · Baseline (${report.threshold.baseline.periodLabel}) ${holdText(report.threshold.baseline.avgMinutes)}` : ""}`,
                  }
                : undefined
            }
            badge={report.smallSample ? { label: "Small sample", tone: "warning" } : undefined}
            tooltip="Average time per completed hold: from entering On Hold to moving to In Progress, For Checking, For Peer Review, For Product Team, Archived or Rejected. Each hold is measured separately. Tickets resolved in the period, calendar time. Holds still open are not included (see the current queue). The change is shown as absolute time."
          />
          <MetricCard
            label={copy.heldLabel}
            value={formatNumber(c.heldTickets)}
            sublabel={`${pct(c.heldShare)} of ${formatNumber(c.resolved)} resolved${c.legacyMode ? "" : ` · ${formatNumber(c.wait.episodes)} holds`}${c.avgEpisodesPerTicket !== null ? ` · ${c.avgEpisodesPerTicket.toFixed(2)} per ticket` : ""}`}
            trend={vsPreviousTrend(c.heldShare, p?.heldShare, { better: "lower", mode: "pts" })}
            baseline={p ? { label: `Previous ${formatNumber(p.heldTickets)} tickets · ${pct(p.heldShare)}` } : undefined}
            tooltip="Resolved tickets that went On Hold at least once. The change line compares the share of resolved tickets, in percentage points."
          />
          <MetricCard
            label={copy.currentLabel}
            value={formatNumber(report.queue.count)}
            sublabel={`${report.queue.overThreshold} over threshold · oldest ${holdText(report.queue.oldest?.ageMinutes)}`}
            badge={report.queue.overThreshold > 0 ? { label: `${report.queue.overThreshold} need attention`, tone: "warning" } : undefined}
            tooltip="Tickets in On Hold right now, whatever period is selected. Their hold age is not part of the averages."
          />
          <MetricCard
            label={copy.totalLabel}
            value={fmtHold(c.totalMinutes).primary}
            sublabel={`across ${formatNumber(c.heldTickets)} tickets · ${holdText(c.perTicketAvgMinutes)} per held ticket`}
            trend={vsPreviousTrend(c.totalMinutes, p?.totalMinutes, { better: "lower", mode: "abs", formatAbs: holdText })}
            tooltip="All completed hold time on tickets resolved in the period, summed across every hold."
          />
          <MetricCard
            label={copy.cycleShareLabel}
            value={pct(report.cycleImpact.shareOfCycle)}
            sublabel={`${holdText(report.cycleImpact.holdInCycleAvgMinutes)} of ${holdText(report.cycleImpact.cycleAvgMinutes)} · ${pct(report.cycleImpact.shareOfLead)} of Lead Time`}
            tooltip="For held tickets: hold time inside the Cycle Time window (out of To Do → reached review) ÷ Cycle Time, pooled across tickets. Lead Time (created → resolved) includes every hold. This shows how time is split, not what caused it."
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Tile label="Hold resolution rate" value={pct(e.resolutionRate)} sub="holds that ended in a counted status" />
          <Tile label="Holds per held ticket" value={c.avgEpisodesPerTicket === null ? "—" : c.avgEpisodesPerTicket.toFixed(2)} sub={`max ${e.maxEpisodes}`} />
          <Tile label="Repeat hold rate" value={pct(e.repeatHoldRate)} sub={`${formatNumber(e.repeatTickets)} tickets on hold 2+ times`} />
          <Tile label="Long-hold rate" value={pct(e.longHoldRate)} sub={`${formatNumber(e.longHolds)} holds over threshold`} href={href({ long: "1" })} />
          <Tile label="Current stale rate" value={pct(e.currentStaleRate)} sub={`${report.queue.overThreshold} of ${report.queue.count} waiting now`} />
        </div>
      </Section>

      <InsightsPanel insights={report.insights} positiveHighlights={[]} title={copy.whatShouldIKnow} />

      {/* ============================================================ 2 · WHY WAITING */}
      <Section title={copy.whyWaiting} subtitle={copy.whyWaitingCaveat}>
        <ReasonLeaders report={report} title={copy.leaders} jiraBaseUrl={jiraBaseUrl} />
        <ReasonTable report={report} />
      </Section>

      {/* ============================================================ 3 · HOW BAD */}
      <Section title={copy.howBad} subtitle={copy.howBadCaveat}>
        <QueuePanel report={report} title={copy.queue} staleTitle={copy.stale} jiraBaseUrl={jiraBaseUrl} />
        <LongestTable rows={report.longest} title={copy.longest} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
      </Section>

      {/* ============================================================ 4 · WHERE NEXT */}
      <Section title={copy.whereNext} subtitle={copy.whereNextCaveat}>
        <ExitTable report={report} />
        <MatrixPanel report={report} title={copy.matrix} />
      </Section>

      {/* ============================================================ 5 · CYCLE */}
      <Section title={copy.cycle} subtitle={copy.cycleCaveat}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <CycleImpactCard report={report} />
          <TimeSplitCard report={report} title={copy.timeSplit} teamSlug={teamSlug} query={query} />
        </div>
      </Section>

      {/* ============================================================ 6 · WHO / WHAT */}
      <Section title={copy.whoHolds} subtitle={copy.whoHoldsCaveat}>
        <SegmentTable report={report} />
        <RepeatCard report={report} title={copy.repeat} />
      </Section>

      {/* ============================================================ 7 · IS IT CHANGING */}
      <Section title={copy.isItChanging} right={<GrainToggle active={report.grain} />}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <WaitTrend report={report} />
          <ReasonTrend report={report} title={copy.reasonTrend} />
        </div>
      </Section>

      <EpisodesTable report={report} title={copy.tickets} jiraBaseUrl={jiraBaseUrl} />
      <DataQualityPanel report={report} title={copy.dataQuality} jiraBaseUrl={jiraBaseUrl} />
    </div>
  );
}

// ------------------------------------------------------------------------------ Coverage + threshold

function CoverageBanner({ report }: { report: OnHoldReport }) {
  const cv = report.coverage;
  return (
    <div className="rounded-2xl bg-amber-50 text-amber-800 px-4 py-3 text-sm flex gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>
        <strong>{formatNumber(cv.legacyTickets)}</strong> of {formatNumber(cv.heldTickets)} held tickets don&apos;t have per-hold history synced yet. They
        count as held, but their time isn&apos;t in the hold durations, reasons, exits or trends.
        {report.current.legacyMode && " Until the history sync runs, the headline shows total hold time per ticket instead of per hold."} The history
        fills in once the GAS on-hold rebackfill has run.
      </p>
    </div>
  );
}

function ThresholdControl({ threshold }: { threshold: OnHoldReport["threshold"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(threshold.minutes !== null ? String(Math.round((threshold.minutes / 1440) * 100) / 100) : "");
  const b = threshold.baseline;
  const sourceText =
    threshold.source === "override"
      ? "custom threshold"
      : threshold.source === "baseline"
        ? `${b.periodLabel} P75 (${formatNumber(b.sampleCount)} holds)`
        : threshold.source === "live-baseline"
          ? `${b.periodLabel} P75 (${formatNumber(b.sampleCount)} holds, computed live)`
          : "no baseline data";
  const apply = (minutes: number | null) => {
    persistOnHoldThresholdCookie(minutes);
    setEditing(false);
    router.refresh();
  };
  return (
    <span className="inline-flex items-center gap-2 flex-wrap text-xs text-neutral-500">
      <Clock className="w-3.5 h-3.5 text-violet-500" />
      {!editing ? (
        <>
          <span>
            Stale after <span className="font-medium text-neutral-700">{threshold.minutes === null ? "—" : holdText(threshold.minutes)}</span> · {sourceText}
            {threshold.source === "override" && b.p75Minutes !== null && <> · baseline P75 {holdText(b.p75Minutes)}</>}
          </span>
          <button onClick={() => setEditing(true)} className="hover:text-sprout-700 underline-offset-2 hover:underline transition-colors">Change</button>
          {threshold.source === "override" && (
            <button onClick={() => apply(null)} className="hover:text-sprout-700 underline-offset-2 hover:underline transition-colors">Reset to baseline</button>
          )}
        </>
      ) : (
        <form
          className="inline-flex items-center gap-1.5"
          onSubmit={(ev) => {
            ev.preventDefault();
            const d = Number(value);
            if (Number.isFinite(d) && d > 0) apply(d * 1440);
          }}
        >
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            className="w-20 rounded-md border border-neutral-200 bg-surface px-2 py-1 text-xs text-neutral-900"
            autoFocus
          />
          <span>days</span>
          <button type="submit" className="rounded-md bg-sprout-600 text-white px-2 py-1 hover:bg-sprout-700 transition-colors">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="hover:text-neutral-800">Cancel</button>
        </form>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------ What's keeping us waiting

function ReasonLeaders({ report, title, jiraBaseUrl }: { report: OnHoldReport; title: string; jiraBaseUrl?: string }) {
  const l = report.leaders;
  const href = useHref();
  if (!l.byTime) return <div className="card p-6 text-sm text-neutral-400 text-center">No completed holds in this period.</div>;
  const card = (label: string, r: ReasonRow | null, value: string, sub: string) => (
    <Link
      href={r ? href({ reason: r.key, exit: null, seg: null, long: null }) : "#"}
      className="rounded-2xl bg-neutral-50 hover:bg-neutral-100 px-4 py-3 transition-all hover:-translate-y-0.5 block"
      title={r ? `Show ${r.key} holds` : undefined}
    >
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-sm font-semibold mt-1">{r ? <ReasonChip name={r.key} sePause={r.sePause} /> : "—"}</p>
      <p className="text-xl font-semibold text-neutral-900 tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] text-neutral-500">{sub}</p>
    </Link>
  );
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {card("Most often", l.byVolume, `${formatNumber(l.byVolume?.stats.episodes)} holds`, `${pct(l.byVolume?.shareOfEpisodes, 0)} of holds · ${pct(l.byVolume?.shareOfTime, 0)} of time`)}
        {card("Most total time", l.byTime, fmtHold(l.byTime.stats.totalMinutes).primary, `${pct(l.byTime.shareOfTime, 0)} of time · from ${pct(l.byTime.shareOfEpisodes, 0)} of holds`)}
        {card("Longest average", l.byAvg, holdText(l.byAvg?.stats.avgMinutes), l.byAvg ? `per hold · ${formatNumber(l.byAvg.stats.episodes)} holds (5+ only)` : "needs 5+ holds")}
        <div className="rounded-2xl bg-neutral-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Longest single hold</p>
          {l.longest ? (
            <>
              <p className="text-sm font-semibold mt-1"><ReasonChip name={l.longest.reason} sePause={l.longest.sePause} /></p>
              <p className="text-xl font-semibold text-neutral-900 tabular-nums mt-0.5">{holdText(l.longest.minutes)}</p>
              <p className="text-[11px] text-neutral-500"><JiraLink issueKey={l.longest.issueKey} jiraBaseUrl={jiraBaseUrl} /> · → {l.longest.exitStatus}</p>
            </>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Two thin bars per reason: how often (share of holds) vs how much time (share of hold time). */
function FreqImpact({ freq, impact }: { freq: number; impact: number }) {
  return (
    <span className="flex flex-col gap-1 min-w-[140px]">
      <span className="flex items-center gap-2">
        <span className="w-10 text-right tabular-nums text-[11px] text-neutral-500">{pct(freq, 0)}</span>
        <span className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden"><span className="block h-full bg-neutral-400" style={{ width: `${freq * 100}%` }} /></span>
      </span>
      <span className="flex items-center gap-2">
        <span className="w-10 text-right tabular-nums text-[11px] font-medium text-violet-700">{pct(impact, 0)}</span>
        <span className="flex-1 h-1.5 rounded-full bg-violet-100 overflow-hidden"><span className="block h-full bg-violet-500" style={{ width: `${impact * 100}%` }} /></span>
      </span>
    </span>
  );
}

function ReasonTable({ report }: { report: OnHoldReport }) {
  const href = useHref();
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-neutral-500">
          <span className="inline-block w-2 h-2 rounded-full bg-neutral-400 mr-1" /> share of holds (frequency)
          <span className="inline-block w-2 h-2 rounded-full bg-violet-500 ml-3 mr-1" /> share of hold time (impact)
        </p>
        <p className="text-[11px] text-neutral-400">A ticket held twice for the same reason counts once under Tickets and twice under Holds.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">Holding Reason</th>
            <th className="px-4 py-2.5 text-right">Tickets</th>
            <th className="px-4 py-2.5 text-right">Holds</th>
            <th className="px-4 py-2.5">Frequency vs impact</th>
            <th className="px-4 py-2.5">Avg Wait</th>
            <th className="px-4 py-2.5">Median</th>
            <th className="px-4 py-2.5" title="Shown with 10+ holds">P90</th>
            <th className="px-4 py-2.5">Total Hold Time</th>
            <th className="px-4 py-2.5 text-right" title="Tickets with this reason ÷ held tickets">% of held</th>
            <th className="px-4 py-2.5 text-right" title="Tickets with this reason ÷ resolved tickets">% of resolved</th>
            <th className="px-4 py-2.5 text-right">Previous</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {report.reasons.length === 0 ? (
            <tr><td colSpan={11} className="px-4 py-6 text-center text-neutral-400">No completed holds in this period.</td></tr>
          ) : (
            report.reasons.map((r) => (
              <tr key={r.key} className={cn("hover:bg-neutral-50/70 transition-colors", r.stats.episodes < 10 && "text-neutral-500")}>
                <td className="px-4 py-2.5">
                  <Link href={href({ reason: r.key, exit: null, seg: null, long: null })} className="hover:underline" title="Show these holds below">
                    <ReasonChip name={r.key} sePause={r.sePause} />
                  </Link>
                  {r.stats.episodes < 10 && <SmallTag />}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.tickets)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.stats.episodes)}</td>
                <td className="px-4 py-2.5"><FreqImpact freq={r.shareOfEpisodes} impact={r.shareOfTime} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={r.stats.avgMinutes} strong /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={r.stats.medianMinutes} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={r.stats.p90Minutes} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={r.stats.totalMinutes} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(r.shareOfHeldTickets)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{pct(r.shareOfResolved)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                  {r.previous && r.previous.episodes > 0 ? `${r.previous.episodes} · ${holdText(r.previous.avgMinutes)}` : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Who's been waiting

const SLA_TEXT: Record<QueueTicket["sla"], { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "text-red-600" },
  dueSoon: { label: "Due ≤ 2 days", cls: "text-amber-700" },
  onTrack: { label: "On track", cls: "text-emerald-700" },
  noDue: { label: "No due date", cls: "text-neutral-400" },
};

function QueuePanel({ report, title, staleTitle, jiraBaseUrl }: { report: OnHoldReport; title: string; staleTitle: string; jiraBaseUrl?: string }) {
  const [showAll, setShowAll] = useState(false);
  const q = report.queue;
  const rows = showAll ? q.tickets : q.tickets.filter((t) => t.stale);
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-[11px] text-neutral-400">As of {formatManilaDate(q.asOf)} · not limited to the selected period</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Tile label="Waiting" value={formatNumber(q.count)} sub="tickets On Hold now" />
          <Tile label="Average age" value={holdText(q.avgAgeMinutes)} sub={q.unknownAge ? `${q.unknownAge} with no entry time yet` : "since entering On Hold"} />
          <Tile label="Median age" value={holdText(q.medianAgeMinutes)} />
          <Tile label="Oldest" value={holdText(q.oldest?.ageMinutes)} sub={q.oldest ? q.oldest.issueKey : undefined} />
          <Tile label="Over threshold" value={formatNumber(q.overThreshold)} sub={`${pct(q.overThresholdShare, 0)} of the queue`} />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium text-neutral-800">
            {staleTitle}: {q.overThreshold === 0 ? "nothing is over the threshold." : `${q.overThreshold} ticket${q.overThreshold === 1 ? " has" : "s have"} been On Hold longer than ${holdText(report.threshold.minutes)}.`}
          </p>
          <label className="inline-flex items-center gap-2 text-xs text-neutral-600 cursor-pointer select-none">
            <input type="checkbox" checked={showAll} onChange={(ev) => setShowAll(ev.target.checked)} className="accent-sprout-600" />
            Show the whole queue
          </label>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-400">{showAll ? "Nothing is On Hold right now." : "No stale holds. Tick the box to see the whole queue."}</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wide">
              <th className="px-3 py-2.5">Ticket</th>
              <th className="px-3 py-2.5">{report.assigneeLabel}</th>
              <th className="px-3 py-2.5">Holding Reason</th>
              <th className="px-3 py-2.5">Hold age</th>
              <th className="px-3 py-2.5">On Hold since</th>
              <th className="px-3 py-2.5" title="Last time the ticket was updated in Jira">Last activity</th>
              <th className="px-3 py-2.5">Priority</th>
              <th className="px-3 py-2.5">Reporter</th>
              <th className="px-3 py-2.5">SLA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((t) => (
              <tr key={t.issueKey} className={cn("hover:bg-neutral-50/70 transition-colors", t.stale && "bg-amber-50/40")}>
                <td className="px-3 py-2 whitespace-nowrap font-medium align-top">
                  <JiraLink issueKey={t.issueKey} jiraBaseUrl={jiraBaseUrl} />
                  <span className="block text-neutral-400 font-normal">{t.issueType} · {t.product}{t.episodes > 1 ? ` · hold #${t.episodes}` : ""}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap align-top">{t.assignedSe || <span className="text-amber-700">(none)</span>}</td>
                <td className="px-3 py-2 align-top"><ReasonChip name={t.reason} sePause={t.sePause} /></td>
                <td className="px-3 py-2 whitespace-nowrap align-top">{t.ageMinutes === null ? <span className="text-neutral-400" title="Hold history not synced yet">—</span> : <DurationCell minutes={t.ageMinutes} strong={t.stale} />}</td>
                <td className="px-3 py-2 whitespace-nowrap align-top">{t.enteredAt ? formatManilaDate(t.enteredAt) : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap align-top">{t.lastActivityAt ? formatManilaDate(t.lastActivityAt) : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap align-top">{t.priority || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap align-top">{t.reporter || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap align-top">
                  <span className={SLA_TEXT[t.sla].cls}>{SLA_TEXT[t.sla].label}</span>
                  {t.dueDate && <span className="block text-neutral-400">due {t.dueDate}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EpisodeRows({ rows, jiraBaseUrl, assigneeLabel }: { rows: EpisodeView[]; jiraBaseUrl?: string; assigneeLabel: string }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-neutral-50 border-b border-neutral-200">
        <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wide">
          <th className="px-3 py-2.5">Ticket</th>
          <th className="px-3 py-2.5">{assigneeLabel}</th>
          <th className="px-3 py-2.5">Reporter</th>
          <th className="px-3 py-2.5">Priority</th>
          <th className="px-3 py-2.5">Holding Reason</th>
          <th className="px-3 py-2.5">Entered</th>
          <th className="px-3 py-2.5">Exited</th>
          <th className="px-3 py-2.5">Wait</th>
          <th className="px-3 py-2.5" title="All completed holds on this ticket">Ticket hold total</th>
          <th className="px-3 py-2.5">Cycle Time</th>
          <th className="px-3 py-2.5" title="This ticket's hold time inside its Cycle Time ÷ Cycle Time">% of cycle on hold</th>
          <th className="px-3 py-2.5">Next status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {rows.map((t) => (
          <tr key={`${t.issueKey}-${t.episodeIndex}`} className="hover:bg-neutral-50/70 transition-colors">
            <td className="px-3 py-2 whitespace-nowrap font-medium align-top">
              <JiraLink issueKey={t.issueKey} jiraBaseUrl={jiraBaseUrl} />
              <span className="block text-neutral-400 font-normal">{t.issueType} · {t.product}{t.episodeCount > 1 ? ` · hold ${t.episodeIndex} of ${t.episodeCount}` : ""}</span>
            </td>
            <td className="px-3 py-2 whitespace-nowrap align-top">
              {t.assignedSe || <span className="text-amber-700">(none)</span>}
              {t.seAtEntry && t.seAtEntry !== t.assignedSe && <span className="block text-neutral-400" title="Assignee when the ticket went On Hold">held by {t.seAtEntry}</span>}
            </td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.reporter || "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.priority || "—"}</td>
            <td className="px-3 py-2 align-top min-w-[140px]"><ReasonChip name={t.reason} sePause={t.sePause} /></td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.enteredAt ? formatManilaDate(t.enteredAt) : "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.exitedAt ? formatManilaDate(t.exitedAt) : <span className="text-amber-700">open</span>}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top"><DurationCell minutes={t.minutes} strong /></td>
            <td className="px-3 py-2 whitespace-nowrap align-top"><DurationCell minutes={t.ticketHoldMinutes} /></td>
            <td className="px-3 py-2 whitespace-nowrap align-top"><DurationCell minutes={t.cycleMinutes} /></td>
            <td className="px-3 py-2 whitespace-nowrap align-top tabular-nums">{pct(t.cycleHoldShare, 0)}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">
              {t.exitStatus || "—"}
              <span className="block text-neutral-400">now {t.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LongestTable({ rows, title, jiraBaseUrl, assigneeLabel }: { rows: EpisodeView[]; title: string; jiraBaseUrl?: string; assigneeLabel: string }) {
  const href = useHref();
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <Link href={href({ reason: null, exit: null, seg: null, long: null })} className="text-xs text-sprout-700 hover:underline">See every hold below</Link>
      </div>
      {rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-neutral-400">No completed holds in this period.</p> : <EpisodeRows rows={rows} jiraBaseUrl={jiraBaseUrl} assigneeLabel={assigneeLabel} />}
    </div>
  );
}

// ------------------------------------------------------------------------------ Where next

function ExitTable({ report }: { report: OnHoldReport }) {
  const href = useHref();
  const max = report.exits[0]?.episodes ?? 0;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">On Hold →</th>
            <th className="px-4 py-2.5 text-right">Holds</th>
            <th className="px-4 py-2.5 w-48">Share</th>
            <th className="px-4 py-2.5">Avg Hold</th>
            <th className="px-4 py-2.5">Median Hold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {report.exits.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No completed holds in this period.</td></tr>
          ) : (
            report.exits.map((x) => (
              <tr key={x.key} className="hover:bg-neutral-50/70 transition-colors">
                <td className="px-4 py-2.5">
                  <Link href={href({ exit: x.key, reason: null, seg: null, long: null })} className="text-neutral-900 hover:underline">{x.key}</Link>
                  {x.terminal && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-neutral-100 text-neutral-500 rounded px-1 py-0.5">ended, not resumed</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(x.episodes)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums w-12 text-right">{pct(x.share)}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-violet-100 overflow-hidden"><span className="block h-full bg-violet-400" style={{ width: max ? `${(x.episodes / max) * 100}%` : "0%" }} /></span>
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={x.avgMinutes} strong /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={x.medianMinutes} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatrixPanel({ report, title }: { report: OnHoldReport; title: string }) {
  const [open, setOpen] = useState(false);
  const { exits, rows } = report.matrix;
  const max = rows.reduce((m, r) => Math.max(m, ...exits.map((x) => r.counts[x] || 0)), 0);
  if (!rows.length) return null;
  return (
    <div className="card overflow-x-auto">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left">
        <span className="text-sm font-semibold text-neutral-900">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <table className="w-full text-sm border-t border-neutral-200 animate-dropdown-in">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-2.5">Holding Reason</th>
              <th className="px-4 py-2.5 text-right">Holds</th>
              {exits.map((x) => <th key={x} className="px-3 py-2.5 text-right whitespace-nowrap">{x}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.reason}>
                <td className="px-4 py-2 whitespace-nowrap">{r.reason}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{formatNumber(r.episodes)}</td>
                {exits.map((x) => {
                  const n = r.counts[x] || 0;
                  const alpha = max ? 0.08 + 0.5 * (n / max) : 0;
                  return (
                    <td key={x} className="px-3 py-2 text-right tabular-nums" style={n ? { background: `rgb(var(--a-400) / ${alpha.toFixed(2)})` } : undefined} title={`${r.reason} → ${x}: ${n}`}>
                      {n || <span className="text-neutral-300">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ Cycle

function CycleImpactCard({ report }: { report: OnHoldReport }) {
  const ci = report.cycleImpact;
  const row = (label: string, span: number | null, hold: number | null, share: number | null, n: number, note: string) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm text-neutral-700">
          <strong className="text-neutral-900">{holdText(span)}</strong> {label} · <strong className="text-neutral-900">{holdText(hold)}</strong> On Hold
        </p>
        <p className="text-lg font-semibold text-violet-700 tabular-nums">{pct(share)}</p>
      </div>
      <span className="block h-2.5 rounded-full bg-neutral-100 overflow-hidden">
        <span className="block h-full bg-violet-400" style={{ width: `${(share ?? 0) * 100}%` }} />
      </span>
      <p className="text-[11px] text-neutral-400">{formatNumber(n)} held tickets · {note}</p>
    </div>
  );
  return (
    <div className="card p-5 flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-neutral-900">Time on hold vs total time</h3>
      {row("average Cycle Time", ci.cycleAvgMinutes, ci.holdInCycleAvgMinutes, ci.shareOfCycle, ci.tickets, "only holds between leaving To Do and reaching review")}
      {row("average Lead Time", ci.leadAvgMinutes, ci.holdAvgMinutes, ci.shareOfLead, ci.leadTickets, "every hold, created → resolved")}
      <p className="text-[11px] text-neutral-400">Pooled: average hold ÷ average span across the held tickets. This shows how time is split, not what caused it.</p>
    </div>
  );
}

function TimeSplitCard({ report, title, teamSlug, query }: { report: OnHoldReport; title: string; teamSlug: string; query: string }) {
  const parts: { key: keyof TimeSplit; label: string; cls: string }[] = [
    { key: "inProgress", label: "In Progress", cls: "bg-sprout-400" },
    { key: "review", label: "Peer review wait", cls: "bg-neutral-400" },
    { key: "onHold", label: "On Hold", cls: "bg-violet-400" },
    { key: "other", label: "Other (To Do, checking, …)", cls: "bg-neutral-200" },
  ];
  const bar = (label: string, s: TimeSplit) => {
    const total = s.leadAvgMinutes ?? 0;
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-neutral-600">
          <span className="font-medium text-neutral-900">{label}</span> · {formatNumber(s.tickets)} tickets · {holdText(s.leadAvgMinutes)} average Lead Time
        </p>
        <span className="flex h-3 rounded-full overflow-hidden bg-neutral-100">
          {total > 0 &&
            parts.map((p) => {
              const v = (s[p.key] as number | null) ?? 0;
              return v > 0 ? <span key={p.key} className={p.cls} style={{ width: `${(v / total) * 100}%` }} title={`${p.label}: ${holdText(v)} (${pct(v / total, 0)})`} /> : null;
            })}
        </span>
      </div>
    );
  };
  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <Link href={`/${teamSlug}/lead-cycle-time?${query}&metric=lead`} className="text-xs text-sprout-700 hover:underline">Lead Time deep-dive</Link>
      </div>
      {bar("Went On Hold", report.timeSplit.held)}
      {bar("Never On Hold", report.timeSplit.notHeld)}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1"><span className={cn("w-2 h-2 rounded-full", p.cls)} />{p.label}</span>
        ))}
      </div>
      <p className="text-[11px] text-neutral-400">Average per ticket. &quot;Other&quot; is Lead Time not spent In Progress, in peer review or On Hold. Hover a segment for its time.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------ Segments + repeat

const DIMS: FcrSegmentDimension[] = ["se", "issueType", "priority", "reporter", "product", "month", "week"];

function SegmentTable({ report }: { report: OnHoldReport }) {
  const [dim, setDim] = useState<FcrSegmentDimension>("se");
  const [minSample, setMinSample] = useState(false);
  const href = useHref();
  const isTime = dim === "month" || dim === "week";
  const all = report.segments[dim];
  const rows: HoldSegmentRow[] = minSample ? all.filter((r) => !r.smallSample) : all;
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 flex-wrap">
        <DimTabs dims={DIMS} active={dim} onChange={setDim} />
        <label className="inline-flex items-center gap-2 text-xs text-neutral-600 cursor-pointer select-none">
          <input type="checkbox" checked={minSample} onChange={(ev) => setMinSample(ev.target.checked)} className="accent-sprout-600" />
          Hide rows under 10 held tickets
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">{dim === "reporter" ? "Reporter (requesting)" : SEGMENT_LABELS[dim]}</th>
            <th className="px-4 py-2.5 text-right">Resolved</th>
            <th className="px-4 py-2.5 text-right">On Hold</th>
            <th className="px-4 py-2.5 text-right">Hold rate</th>
            <th className="px-4 py-2.5">Avg Wait</th>
            <th className="px-4 py-2.5">Median</th>
            <th className="px-4 py-2.5" title="Shown with 10+ holds">P90</th>
            <th className="px-4 py-2.5">Total Hold Time</th>
            <th className="px-4 py-2.5">Most common reason</th>
            {!isTime && <th className="px-4 py-2.5 text-right">Previous avg</th>}
            {!isTime && <th className="px-4 py-2.5 text-right">Change</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.key} className={cn("hover:bg-neutral-50/70 transition-colors", r.smallSample && "text-neutral-500")}>
              <td className="px-4 py-2">
                <Link href={href({ seg: `${dim}:${r.key}`, reason: null, exit: null, long: null })} className="hover:text-sprout-700 hover:underline" title="Show these holds below">
                  {segLabel(dim, r.key)}
                </Link>
                {r.smallSample && <SmallTag />}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.resolved)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.held)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pct(r.holdRate)}</td>
              <td className="px-4 py-2 whitespace-nowrap"><DurationCell minutes={r.stats.avgMinutes} strong /></td>
              <td className="px-4 py-2 whitespace-nowrap"><DurationCell minutes={r.stats.medianMinutes} /></td>
              <td className="px-4 py-2 whitespace-nowrap"><DurationCell minutes={r.stats.p90Minutes} /></td>
              <td className="px-4 py-2 whitespace-nowrap"><DurationCell minutes={r.stats.totalMinutes} /></td>
              <td className="px-4 py-2 text-neutral-600">{r.topReason ?? "—"}</td>
              {!isTime && <td className="px-4 py-2 text-right tabular-nums text-neutral-500 whitespace-nowrap">{r.previous && r.previous.avgMinutes !== null ? holdText(r.previous.avgMinutes) : "—"}</td>}
              {!isTime && (
                <td className={cn("px-4 py-2 text-right tabular-nums whitespace-nowrap", (r.deltaAvgMinutes ?? 0) > 0 ? "text-amber-700" : (r.deltaAvgMinutes ?? 0) < 0 ? "text-emerald-700" : "text-neutral-400")}>
                  {r.deltaAvgMinutes === null || Math.abs(r.deltaAvgMinutes) < 1 ? "—" : `${r.deltaAvgMinutes > 0 ? "↑" : "↓"} ${holdText(Math.abs(r.deltaAvgMinutes))}`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">
        Assigned SE is the ticket&apos;s owner. The hold list below also shows who held it when it went On Hold. A high hold rate isn&apos;t a performance
        verdict: ticket mix, requester response and outside dependencies drive it.
      </p>
    </div>
  );
}

function RepeatCard({ report, title }: { report: OnHoldReport; title: string }) {
  const e = report.efficiency;
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Went back on hold" value={pct(e.repeatHoldRate, 0)} sub={`${formatNumber(e.repeatTickets)} of ${formatNumber(report.coverage.withEpisodes)} held tickets`} />
        <Tile label="Holds per held ticket" value={report.current.avgEpisodesPerTicket === null ? "—" : report.current.avgEpisodesPerTicket.toFixed(2)} />
        <Tile label="Most holds on one ticket" value={formatNumber(e.maxEpisodes)} />
        <Tile label="Hold time on repeat tickets" value={holdText(e.repeatTotalMinutes)} sub={`${pct(report.current.totalMinutes ? e.repeatTotalMinutes / report.current.totalMinutes : null, 0)} of all hold time`} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Trends

function WaitTrend({ report }: { report: OnHoldReport }) {
  const data = report.trend.map((t) => ({ bucket: t.bucket, held: t.held, avg: days(t.avgMinutes), median: days(t.medianMinutes), p90: days(t.p90Minutes), heldPct: t.heldShare === null ? null : Math.round(t.heldShare * 1000) / 10 }));
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm font-medium text-neutral-700">On-Hold Wait Time and volume</p>
        <p className="text-xs text-neutral-400">Bars: held tickets · Lines: days per hold (P90 needs 10+ holds)</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis yAxisId="d" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={38} unit="d" />
          <YAxis yAxisId="n" orientation="right" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={38} />
          <Tooltip
            labelFormatter={formatBucketLabel}
            formatter={(v, n, item) =>
              n === "Held tickets" ? [`${v} (${item?.payload?.heldPct ?? "—"}% of resolved)`, n] : [v === null || v === undefined ? "—" : `${v} days`, n]
            }
            contentStyle={tooltipStyle}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="n" dataKey="held" name="Held tickets" fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
          <Line yAxisId="d" type="monotone" dataKey="avg" name="Average" stroke="rgb(var(--a-700))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
          <Line yAxisId="d" type="monotone" dataKey="median" name="Median" stroke="rgb(var(--n-500))" strokeWidth={1.75} dot={false} connectNulls />
          <Line yAxisId="d" type="monotone" dataKey="p90" name="P90" stroke="rgb(var(--a-400))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type ReasonMetric = "episodes" | "avg" | "total";

function ReasonTrend({ report, title }: { report: OnHoldReport; title: string }) {
  const [metric, setMetric] = useState<ReasonMetric>("total");
  const data = report.trend.map((t) => {
    const o: Record<string, string | number | null> = { bucket: t.bucket };
    for (const r of report.trendReasons) {
      const x = t.byReason[r];
      o[r] = !x ? 0 : metric === "episodes" ? x.episodes : metric === "avg" ? days(x.avgMinutes) : days(x.totalMinutes);
    }
    return o;
  });
  const opts: { k: ReasonMetric; label: string }[] = [
    { k: "total", label: "Total time" },
    { k: "avg", label: "Avg wait" },
    { k: "episodes", label: "Holds" },
  ];
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          {opts.map((o) => (
            <button key={o.k} onClick={() => setMetric(o.k)} className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors", metric === o.k ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={metric !== "episodes"} width={38} unit={metric === "episodes" ? "" : "d"} />
          <Tooltip labelFormatter={formatBucketLabel} formatter={(v, n) => [v === null || v === undefined ? "—" : metric === "episodes" ? v : `${v} days`, n]} contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {report.trendReasons.map((r, i) => (
            <Line key={r} type="monotone" dataKey={r} name={r} stroke={SERIES[i % SERIES.length]} strokeWidth={i === 0 ? 2.5 : 1.75} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400 mt-2">Top six reasons by total hold time. A shift shows a change in what we wait on, not why it changed.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------ Episodes

function EpisodesTable({ report, title, jiraBaseUrl }: { report: OnHoldReport; title: string; jiraBaseUrl?: string }) {
  const href = useHref();
  const f = report.ticketFilter;
  const chip = (on: boolean, label: string, to: string) => (
    <Link key={label} href={to} scroll={false} className={cn("rounded-full px-2.5 py-0.5 border transition-colors", on ? "bg-violet-100 border-violet-300 text-violet-800" : "border-neutral-200 text-neutral-600 hover:border-violet-300")}>
      {label}
    </Link>
  );
  return (
    <section className="card overflow-x-auto" id="tickets">
      <div className="px-4 py-3 border-b border-neutral-200 flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-2xl">One row per completed hold, longest first. The key opens Jira (titles aren&apos;t synced). Filters keep the period and grain.</p>
          <p className="text-xs text-neutral-500 mt-1">
            {formatNumber(report.episodes.length)} shown
            {report.episodeTotal > report.episodes.length && ` · longest ${report.episodes.length} of ${formatNumber(report.episodeTotal)}`}
            {f.segment && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sprout-50 text-sprout-700 px-2 py-0.5">
                {SEGMENT_LABELS[f.segment.dim]}: {segLabel(f.segment.dim, f.segment.key)}
                <Link href={href({ seg: null })} aria-label="Clear segment filter"><X className="w-3 h-3" /></Link>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-neutral-500 mr-1">Reason:</span>
          {report.allReasons.map((r) => chip(f.reason === r, r, href({ reason: f.reason === r ? null : r })))}
          {f.reason && <Link href={href({ reason: null })} scroll={false} className="text-neutral-400 hover:text-neutral-700 ml-1">clear</Link>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-neutral-500 mr-1">Next status:</span>
          {report.allExits.map((x) => chip((f.exit || "").toLowerCase() === x.toLowerCase(), x, href({ exit: (f.exit || "").toLowerCase() === x.toLowerCase() ? null : x })))}
          <span className="mx-1 text-neutral-300">|</span>
          {chip(f.longOnly, `Over threshold (${holdText(report.threshold.minutes)})`, href({ long: f.longOnly ? null : "1" }))}
          {(f.exit || f.longOnly) && <Link href={href({ exit: null, long: null })} scroll={false} className="text-neutral-400 hover:text-neutral-700 ml-1">clear</Link>}
        </div>
      </div>
      {report.episodes.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-400">No holds match.</p>
      ) : (
        <EpisodeRows rows={report.episodes} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------ Data quality

function DataQualityPanel({ report, title, jiraBaseUrl }: { report: OnHoldReport; title: string; jiraBaseUrl?: string }) {
  const [open, setOpen] = useState(false);
  const dq = report.dataQuality;
  const summary = [
    dq.legacyTickets && `${dq.legacyTickets} held tickets without hold history`,
    dq.notSpecifiedEpisodes && `${dq.notSpecifiedEpisodes} holds with no reason`,
    dq.otherExitCount && `${dq.otherExitCount} other exits`,
    dq.openOnResolvedCount && `${dq.openOnResolvedCount} unclosed holds`,
    dq.invalidCount && `${dq.invalidCount} invalid`,
  ].filter(Boolean);
  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className={cn("w-4 h-4", summary.length ? "text-amber-600" : "text-neutral-300")} />
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          <span className="text-xs text-neutral-500">{summary.length ? summary.join(" · ") : "Every hold has a reason, an exit and valid timestamps."}</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-5 text-sm animate-dropdown-in">
          <ul className="text-xs text-neutral-600 flex flex-col gap-1">
            <li><span className="font-medium text-neutral-800">No hold history</span>: synced before per-hold data existed. Counted as held, left out of timings until the rebackfill runs.</li>
            <li><span className="font-medium text-neutral-800">No reason</span>: Ticket Holding Reason was blank. Shown as &quot;Not specified&quot; and never guessed from the ticket text.</li>
            <li><span className="font-medium text-neutral-800">Other exits</span>: left On Hold for a status outside the six counted ones (e.g. To do, Done). Not counted in the wait.</li>
            <li><span className="font-medium text-neutral-800">Unclosed holds</span>: a hold with no exit on a ticket no longer On Hold, so the transition out wasn&apos;t recorded.</li>
            <li><span className="font-medium text-neutral-800">Invalid</span>: missing entry time or an exit before the entry.</li>
          </ul>
          {dq.otherExits.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold text-neutral-800 mb-1">Other exits</p>
              <EpisodeRows rows={dq.otherExits} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
            </div>
          )}
          {dq.openOnResolved.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold text-neutral-800 mb-1">Unclosed holds</p>
              <EpisodeRows rows={dq.openOnResolved} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
            </div>
          )}
          {dq.invalid.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-800 mb-1">Invalid</p>
              <ul className="text-xs text-neutral-600 flex flex-col gap-0.5">
                {dq.invalid.map((x, i) => (
                  <li key={i}><JiraLink issueKey={x.issueKey} jiraBaseUrl={jiraBaseUrl} /> · {x.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
