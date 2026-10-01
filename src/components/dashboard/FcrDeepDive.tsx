"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { FcrDeepDiveReport, FcrSegmentDimension, FcrSegmentRow, FcrTicket, FcrValue } from "@/lib/fcr";
import { useTheme } from "@/components/theme/ThemeProvider";
import { fcrCopy, SEGMENT_LABELS } from "@/lib/fcr-view";
import { fmtDur } from "@/lib/review-wait-view";
import { formatManilaDate, formatNumber, formatPercent } from "@/lib/format";
import { vsPreviousTrend } from "@/lib/period-trend";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { GrainToggle } from "@/components/dashboard/ReviewWaitTrendChart";
import { cn } from "@/lib/utils";

const pct = (n: number | null | undefined, d = 1) => formatPercent(n ?? null, d);
const segLabel = (dim: FcrSegmentDimension, key: string) => (dim === "dow" ? key.replace(/^\d+ · /, "") : key);

function Section({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="text-sm text-neutral-500 mt-0.5 max-w-3xl">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Builds a link to this page with some params changed, keeping range/period/issueType/grain. */
function useHref() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (changes: Record<string, string | null>, hash = "#tickets") => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return `${pathname}?${p.toString()}${hash}`;
  };
}

function JiraLink({ issueKey, jiraBaseUrl }: { issueKey: string; jiraBaseUrl?: string }) {
  return jiraBaseUrl ? (
    <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
      {issueKey}
    </a>
  ) : (
    <>{issueKey}</>
  );
}

function PtsDelta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-300">—</span>;
  if (Math.abs(value) < 0.5) return <span className="text-neutral-400">—</span>;
  return (
    <span className={cn("tabular-nums", value > 0 ? "text-emerald-700" : "text-red-600")}>
      {value > 0 ? "↑" : "↓"} {Math.abs(value)} pts
    </span>
  );
}

/**
 * FCR Rate deep-dive, in the brief's Gaby hierarchy: How are we doing? → What's driving it? →
 * Where are we losing first-contact resolution? → What keeps coming back? → Is it changing? →
 * tickets → data quality. Gaby's View changes wording only (lib/fcr-view.ts).
 */
