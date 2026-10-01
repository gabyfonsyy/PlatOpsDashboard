"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { ComposedChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { EscalationReport, EscTicket, SpanStats } from "@/lib/escalation";
import type { FcrSegmentDimension, FcrValue } from "@/lib/fcr";
import { useTheme } from "@/components/theme/ThemeProvider";
import { escalationCopy } from "@/lib/escalation-view";
import { SEGMENT_LABELS } from "@/lib/fcr-view";
import { fmtDur } from "@/lib/review-wait-view";
import { formatManilaDate, formatNumber, formatPercent } from "@/lib/format";
import { vsPreviousTrend } from "@/lib/period-trend";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { GrainToggle } from "@/components/dashboard/ReviewWaitTrendChart";
import { Section, useHref, JiraLink, PtsDelta, DimTabs, RateBar, formatBucketLabel, tooltipStyle } from "@/components/dashboard/FcrDeepDive";
import { cn } from "@/lib/utils";

const pct = (n: number | null | undefined, d = 1) => formatPercent(n ?? null, d);
const segLabel = (dim: FcrSegmentDimension, key: string) => (dim === "dow" ? key.replace(/^\d+ · /, "") : key);
const durOr = (m: number | null) => (m === null ? "—" : fmtDur(m));

/** Muted, theme-aware series colours for the per-team trend lines. */
const SERIES = ["rgb(var(--a-600))", "rgb(var(--a-400))", "rgb(var(--n-500))", "rgb(var(--a-800))", "rgb(var(--n-400))", "rgb(var(--a-300))"];

function DestChip({ name }: { name: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium mr-1 mb-0.5",
        name === "Not specified" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"
      )}
    >
      {name}
    </span>
  );
}

/**
 * Escalation Rate deep-dive — How much are we escalating? → Who are we leaning on? → What's getting
 * escalated? → How complex are the escalations? → Is it changing? → tickets → data quality. Every
 * destination view counts each receiving team separately (DevOps + L3 on one ticket = +1 each);
 * only the rate and the complexity groups count a ticket once.
 */