export function FcrDeepDive({ report, jiraBaseUrl, teamSlug, query }: { report: FcrDeepDiveReport; jiraBaseUrl?: string; teamSlug: string; query: string }) {
  const { theme } = useTheme();
  const copy = fcrCopy(theme);
  const c = report.current;
  const p = report.previous;

  return (
    <div className="flex flex-col gap-8">
      {/* ============================================================ 1 · HOW ARE WE DOING? */}
      <Section title={copy.howAreWeDoing}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label={copy.rateLabel}
            value={pct(c.rate)}
            sublabel={`${formatNumber(c.fcr)} / ${formatNumber(c.resolved)} resolved on first contact${report.smallSample ? " · Small sample" : ""}`}
            trend={vsPreviousTrend(c.rate, p?.rate, { better: "higher", mode: "pts" })}
            baseline={report.baseline ? { label: `Previous ${pct(p?.rate)} · Baseline (${report.baseline.periodLabel}) ${pct(report.baseline.rate)}` } : p ? { label: `Previous period ${pct(p.rate)}` } : undefined}
            badge={report.smallSample ? { label: "Small sample", tone: "warning" } : undefined}
            tooltip="Tickets with First Contact Resolution = Yes ÷ tickets resolved in the period with FCR = Yes or No. A blank FCR value is unknown and left out of both sides (see Data quality). The change is in percentage points, not a percent of a percent."
          />
          <MetricCard
            label={copy.resolvedLabel}
            value={formatNumber(c.resolved)}
            sublabel={p ? `previous ${formatNumber(p.resolved)}` : undefined}
            trend={vsPreviousTrend(c.resolved, p?.resolved, { better: "neutral" })}
            tooltip="Tickets resolved in the period with a known FCR value — the rate's denominator."
          />
          <MetricCard
            label={copy.fcrLabel}
            value={formatNumber(c.fcr)}
            sublabel={p ? `previous ${formatNumber(p.fcr)}` : undefined}
            trend={vsPreviousTrend(c.fcr, p?.fcr, { better: "neutral" })}
            tooltip="Tickets with First Contact Resolution = Yes."
          />
          <MetricCard
            label={copy.nonFcrLabel}
            value={formatNumber(c.nonFcr)}
            sublabel={p ? `previous ${formatNumber(p.nonFcr)}` : undefined}
            trend={vsPreviousTrend(c.nonFcr, p?.nonFcr, { better: "lower" })}
            tooltip="Tickets with First Contact Resolution = No — they needed another contact, follow-up or another team."
          />
        </div>

        <SplitCard report={report} title={copy.splitTitle} />
        <RelatedStrip report={report} title={copy.relatedTitle} caveat={copy.relatedCaveat} teamSlug={teamSlug} query={query} />
      </Section>

      <InsightsPanel insights={report.insights} positiveHighlights={[]} title={copy.whatShouldIKnow} />

      {/* ============================================================ 2 · WHAT'S DRIVING IT? */}
      <Section title={copy.whatsDriving} subtitle={copy.whatsDrivingCaveat}>
        <SegmentExplorer report={report} />
      </Section>

      {/* ============================================================ 3 · WHERE ARE WE LOSING IT? */}
      <Section title={copy.whereLosing} subtitle={copy.whereLosingCaveat}>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
          <div className="xl:col-span-3 min-w-0">
            <LosingTable report={report} />
          </div>
          <div className="xl:col-span-2 min-w-0">
            <TargetsCard report={report} title={copy.whereWent} />
          </div>
        </div>
      </Section>

      {/* ============================================================ 4 · WHAT KEEPS COMING BACK? */}
      <Section title={copy.whatKeepsComingBack} subtitle={copy.whatKeepsComingBackCaveat}>
        <OpportunityTable report={report} />
      </Section>

      {/* ============================================================ 5 · IS IT CHANGING? */}
      <Section title={copy.isItChanging} right={<GrainToggle active={report.grain} />}>
        <TrendChart report={report} />
      </Section>

      {/* ============================================================ 6 · TICKETS */}
      <TicketsTable report={report} title={copy.tickets} jiraBaseUrl={jiraBaseUrl} />

      <DataQualityPanel report={report} title={copy.dataQuality} jiraBaseUrl={jiraBaseUrl} />
    </div>
  );
}

// ------------------------------------------------------------------------------ Split + related

function SplitBar({ fcr, nonFcr }: { fcr: number; nonFcr: number }) {
  const total = fcr + nonFcr;
  const w = total ? (fcr / total) * 100 : 0;
  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-neutral-100">
      <div className="bg-sprout-500 transition-all" style={{ width: `${w}%` }} />
      <div className="bg-sprout-200 transition-all" style={{ width: `${total ? 100 - w : 0}%` }} />
    </div>
  );
}