export function EscalationDeepDive({ report, jiraBaseUrl }: { report: EscalationReport; jiraBaseUrl?: string }) {
  const { theme } = useTheme();
  const copy = escalationCopy(theme);
  const c = report.current;
  const p = report.previous;

  return (
    <div className="flex flex-col gap-8">
      {/* ============================================================ 1 · HOW MUCH */}
      <Section title={copy.howMuch}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label={copy.rateLabel}
            value={pct(c.rate)}
            sublabel={`${formatNumber(c.escalated)} / ${formatNumber(c.resolved)} resolved tickets required additional help${report.smallSample ? " · Small sample" : ""}`}
            trend={vsPreviousTrend(c.rate, p?.rate, { better: "lower", mode: "pts" })}
            baseline={p ? { label: `Previous period ${pct(p.rate)} (${formatNumber(p.escalated)} / ${formatNumber(p.resolved)})` } : undefined}
            badge={report.smallSample ? { label: "Small sample", tone: "warning" } : undefined}
            tooltip="First Contact Resolution = No ÷ tickets resolved in the period with FCR = Yes or No — exactly 100% minus FCR Rate. Ticket Escalation decides WHO helped, never whether a ticket counts. Change shown in percentage points."
          />
          <MetricCard
            label={copy.escalatedLabel}
            value={formatNumber(c.escalated)}
            sublabel={p ? `previous ${formatNumber(p.escalated)}` : undefined}
            trend={vsPreviousTrend(c.escalated, p?.escalated, { better: "neutral" })}
            tooltip="Tickets with FCR = No, each counted once however many teams it went to."
          />
          <MetricCard
            label={copy.fcrLabel}
            value={formatNumber(c.fcr)}
            sublabel={p ? `previous ${formatNumber(p.fcr)}` : undefined}
            trend={vsPreviousTrend(c.fcr, p?.fcr, { better: "neutral" })}
            tooltip="Tickets with FCR = Yes."
          />
          <MetricCard
            label={copy.avgDestLabel}
            value={report.avgDestinationsPerEscalated === null ? "—" : report.avgDestinationsPerEscalated.toFixed(2)}
            sublabel="avg receiving teams per escalated ticket"
            tooltip="Average number of Ticket Escalation destinations on escalated tickets that name at least one."
          />
        </div>
      </Section>

      <InsightsPanel insights={report.insights} positiveHighlights={[]} title={copy.whatShouldIKnow} />

      {/* ============================================================ 2 · WHO ARE WE LEANING ON */}
      <Section title={copy.whoLeaning} subtitle={copy.whoLeaningCaveat}>
        <DestinationCards report={report} />
        <DependenciesTable report={report} title={copy.dependencies} />
      </Section>

      {/* ============================================================ 3 · WHAT'S GETTING ESCALATED */}
      <Section title={copy.whatsEscalated} subtitle={copy.whatsEscalatedCaveat}>
        <SegmentTable report={report} />
        <MatrixTable report={report} title={copy.matrix} caveat={copy.matrixCaveat} />
      </Section>

      {/* ============================================================ 4 · HOW COMPLEX */}
      <Section title={copy.complexity} subtitle={copy.complexityCaveat}>
        <ComplexityTable report={report} />
        <ImpactCard report={report} title={copy.impact} caveat={copy.impactCaveat} />
      </Section>

      {/* ============================================================ 5 · IS IT CHANGING */}
      <Section title={copy.isItChanging} right={<GrainToggle active={report.grain} />}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <RateTrend report={report} />
          <DestinationTrend report={report} title={copy.destTrend} />
        </div>
      </Section>

      <TicketsTable report={report} title={copy.tickets} jiraBaseUrl={jiraBaseUrl} />
      <DataQualityPanel report={report} title={copy.dataQuality} jiraBaseUrl={jiraBaseUrl} />
    </div>
  );
}

// ------------------------------------------------------------------------------ Who are we leaning on