function SplitCard({ report, title }: { report: FcrDeepDiveReport; title: string }) {
  const href = useHref();
  const c = report.current;
  const p = report.previous;
  const Row = ({ label, counts }: { label: string; counts: { fcr: number; nonFcr: number; resolved: number } }) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-xs text-neutral-500">
        <span>{label}</span>
        <span className="tabular-nums">{formatNumber(counts.resolved)} resolved</span>
      </div>
      <SplitBar fcr={counts.fcr} nonFcr={counts.nonFcr} />
    </div>
  );
  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <div className="flex gap-5 text-sm">
          <Link href={href({ fcr: "Yes", seg: null })} className="group">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-sprout-500 mr-1.5" />
            <span className="font-semibold text-neutral-900 tabular-nums">{formatNumber(c.fcr)}</span>{" "}
            <span className="text-neutral-500 group-hover:text-sprout-700">first contact ({pct(c.rate)})</span>
          </Link>
          <Link href={href({ fcr: "No", seg: null })} className="group">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-sprout-200 mr-1.5" />
            <span className="font-semibold text-neutral-900 tabular-nums">{formatNumber(c.nonFcr)}</span>{" "}
            <span className="text-neutral-500 group-hover:text-sprout-700">follow-up ({pct(c.resolved ? c.nonFcr / c.resolved : null)})</span>
          </Link>
        </div>
      </div>
      <Row label="This period" counts={c} />
      {p && <Row label="Previous period" counts={p} />}
      {p && (
        <p className="text-xs text-neutral-500">
          What moved: first-contact tickets <strong className="text-neutral-800">{p.fcr} → {c.fcr}</strong> ({c.fcr - p.fcr >= 0 ? "+" : ""}
          {c.fcr - p.fcr}), follow-ups <strong className="text-neutral-800">{p.nonFcr} → {c.nonFcr}</strong> ({c.nonFcr - p.nonFcr >= 0 ? "+" : ""}
          {c.nonFcr - p.nonFcr}), total <strong className="text-neutral-800">{p.resolved} → {c.resolved}</strong>.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-xl font-semibold text-neutral-900 tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-neutral-400 mt-0.5">{sub}</p>}
    </>
  );
  const cls = "rounded-2xl bg-neutral-50 px-4 py-3 transition-transform hover:-translate-y-0.5 block";
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-neutral-100")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function RelatedStrip({ report, title, caveat, teamSlug, query }: { report: FcrDeepDiveReport; title: string; caveat: string; teamSlug: string; query: string }) {
  const r = report.related;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400">{caveat}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Tile label="FCR Rate" value={pct(report.current.rate)} sub={`${formatNumber(report.current.resolved)} tickets`} />
        <Tile
          label="Escalation Rate"
          value={pct(r.escalationRate)}
          sub={`${formatNumber(r.escalated)} escalated`}
          href={`/${teamSlug}/escalation?${query}`}
        />
        <Tile label="Median Lead Time" value={r.leadMedianMinutes === null ? "—" : fmtDur(r.leadMedianMinutes)} sub="created → resolved" href={`/${teamSlug}/lead-cycle-time?${query}`} />
        <Tile label="Avg Cycle Time" value={r.cycleAvgMinutes === null ? "—" : fmtDur(r.cycleAvgMinutes)} sub="same tickets" href={`/${teamSlug}/lead-cycle-time?${query}`} />
        <Tile
          label="Archived / Rejected"
          value={formatNumber(r.archivedRejected.count)}
          sub={`${formatNumber(r.archivedRejected.fcrYes)} marked FCR = Yes · included`}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Segments

const DRIVER_DIMS: FcrSegmentDimension[] = ["se", "issueType", "reporter", "priority", "product", "month", "week", "dow"];

function DimTabs({ dims, active, onChange }: { dims: FcrSegmentDimension[]; active: FcrSegmentDimension; onChange: (d: FcrSegmentDimension) => void }) {
  return (
    <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1 w-fit flex-wrap">
      {dims.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            active === d ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          )}
        >
          {SEGMENT_LABELS[d]}
        </button>
      ))}
    </div>
  );
}

function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums w-12 text-right font-medium text-neutral-900">{pct(rate)}</span>
      <span className="flex-1 min-w-[60px] h-1.5 rounded-full bg-sprout-100 overflow-hidden">
        <span className="block h-full bg-sprout-500" style={{ width: `${(rate ?? 0) * 100}%` }} />
      </span>
    </span>
  );
}