function DestinationCards({ report }: { report: EscalationReport }) {
  const href = useHref();
  const max = report.destinations[0]?.tickets ?? 0;
  if (!report.destinations.length) return <div className="card p-6 text-sm text-neutral-400 text-center">No escalations in this period.</div>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {report.destinations.map((d) => (
        <Link
          key={d.key}
          href={href({ dest: d.key, seg: null, fcr: null })}
          className="rounded-2xl bg-neutral-50 hover:bg-neutral-100 px-4 py-3 transition-all hover:-translate-y-0.5 block"
          title={`Show tickets escalated to ${d.key}`}
        >
          <p className={cn("text-sm font-semibold", d.key === "Not specified" ? "text-amber-700" : "text-neutral-900")}>{d.key}</p>
          <p className="text-xl font-semibold text-neutral-900 tabular-nums mt-0.5">
            {formatNumber(d.tickets)} <span className="text-xs font-normal text-neutral-500">tickets</span>
          </p>
          <p className="text-[11px] text-neutral-500">{pct(d.shareOfEscalated, 0)} of escalated</p>
          <span className="block mt-2 h-1 rounded-full bg-violet-100 overflow-hidden">
            <span className="block h-full bg-violet-400" style={{ width: max ? `${Math.max(3, (d.tickets / max) * 100)}%` : "0%" }} />
          </span>
          {d.change !== null && (
            <p className={cn("text-[11px] mt-1.5 tabular-nums", d.change > 0 ? "text-amber-700" : d.change < 0 ? "text-emerald-700" : "text-neutral-400")}>
              {d.change === 0 ? "— no change" : `${d.change > 0 ? "↑" : "↓"} ${Math.abs(d.change)} vs previous (${d.previousTickets})`}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}

function DependenciesTable({ report, title }: { report: EscalationReport; title: string }) {
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          <em>Tickets may have multiple escalation destinations, so destination percentages may exceed 100% when combined.</em> Cycle and review
          wait are for the tickets sent to that team.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">Team</th>
            <th className="px-4 py-2.5 text-right">Tickets</th>
            <th className="px-4 py-2.5 text-right">% of escalated</th>
            <th className="px-4 py-2.5 text-right">% of resolved</th>
            <th className="px-4 py-2.5">Avg Cycle</th>
            <th className="px-4 py-2.5">Median Cycle</th>
            <th className="px-4 py-2.5">Avg Review Wait</th>
            <th className="px-4 py-2.5 text-right" title="FCR rate across every ticket naming this team">FCR Rate</th>
            <th className="px-4 py-2.5 text-right">SEs escalating</th>
            <th className="px-4 py-2.5 text-right">Previous</th>
            <th className="px-4 py-2.5 text-right">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {report.destinations.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-6 text-center text-neutral-400">No escalations in this period.</td>
            </tr>
          ) : (
            report.destinations.map((d) => (
              <tr key={d.key} className={cn("hover:bg-neutral-50/70 transition-colors", d.tickets < 10 && "text-neutral-500")}>
                <td className="px-4 py-2.5 font-medium text-neutral-900">
                  {d.key}
                  {d.tickets < 10 && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 rounded px-1 py-0.5">small</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(d.tickets)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(d.shareOfEscalated)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{pct(d.shareOfResolved)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={d.stats.cycleAvgMinutes} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={d.stats.cycleMedianMinutes} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={d.stats.reviewWaitAvgMinutes} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d.key === "Not specified" ? "—" : pct(d.fcrRate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d.distinctSes}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{d.previousTickets ?? "—"}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums", (d.change ?? 0) > 0 ? "text-amber-700" : (d.change ?? 0) < 0 ? "text-emerald-700" : "text-neutral-400")}>
                  {d.change === null || d.change === 0 ? "—" : `${d.change > 0 ? "+" : ""}${d.change}`}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ What's getting escalated

const DIMS: FcrSegmentDimension[] = ["se", "issueType", "reporter", "priority", "product", "month", "week"];

function SegmentTable({ report }: { report: EscalationReport }) {
  const [dim, setDim] = useState<FcrSegmentDimension>("issueType");
  const [minSample, setMinSample] = useState(false);
  const href = useHref();
  const isTime = dim === "month" || dim === "week";
  const isSe = dim === "se";
  const all = report.segments[dim];
  const rows = minSample ? all.filter((r) => !r.smallSample) : all;
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 flex-wrap">
        <DimTabs dims={DIMS} active={dim} onChange={setDim} />
        <label className="inline-flex items-center gap-2 text-xs text-neutral-600 cursor-pointer select-none">
          <input type="checkbox" checked={minSample} onChange={(e) => setMinSample(e.target.checked)} className="accent-sprout-600" />
          Hide rows under 10 tickets
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">{SEGMENT_LABELS[dim]}</th>
            <th className="px-4 py-2.5 text-right">Resolved</th>
            <th className="px-4 py-2.5 text-right">Escalated</th>
            <th className="px-4 py-2.5 w-44">Escalation Rate</th>
            <th className="px-4 py-2.5 text-right">FCR Rate</th>
            <th className="px-4 py-2.5">Avg Cycle</th>
            {!isTime && <th className="px-4 py-2.5 text-right">Previous</th>}
            {!isTime && <th className="px-4 py-2.5 text-right">Change</th>}
            {isSe && <th className="px-4 py-2.5">Most common</th>}
            {isSe && <th className="px-4 py-2.5 text-right">Teams</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.key} className={cn("hover:bg-neutral-50/70 transition-colors", r.smallSample && "text-neutral-500")}>
              <td className="px-4 py-2">
                <Link href={href({ seg: `${dim}:${r.key}`, fcr: null, dest: null })} className="hover:text-sprout-700 hover:underline" title="Show these escalated tickets below">
                  {segLabel(dim, r.key)}
                </Link>
                {r.smallSample && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 rounded px-1 py-0.5">small</span>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.resolved)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.escalated)}</td>
              <td className="px-4 py-2"><RateBar rate={r.rate} /></td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{r.rate === null ? "—" : pct(1 - r.rate)}</td>
              <td className="px-4 py-2 whitespace-nowrap"><DurationCell minutes={r.cycleAvgMinutes} /></td>
              {!isTime && (
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                  {r.previous && r.previous.resolved > 0 ? `${pct(r.previous.rate)} · ${r.previous.resolved}` : "—"}
                </td>
              )}
              {/* Lower escalation is green, but read it with the ticket mix — not a verdict. */}
              {!isTime && <td className="px-4 py-2 text-right whitespace-nowrap"><PtsDelta value={r.deltaPts === null ? null : -r.deltaPts} /></td>}
              {isSe && <td className="px-4 py-2 text-neutral-600">{r.topDestination ?? "—"}</td>}
              {isSe && <td className="px-4 py-2 text-right tabular-nums">{r.distinctDestinations}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!isTime && (
        <p className="px-4 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">Change is shown as escalation going ↓ (green) or ↑ (red) in percentage points.</p>
      )}
    </div>
  );
}

function MatrixTable({ report, title, caveat }: { report: EscalationReport; title: string; caveat: string }) {
  const { destinations, rows } = report.matrix;
  const max = rows.reduce((m, r) => Math.max(m, ...destinations.map((d) => r.counts[d] || 0)), 0);
  if (!rows.length) return null;
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">{caveat}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">Ticket Type</th>
            <th className="px-4 py-2.5 text-right">Escalated</th>
            {destinations.map((d) => (
              <th key={d} className="px-3 py-2.5 text-right whitespace-nowrap">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.issueType}>
              <td className="px-4 py-2 text-neutral-900 whitespace-nowrap">{r.issueType}</td>
              <td className="px-4 py-2 text-right tabular-nums font-medium">{formatNumber(r.escalated)}</td>
              {destinations.map((d) => {
                const n = r.counts[d] || 0;
                const alpha = max ? 0.08 + 0.5 * (n / max) : 0;
                return (
                  <td
                    key={d}
                    className="px-3 py-2 text-right tabular-nums"
                    style={n ? { background: `rgb(var(--a-400) / ${alpha.toFixed(2)})` } : undefined}
                    title={`${r.issueType} → ${d}: ${n}`}
                  >
                    {n || <span className="text-neutral-300">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Complexity + impact

function StatCells({ s }: { s: SpanStats }) {
  return (
    <>
      <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={s.cycleAvgMinutes} /></td>
      <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={s.cycleMedianMinutes} /></td>
      <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={s.cycleP90Minutes} /></td>
      <td className="px-4 py-2.5 whitespace-nowrap"><DurationCell minutes={s.reviewWaitAvgMinutes} /></td>
      <td className="px-4 py-2.5 text-right tabular-nums">{pct(s.slaMetRate)}</td>
    </>
  );
}

const STAT_HEAD = (
  <>
    <th className="px-4 py-2.5">Avg Cycle</th>
    <th className="px-4 py-2.5">Median Cycle</th>
    <th className="px-4 py-2.5" title="Shown with 10+ tickets">P90 Cycle</th>
    <th className="px-4 py-2.5">Avg Review Wait</th>
    <th className="px-4 py-2.5 text-right" title="Resolved on or before the due date">Due-date SLA met</th>
  </>
);

function ComplexityTable({ report }: { report: EscalationReport }) {
  const label = (k: string) => (k === "1" ? "1 team" : k === "2" ? "2 teams" : k === "3+" ? "3+ teams" : "Not specified");
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex flex-wrap gap-x-6 gap-y-2">
        {report.complexity.map((g) => (
          <span key={g.key} className="text-sm">
            <span className="font-semibold text-neutral-900 tabular-nums">{pct(g.share, 0)}</span> <span className="text-neutral-500">— {label(g.key)}</span>
          </span>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">Escalated to</th>
            <th className="px-4 py-2.5 text-right">Tickets</th>
            {STAT_HEAD}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {report.complexity.map((g) =>
            g.smallSample ? (
              <tr key={g.key} className="text-neutral-500">
                <td className="px-4 py-2.5">{label(g.key)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(g.tickets)}</td>
                <td colSpan={5} className="px-4 py-2.5 text-xs text-neutral-400">Too few tickets (under 10) to compare.</td>
              </tr>
            ) : (
              <tr key={g.key}>
                <td className="px-4 py-2.5 text-neutral-900">{label(g.key)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(g.tickets)}</td>
                <StatCells s={g.stats} />
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

function ImpactCard({ report, title, caveat }: { report: EscalationReport; title: string; caveat: string }) {
  const { fcr, escalated } = report.impact;
  const extra = fcr.cycleMedianMinutes !== null && escalated.cycleMedianMinutes !== null ? escalated.cycleMedianMinutes - fcr.cycleMedianMinutes : null;
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-xs text-neutral-400 mt-0.5">{caveat}</p>
        </div>
        {extra !== null && (
          <p className="text-sm text-neutral-600">
            Observed median difference: <strong className="text-neutral-900">{extra >= 0 ? "+" : "−"}{durOr(Math.abs(extra))}</strong>
          </p>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5" />
            <th className="px-4 py-2.5 text-right">Tickets</th>
            {STAT_HEAD}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          <tr>
            <td className="px-4 py-2.5 text-neutral-900">First contact (FCR = Yes)</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(fcr.tickets)}</td>
            <StatCells s={fcr} />
          </tr>
          <tr>
            <td className="px-4 py-2.5 text-neutral-900">Escalated (FCR = No)</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(escalated.tickets)}</td>
            <StatCells s={escalated} />
          </tr>
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">
        Review wait averages only tickets that went through peer review ({formatNumber(fcr.reviewedTickets)} first-contact,{" "}
        {formatNumber(escalated.reviewedTickets)} escalated).
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------ Trends

function RateTrend({ report }: { report: EscalationReport }) {
  const data = report.trend.map((t) => ({ ...t, ratePct: t.rate === null ? null : Math.round(t.rate * 1000) / 10 }));
  const prevPct = report.previous?.rate == null ? null : Math.round(report.previous.rate * 1000) / 10;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm font-medium text-neutral-700">Escalation Rate and volume</p>
        <p className="text-xs text-neutral-400">Bars: resolved / escalated · Line: rate{prevPct !== null && ` · dashed: previous ${prevPct}%`}</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis yAxisId="n" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={38} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={40} unit="%" />
          <Tooltip labelFormatter={formatBucketLabel} formatter={(v: number, n: string) => [n === "Escalation Rate" ? (v === null ? "—" : `${v}%`) : v, n]} contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="n" dataKey="resolved" name="Resolved" fill="rgb(var(--n-200))" radius={[3, 3, 0, 0]} />
          <Bar yAxisId="n" dataKey="escalated" name="Escalated" fill="rgb(var(--a-300))" radius={[3, 3, 0, 0]} />
          <Line yAxisId="pct" type="monotone" dataKey="ratePct" name="Escalation Rate" stroke="rgb(var(--a-700))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
          {prevPct !== null && <ReferenceLine yAxisId="pct" y={prevPct} stroke="rgb(var(--n-400))" strokeDasharray="5 4" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DestinationTrend({ report, title }: { report: EscalationReport; title: string }) {
  const data = report.trend.map((t) => ({ bucket: t.bucket, ...t.byDestination }));
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        <p className="text-xs text-neutral-400">Escalated tickets per team · one ticket can count for several teams</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
          <Tooltip labelFormatter={formatBucketLabel} contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {report.trendDestinations.map((d, i) => (
            <Line key={d} type="monotone" dataKey={d} name={d} stroke={SERIES[i % SERIES.length]} strokeWidth={i === 0 ? 2.5 : 1.75} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------------------ Tickets

const FCR_TONE: Record<FcrValue, string> = {
  Yes: "bg-sprout-50 text-sprout-700",
  No: "bg-amber-50 text-amber-700",
  Unknown: "bg-neutral-100 text-neutral-500",
};

function TicketRows({ tickets, jiraBaseUrl, assigneeLabel }: { tickets: EscTicket[]; jiraBaseUrl?: string; assigneeLabel: string }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-neutral-50 border-b border-neutral-200">
        <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wide">
          <th className="px-3 py-2.5">Ticket</th>
          <th className="px-3 py-2.5">FCR</th>
          <th className="px-3 py-2.5">Escalated to</th>
          <th className="px-3 py-2.5">{assigneeLabel}</th>
          <th className="px-3 py-2.5">Reporter</th>
          <th className="px-3 py-2.5">Priority</th>
          <th className="px-3 py-2.5">Created</th>
          <th className="px-3 py-2.5" title="First moved out of Backlog/To Do — closest synced field to first response">First contact</th>
          <th className="px-3 py-2.5">Resolved</th>
          <th className="px-3 py-2.5">Cycle</th>
          <th className="px-3 py-2.5">Review Wait</th>
          <th className="px-3 py-2.5">SLA</th>
          <th className="px-3 py-2.5">Outcome</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {tickets.map((t) => (
          <tr key={t.issueKey} className="hover:bg-neutral-50/70 transition-colors">
            <td className="px-3 py-2 whitespace-nowrap font-medium align-top">
              <JiraLink issueKey={t.issueKey} jiraBaseUrl={jiraBaseUrl} />
              <span className="block text-neutral-400 font-normal">{t.issueType} · {t.product}</span>
            </td>
            <td className="px-3 py-2 align-top"><span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", FCR_TONE[t.fcr])}>{t.fcr}</span></td>
            <td className="px-3 py-2 align-top min-w-[120px]">{t.destinations.length ? t.destinations.map((d) => <DestChip key={d} name={d} />) : <span className="text-neutral-300">—</span>}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.assignedSe || <span className="text-amber-700">(none)</span>}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.reporter || "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.priority || "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{formatManilaDate(t.createdAt)}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.firstContactAt ? formatManilaDate(t.firstContactAt) : "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{formatManilaDate(t.resolvedAt)}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top"><DurationCell minutes={t.cycleMinutes} /></td>
            <td className="px-3 py-2 whitespace-nowrap align-top"><DurationCell minutes={t.reviewWaitMinutes} /></td>
            <td className="px-3 py-2 whitespace-nowrap align-top">
              {t.slaMet === null ? "—" : t.slaMet ? <span className="text-emerald-700">Met</span> : <span className="text-red-600">Missed</span>}
              {t.dueDate && <span className="block text-neutral-400">due {t.dueDate}</span>}
            </td>
            <td className="px-3 py-2 align-top">
              {t.status}
              {t.outcomeReason && <span className="block text-neutral-400">{t.outcomeReason}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TicketsTable({ report, title, jiraBaseUrl }: { report: EscalationReport; title: string; jiraBaseUrl?: string }) {
  const href = useHref();
  const f = report.ticketFilter;
  const toggleDest = (d: string) => {
    const next = f.destinations.includes(d) ? f.destinations.filter((x) => x !== d) : [...f.destinations, d];
    return href({ dest: next.length ? next.join(",") : null });
  };
  const views: { label: string; value: string | null }[] = [
    { label: "Escalated (FCR = No)", value: null },
    { label: "FCR = Yes", value: "Yes" },
    { label: "All", value: "all" },
  ];
  const activeView = f.fcr === "No" ? null : f.fcr === null ? "all" : f.fcr;
  return (
    <section className="card overflow-x-auto" id="tickets">
      <div className="px-4 py-3 border-b border-neutral-200 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
            <p className="text-xs text-neutral-400 mt-0.5 max-w-2xl">
              Every selected Ticket Escalation value is shown. The key opens Jira (titles aren&apos;t synced). Picking several teams shows tickets sent to
              any of them.
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              {formatNumber(report.tickets.length)} shown
              {report.ticketTotal > report.tickets.length && ` · most recent ${report.tickets.length} of ${formatNumber(report.ticketTotal)}`}
              {f.segment && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sprout-50 text-sprout-700 px-2 py-0.5">
                  {SEGMENT_LABELS[f.segment.dim]}: {segLabel(f.segment.dim, f.segment.key)}
                  <Link href={href({ seg: null })} aria-label="Clear segment filter"><X className="w-3 h-3" /></Link>
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
            {views.map((v) => (
              <Link
                key={v.label}
                href={href({ fcr: v.value })}
                scroll={false}
                className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors", activeView === v.value ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
              >
                {v.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-neutral-500 mr-1">Escalated to:</span>
          {report.allDestinations.map((d) => {
            const on = f.destinations.includes(d);
            return (
              <Link
                key={d}
                href={toggleDest(d)}
                scroll={false}
                className={cn("rounded-full px-2.5 py-0.5 border transition-colors", on ? "bg-violet-100 border-violet-300 text-violet-800" : "border-neutral-200 text-neutral-600 hover:border-violet-300")}
              >
                {d}
              </Link>
            );
          })}
          {f.destinations.length > 0 && (
            <Link href={href({ dest: null })} scroll={false} className="text-neutral-400 hover:text-neutral-700 ml-1">clear</Link>
          )}
        </div>
      </div>
      {report.tickets.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-400">No tickets match.</p>
      ) : (
        <TicketRows tickets={report.tickets} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------ Data quality

function DataQualityPanel({ report, title, jiraBaseUrl }: { report: EscalationReport; title: string; jiraBaseUrl?: string }) {
  const [open, setOpen] = useState(false);
  const dq = report.dataQuality;
  const summary = [
    dq.notSpecifiedCount && `${dq.notSpecifiedCount} escalated, no destination`,
    dq.fcrYesWithDestinationCount && `${dq.fcrYesWithDestinationCount} FCR = Yes with a destination`,
    dq.unknownCount && `${dq.unknownCount} unknown FCR`,
  ].filter(Boolean);
  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className={cn("w-4 h-4", summary.length ? "text-amber-600" : "text-neutral-300")} />
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          <span className="text-xs text-neutral-500">{summary.length ? summary.join(" · ") : "FCR and Ticket Escalation agree on every ticket."}</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-5 text-sm animate-dropdown-in">
          <ul className="text-xs text-neutral-600 flex flex-col gap-1">
            <li>
              <span className="font-medium text-neutral-800">Escalated, no destination</span> — FCR = No but Ticket Escalation is blank or only N/A/CA/SE.
              Counted in the rate, shown as &quot;Not specified&quot;.
            </li>
            <li>
              <span className="font-medium text-neutral-800">FCR = Yes with a destination</span> — may be a consult that didn&apos;t stop first-contact
              resolution. The FCR value is kept as recorded (counts as not escalated).
            </li>
            <li>
              <span className="font-medium text-neutral-800">Unknown FCR</span> — blank FCR value; left out of the rate, same as the FCR page.
            </li>
          </ul>
          {dq.notSpecified.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold text-neutral-800 mb-1">Escalated, no destination</p>
              <TicketRows tickets={dq.notSpecified} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
            </div>
          )}
          {dq.fcrYesWithDestination.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold text-neutral-800 mb-1">FCR = Yes with a destination</p>
              <TicketRows tickets={dq.fcrYesWithDestination} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