function SegmentExplorer({ report }: { report: FcrDeepDiveReport }) {
  const [dim, setDim] = useState<FcrSegmentDimension>("se");
  const [minSample, setMinSample] = useState(false);
  const href = useHref();
  const isTime = dim === "month" || dim === "week" || dim === "dow";
  const all = report.segments[dim];
  const rows = minSample ? all.filter((r) => !r.smallSample) : all;
  const hiddenCount = all.length - rows.length;

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 flex-wrap">
        <DimTabs dims={DRIVER_DIMS} active={dim} onChange={setDim} />
        <label className="inline-flex items-center gap-2 text-xs text-neutral-600 cursor-pointer select-none">
          <input type="checkbox" checked={minSample} onChange={(e) => setMinSample(e.target.checked)} className="accent-sprout-600" />
          Hide rows under 10 tickets{minSample && hiddenCount > 0 && <span className="text-neutral-400">({hiddenCount} hidden)</span>}
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">{SEGMENT_LABELS[dim]}</th>
            <th className="px-4 py-2.5 text-right">Resolved</th>
            <th className="px-4 py-2.5 text-right">FCR</th>
            <th className="px-4 py-2.5 text-right">Non-FCR</th>
            <th className="px-4 py-2.5 w-48">FCR Rate</th>
            <th className="px-4 py-2.5 text-right">Share of volume</th>
            {!isTime && <th className="px-4 py-2.5 text-right">Previous</th>}
            {!isTime && <th className="px-4 py-2.5 text-right">Change</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">
                Nothing to show.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className={cn("hover:bg-neutral-50/70 transition-colors", r.smallSample && "text-neutral-500")}>
                <td className="px-4 py-2">
                  <Link href={href({ seg: `${dim}:${r.key}`, fcr: null })} className="hover:text-sprout-700 hover:underline" title="Show these tickets below">
                    {segLabel(dim, r.key)}
                  </Link>
                  {r.smallSample && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 rounded px-1 py-0.5">small</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.resolved)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.fcr)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.nonFcr)}</td>
                <td className="px-4 py-2">
                  <RateBar rate={r.rate} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-400">{pct(r.volumeShare)}</td>
                {!isTime && (
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                    {r.previous && r.previous.resolved > 0 ? `${pct(r.previous.rate)} · ${r.previous.resolved}` : "—"}
                  </td>
                )}
                {!isTime && (
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <PtsDelta value={r.deltaPts} />
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Where are we losing it

const LOSING_DIMS: FcrSegmentDimension[] = ["issueType", "product", "reporter", "se", "priority"];

function LosingTable({ report }: { report: FcrDeepDiveReport }) {
  const [dim, setDim] = useState<FcrSegmentDimension>("issueType");
  const href = useHref();
  const rows: FcrSegmentRow[] = useMemo(
    () => report.segments[dim].filter((r) => r.nonFcr > 0).sort((a, b) => b.nonFcr - a.nonFcr || a.key.localeCompare(b.key)).slice(0, 12),
    [report.segments, dim]
  );
  const max = rows[0]?.nonFcr ?? 0;
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <DimTabs dims={LOSING_DIMS} active={dim} onChange={setDim} />
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">{SEGMENT_LABELS[dim]}</th>
            <th className="px-4 py-2.5 text-right">Non-FCR</th>
            <th className="px-4 py-2.5 text-right">Share of follow-ups</th>
            <th className="px-4 py-2.5 text-right">FCR Rate</th>
            <th className="px-4 py-2.5 text-right">Resolved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                No follow-up tickets in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="hover:bg-neutral-50/70 transition-colors">
                <td className="px-4 py-2">
                  <Link href={href({ seg: `${dim}:${r.key}`, fcr: "No" })} className="text-neutral-900 hover:text-sprout-700 hover:underline" title="Show these follow-up tickets below">
                    {r.key}
                  </Link>
                  <span className="block mt-1 h-1 rounded-full bg-neutral-100 overflow-hidden">
                    <span className="block h-full bg-sprout-400" style={{ width: max ? `${Math.max(2, (r.nonFcr / max) * 100)}%` : "0%" }} />
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium align-top">{formatNumber(r.nonFcr)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500 align-top">{pct(r.nonFcrShare, 0)}</td>
                <td className="px-4 py-2 text-right tabular-nums align-top">{pct(r.rate)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500 align-top">
                  {formatNumber(r.resolved)}
                  {r.smallSample && <span className="ml-1 text-[10px] text-amber-700">small</span>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TargetsCard({ report, title }: { report: FcrDeepDiveReport; title: string }) {
  const rows = report.nonFcrTargets;
  const max = rows[0]?.count ?? 0;
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">
        Ticket Escalation on follow-up tickets — usually the &quot;why&quot;. A ticket escalated to two teams counts under both. Some work belongs with
        another team by nature.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No follow-up tickets in this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.slice(0, 10).map((t) => (
            <li key={t.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-800">{t.key}</span>
                <span className="tabular-nums text-neutral-500">
                  {formatNumber(t.count)} · {pct(t.share, 0)}
                </span>
              </div>
              <span className="block mt-1 h-1 rounded-full bg-neutral-100 overflow-hidden">
                <span className="block h-full bg-sprout-400" style={{ width: max ? `${(t.count / max) * 100}%` : "0%" }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ Opportunities

function OpportunityTable({ report }: { report: FcrDeepDiveReport }) {
  const rows = report.opportunities;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">Product · Label</th>
            <th className="px-4 py-2.5 text-right">Resolved</th>
            <th className="px-4 py-2.5 text-right">Non-FCR</th>
            <th className="px-4 py-2.5 text-right" title="Follow-ups beyond what the team-wide FCR rate would predict for this many tickets">
              Above norm
            </th>
            <th className="px-4 py-2.5 text-right">FCR Rate</th>
            <th className="px-4 py-2.5 text-right">Previous</th>
            <th className="px-4 py-2.5">Mostly goes to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                No product + label combination with 10+ tickets has follow-ups this period.
              </td>
            </tr>
          ) : (
            rows.map((o) => (
              <tr key={`${o.product}-${o.label}`} className="hover:bg-neutral-50/70 transition-colors">
                <td className="px-4 py-2">
                  <span className="text-neutral-900">{o.product}</span> <span className="text-neutral-400">·</span>{" "}
                  <span className="text-neutral-700">{o.label}</span>
                  {o.consistentlyLower && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-violet-50 text-violet-700 rounded px-1 py-0.5" title="Below the team rate this period and last">
                      recurring
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(o.resolved)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{formatNumber(o.nonFcr)}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums", o.excessNonFcr > 0 ? "text-red-600" : "text-neutral-400")}>
                  {o.excessNonFcr > 0 ? `+${o.excessNonFcr}` : o.excessNonFcr}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(o.rate)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{pct(o.previousRate)}</td>
                <td className="px-4 py-2 text-neutral-600">{o.topTarget ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Trend

const tooltipStyle = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--line))",
  borderRadius: 8,
  fontSize: 12,
  color: "rgb(var(--n-900))",
};

function formatBucketLabel(value: string): string {
  const parts = String(value).slice(0, 10).split("-").map(Number);
  if (parts.length >= 3 && !Number.isNaN(parts[2])) {
    const [y, m, d] = parts;
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (parts.length >= 2 && !Number.isNaN(parts[1])) {
    const [y, m] = parts;
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return String(value);
}

function TrendChart({ report }: { report: FcrDeepDiveReport }) {
  const data = report.trend.map((t) => ({ ...t, ratePct: t.rate === null ? null : Math.round(t.rate * 1000) / 10 }));
  const prevPct = report.previous?.rate == null ? null : Math.round(report.previous.rate * 1000) / 10;
  const basePct = report.baseline?.rate == null ? null : Math.round(report.baseline.rate * 1000) / 10;
  if (!report.trend.some((t) => t.resolved > 0)) return <div className="card p-8 text-center text-sm text-neutral-400">Nothing resolved in this period yet.</div>;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm font-medium text-neutral-700">FCR Rate and resolved volume</p>
        <p className="text-xs text-neutral-400">
          Bars: resolved · Line: FCR %{prevPct !== null && ` · dashed: previous period ${prevPct}%`}
          {basePct !== null && ` · dotted: baseline ${basePct}%`}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
          <YAxis yAxisId="n" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={38} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={40} unit="%" />
          <Tooltip
            labelFormatter={formatBucketLabel}
            formatter={(value: number, name: string) => [name === "FCR Rate" ? (value === null ? "—" : `${value}%`) : value, name]}
            contentStyle={tooltipStyle}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="n" dataKey="resolved" name="Resolved" fill="rgb(var(--a-200))" radius={[3, 3, 0, 0]} />
          <Line yAxisId="pct" type="monotone" dataKey="ratePct" name="FCR Rate" stroke="rgb(var(--a-600))" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
          {prevPct !== null && <ReferenceLine yAxisId="pct" y={prevPct} stroke="rgb(var(--n-400))" strokeDasharray="5 4" />}
          {basePct !== null && <ReferenceLine yAxisId="pct" y={basePct} stroke="rgb(var(--n-400))" strokeDasharray="1 3" />}
        </ComposedChart>
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

function TicketRows({ tickets, jiraBaseUrl, assigneeLabel }: { tickets: FcrTicket[]; jiraBaseUrl?: string; assigneeLabel: string }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-neutral-50 border-b border-neutral-200">
        <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wide">
          <th className="px-3 py-2.5">Ticket</th>
          <th className="px-3 py-2.5">FCR</th>
          <th className="px-3 py-2.5">{assigneeLabel}</th>
          <th className="px-3 py-2.5">Reporter</th>
          <th className="px-3 py-2.5">Product</th>
          <th className="px-3 py-2.5">Priority</th>
          <th className="px-3 py-2.5">Created</th>
          <th className="px-3 py-2.5" title="First moved out of Backlog/To Do — the closest synced field to first response">
            First contact
          </th>
          <th className="px-3 py-2.5">Resolved</th>
          <th className="px-3 py-2.5">Outcome</th>
          <th className="px-3 py-2.5">Escalated to</th>
          <th className="px-3 py-2.5">Cycle Time</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {tickets.map((t) => (
          <tr key={t.issueKey} className="hover:bg-neutral-50/70 transition-colors">
            <td className="px-3 py-2 whitespace-nowrap font-medium align-top">
              <JiraLink issueKey={t.issueKey} jiraBaseUrl={jiraBaseUrl} />
              <span className="block text-neutral-400 font-normal">{t.issueType}</span>
            </td>
            <td className="px-3 py-2 align-top">
              <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", FCR_TONE[t.fcr])}>{t.fcr}</span>
            </td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.assignedSe || <span className="text-amber-700">(none)</span>}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.reporter || "—"}</td>
            <td className="px-3 py-2 align-top">{t.product}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.priority || "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{formatManilaDate(t.createdAt)}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{t.firstContactAt ? formatManilaDate(t.firstContactAt) : "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">{formatManilaDate(t.resolvedAt)}</td>
            <td className="px-3 py-2 align-top">
              {t.status}
              {t.outcomeReason && <span className="block text-neutral-400">{t.outcomeReason}</span>}
            </td>
            <td className="px-3 py-2 align-top">{t.escalatedTo || <span className="text-neutral-300">—</span>}</td>
            <td className="px-3 py-2 whitespace-nowrap align-top">
              <DurationCell minutes={t.cycleMinutes} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TicketsTable({ report, title, jiraBaseUrl }: { report: FcrDeepDiveReport; title: string; jiraBaseUrl?: string }) {
  const href = useHref();
  const f = report.ticketFilter;
  const chips: { label: string; value: FcrValue | null }[] = [
    { label: "All", value: null },
    { label: "FCR = Yes", value: "Yes" },
    { label: "FCR = No", value: "No" },
    { label: "Unknown", value: "Unknown" },
  ];
  return (
    <section className="card overflow-x-auto" id="tickets">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-2xl">
            Most recently resolved first. The key opens Jira (titles aren&apos;t synced). Interaction counts and resolution channel aren&apos;t in the
            synced data, so &quot;why non-FCR&quot; is read from Escalated to, Outcome and the timestamps.
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {formatNumber(report.tickets.length)} shown
            {report.ticketTotal > report.tickets.length && ` · most recent ${report.tickets.length} of ${formatNumber(report.ticketTotal)}`}
            {f.segment && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-sprout-50 text-sprout-700 px-2 py-0.5">
                {SEGMENT_LABELS[f.segment.dim]}: {segLabel(f.segment.dim, f.segment.key)}
                <Link href={href({ seg: null })} aria-label="Clear segment filter" className="hover:text-sprout-900">
                  <X className="w-3 h-3" />
                </Link>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          {chips.map((ch) => (
            <Link
              key={ch.label}
              href={href({ fcr: ch.value })}
              scroll={false}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                f.fcr === ch.value ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              {ch.label}
            </Link>
          ))}
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

function DataQualityPanel({ report, title, jiraBaseUrl }: { report: FcrDeepDiveReport; title: string; jiraBaseUrl?: string }) {
  const [open, setOpen] = useState(false);
  const dq = report.dataQuality;
  const ar = report.related.archivedRejected;
  const summary = [
    dq.unknownCount && `${dq.unknownCount} unknown FCR`,
    dq.escalatedButFcrYesCount && `${dq.escalatedButFcrYesCount} escalated but FCR = Yes`,
    dq.noButNotEscalatedCount && `${dq.noButNotEscalatedCount} FCR = No, not escalated`,
  ].filter(Boolean);
  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className={cn("w-4 h-4", summary.length ? "text-amber-600" : "text-neutral-300")} />
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          <span className="text-xs text-neutral-500">{summary.length ? summary.join(" · ") : "Every resolved ticket has a consistent FCR value."}</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-5 text-sm animate-dropdown-in">
          <ul className="text-xs text-neutral-600 flex flex-col gap-1">
            <li>
              <span className="font-medium text-neutral-800">Unknown FCR</span> — resolved with a blank First Contact Resolution field. Left out of the rate
              entirely (not counted as Yes or No) — {formatNumber(dq.unknownCount)} this period.
            </li>
            <li>
              <span className="font-medium text-neutral-800">Escalated but FCR = Yes</span> — escalated outside the team yet flagged first-contact; the two
              fields disagree. Correct in Jira.
            </li>
            <li>
              <span className="font-medium text-neutral-800">FCR = No, not escalated</span> — {formatNumber(dq.noButNotEscalatedCount)} tickets needed follow-up
              that stayed in-team (or the flag is wrong).
            </li>
            <li>
              <span className="font-medium text-neutral-800">Archived / Rejected</span> — {formatNumber(ar.count)} resolved this way are included in the rate (
              {formatNumber(ar.fcrYes)} of them FCR = Yes), matching the existing definition and baseline.
            </li>
          </ul>
          {dq.unknownTickets.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold text-neutral-800 mb-1">Unknown FCR</p>
              <TicketRows tickets={dq.unknownTickets} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
            </div>
          )}
          {dq.escalatedButFcrYes.length > 0 && (
            <div className="overflow-x-auto" id="escalated-but-fcr-yes">
              <p className="text-xs font-semibold text-neutral-800 mb-1">Escalated but FCR = Yes</p>
              <TicketRows tickets={dq.escalatedButFcrYes} jiraBaseUrl={jiraBaseUrl} assigneeLabel={report.assigneeLabel} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
