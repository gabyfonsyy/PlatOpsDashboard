"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { AutomatedTicketsReport } from "@/lib/automated-tickets";
import { useTheme } from "@/components/theme/ThemeProvider";
import { automatedCopy } from "@/lib/automated-view";
import { fmtDays, fmtDur } from "@/lib/review-wait-view";
import { formatManilaDate, formatNumber, formatPercent } from "@/lib/format";
import { vsPreviousTrend } from "@/lib/period-trend";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { GrainToggle } from "@/components/dashboard/ReviewWaitTrendChart";
import { useLabelPrefs, normalizeLabel } from "@/components/dashboard/LabelPrefsContext";
import { persistIncludeBlankCookie } from "@/lib/automation-labels";
import { cn } from "@/lib/utils";

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

function JiraLink({ issueKey, jiraBaseUrl }: { issueKey: string; jiraBaseUrl?: string }) {
  return jiraBaseUrl ? (
    <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
      {issueKey}
    </a>
  ) : (
    <>{issueKey}</>
  );
}

/**
 * The Automated Tickets deep-dive body, in the Review Wait page's hierarchy: big picture -> what
 * should I know -> trend -> what's being automated -> automated vs manual -> who picks them up ->
 * (the label editors + ticket list, passed in as `panel`) -> data quality. Gaby's View changes
 * wording only (lib/automated-view.ts).
 *
 * `breakdowns` and `panel` arrive as already-rendered slots so the server-only breakdown helpers
 * never get pulled into this client bundle.
 */
export function AutomatedDeepDive({
  report,
  jiraBaseUrl,
  breakdowns,
  panel,
}: {
  report: AutomatedTicketsReport;
  jiraBaseUrl?: string;
  breakdowns: React.ReactNode;
  panel: React.ReactNode;
}) {
  const { theme } = useTheme();
  const copy = automatedCopy(theme);
  const c = report.comparison;
  const b = report.baseline;
  const vm = report.vsManual;

  const baselineText =
    b.share === null
      ? undefined
      : {
          label: `Baseline (${b.periodLabel}): ${formatPercent(b.share)}${b.source === "live-baseline" ? " · computed live" : ""}`,
        };

  return (
    <div className="flex flex-col gap-8">
      {/* ============================================================ 1 · BIG PICTURE */}
      <Section title={copy.bigPicture}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label={copy.shareLabel}
            value={formatPercent(report.automatedShare)}
            sublabel={`${formatNumber(report.automatedCount)} of ${formatNumber(report.resolvedInPeriod)} resolved`}
            trend={vsPreviousTrend(report.automatedShare, c?.automatedShare, { better: "higher", mode: "pts" })}
            baseline={baselineText}
            tooltip="Automated tickets ÷ every ticket resolved in the period (Archived/Rejected stay in the denominator). Higher is better. The baseline is the same share over Q1+Q2 2026."
          />
          <MetricCard
            label={copy.countLabel}
            value={formatNumber(report.automatedCount)}
            sublabel={`${formatNumber(report.botOwnedCount)} bot-owned · ${formatNumber(report.includedByLabelOnlyCount)} by label${report.includeBlank ? ` · ${formatNumber(report.blankSeCount)} blank SE` : ""}`}
            trend={vsPreviousTrend(report.automatedCount, c?.automatedCount, { better: "neutral" })}
            tooltip="Bot-owned = Assigned SE is the automation account. By label = a person is the Assigned SE but the ticket carries a catalogued automation label."
          />
          <MetricCard
            label={copy.leadLabel}
            value={`${fmtDays(report.overall.leadMedianMinutes)} days`}
            sublabel={report.overall.leadAvgMinutes === null ? undefined : `${fmtDur(report.overall.leadMedianMinutes)} · avg ${fmtDur(report.overall.leadAvgMinutes)}`}
            tooltip="Created → resolved, median across automated tickets. These spans are heavily right-skewed, so the median leads and the average sits beside it."
          />
          <MetricCard
            label={copy.cycleLabel}
            value={`${fmtDays(report.overall.cycleMedianMinutes)} days`}
            sublabel={report.overall.cycleAvgMinutes === null ? undefined : `${fmtDur(report.overall.cycleMedianMinutes)} · avg ${fmtDur(report.overall.cycleAvgMinutes)}`}
            tooltip={`${report.cycleTimeDescription} Median across automated tickets.`}
          />
        </div>
        <IncludeBlankToggle on={report.includeBlank} untaggedCount={report.dataQuality.untaggedCount} />
        <p className="text-xs text-neutral-500">
          {c && (
            <>
              Previous period: <span className="font-medium text-neutral-700">{formatPercent(c.automatedShare)}</span> ({formatNumber(c.automatedCount)} of{" "}
              {formatNumber(c.resolvedInPeriod)}).{" "}
            </>
          )}
          {report.excludedByStatusCount > 0 && <>{formatNumber(report.excludedByStatusCount)} automated {report.excludedStatuses.join("/")} tickets left out. </>}
          {!report.includeBlank && report.dataQuality.untaggedCount > 0 && (
            <span className="text-amber-700">{formatNumber(report.dataQuality.untaggedCount)} untagged tickets aren&apos;t counted — see {copy.dataQuality}.</span>
          )}
        </p>
      </Section>

      <InsightsPanel insights={report.insights} positiveHighlights={[]} title={copy.whatShouldIKnow} />

      {/* ============================================================ 2 · TREND */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2>{copy.trend}</h2>
          <GrainToggle active={report.grain} />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
          <div className="xl:col-span-3 min-w-0">
            <TrendChart report={report} title={copy.trendChart} />
          </div>
          <div className="xl:col-span-2 min-w-0">
            <LabelTrendCard report={report} title={copy.labelTrend} caveat={copy.labelTrendCaveat} />
          </div>
        </div>
      </section>

      {/* ============================================================ 3 · WHAT'S BEING AUTOMATED */}
      <Section title={copy.whatIsIt}>{breakdowns}</Section>

      {/* ============================================================ 4 · AUTOMATED VS MANUAL */}
      <Section title={copy.vsManual} subtitle={copy.vsManualCaveat}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            label={copy.avoidedLabel}
            value={vm.avoided.minutes === null ? "—" : `${fmtDays(vm.avoided.minutes)} days`}
            sublabel={
              vm.avoided.tickets === 0
                ? "No bot-owned tickets this period"
                : `${formatNumber(vm.avoided.pricedTickets)} of ${formatNumber(vm.avoided.tickets)} bot-owned tickets priced${vm.avoided.minutes !== null ? ` · ${fmtDur(vm.avoided.minutes)}` : ""}`
            }
            tooltip="An ESTIMATE: each bot-owned ticket priced at the median manual cycle time for its issue type, summed. Calendar time, not effort hours — read it as scale, not as hours saved. Issue types with fewer than 5 manual tickets aren't priced."
          />
          <MetricCard
            label={copy.absorbedLabel}
            value={vm.absorbed.cycleMinutes === null ? "—" : `${fmtDays(vm.absorbed.cycleMinutes)} days`}
            sublabel={
              vm.absorbed.tickets === 0
                ? "No automation-labelled tickets owned by a person"
                : `${formatNumber(vm.absorbed.tickets)} tickets · avg ${fmtDur(vm.absorbed.avgCycleMinutes)} each`
            }
            tooltip="Total cycle time on tickets an automation raised (catalogued label) but a person owns as Assigned SE. Calendar time."
          />
        </div>
        <VsManualTable report={report} />
      </Section>

      {/* ============================================================ 5 · WHO PICKS THEM UP */}
      <Section title={copy.pickers} subtitle={copy.pickersCaveat}>
        <PickersTable report={report} empty={copy.noPickers} />
      </Section>

      {panel}

      <DataQualityPanel report={report} title={copy.dataQuality} untaggedTitle={copy.untaggedTitle} candidatesTitle={copy.candidatesTitle} jiraBaseUrl={jiraBaseUrl} />
    </div>
  );
}

// ------------------------------------------------------------------------------ Include-blank toggle

/**
 * Opt-in to the pre-2026-10-01 definition: count a blank Assigned SE as automated. Part of the
 * DEFINITION (server-side, cookie-backed, like the label catalogue) — it moves the share, the
 * scorecard, the trend and the baseline, so it writes the cookie and re-renders from the server.
 */
function IncludeBlankToggle({ on, untaggedCount }: { on: boolean; untaggedCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 text-xs text-neutral-600 w-fit cursor-pointer select-none">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          persistIncludeBlankCookie(e.target.checked);
          startTransition(() => router.refresh());
        }}
        className="accent-sprout-600"
      />
      <span>
        Include tickets with a blank Assigned SE
        <span className="text-neutral-400">
          {" "}
          ({formatNumber(untaggedCount)} this period) — off by default, since most are tagging gaps rather than automation. Applies to the
          Team Stats card and baseline too.
        </span>
      </span>
      {pending && <Loader2 className="w-3 h-3 animate-spin text-sprout-700" />}
    </label>
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

/** 'YYYY-MM-DD' -> "Jul 15", 'YYYY-MM' -> "Jul 2026" — same as ReviewWaitTrendChart's. */
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

function TrendChart({ report, title }: { report: AutomatedTicketsReport; title: string }) {
  const data = report.trend.map((t) => ({ ...t, sharePct: t.share === null ? null : Math.round(t.share * 1000) / 10 }));
  const hasData = report.trend.some((t) => t.resolved > 0);
  const baselinePct = report.baseline.share === null ? null : Math.round(report.baseline.share * 1000) / 10;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        <p className="text-xs text-neutral-400">
          Bars: automated tickets · Line: share of resolved{baselinePct !== null && ` · baseline ${baselinePct}%`}
        </p>
      </div>
      {!hasData ? (
        <p className="text-sm text-neutral-400 py-10 text-center">Nothing resolved in this period yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--n-200))" />
            <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" />
            <YAxis yAxisId="n" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" allowDecimals={false} width={34} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11, fill: "rgb(var(--n-500))" }} stroke="rgb(var(--n-300))" width={40} unit="%" />
            <Tooltip
              labelFormatter={formatBucketLabel}
              formatter={(value: number, name: string) => [name === "Share" ? (value === null ? "—" : `${value}%`) : value, name]}
              contentStyle={tooltipStyle}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="n" dataKey="botOwned" name="Bot-owned" stackId="a" fill="rgb(var(--a-500))" />
            <Bar yAxisId="n" dataKey="labelOnly" name="By label" stackId="a" fill="rgb(var(--a-200))" radius={report.includeBlank ? undefined : [3, 3, 0, 0]} />
            {report.includeBlank && <Bar yAxisId="n" dataKey="blankSe" name="Blank SE" stackId="a" fill="rgb(var(--n-300))" radius={[3, 3, 0, 0]} />}
            <Line yAxisId="pct" type="monotone" dataKey="sharePct" name="Share" stroke="rgb(var(--n-700))" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function LabelTrendCard({ report, title, caveat }: { report: AutomatedTicketsReport; title: string; caveat: string }) {
  const { hiddenSet } = useLabelPrefs();
  const rows = useMemo(() => report.labelTrend.filter((r) => !hiddenSet.has(normalizeLabel(r.label))).slice(0, 12), [report.labelTrend, hiddenSet]);
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">{caveat}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-2.5">Label</th>
            <th className="px-4 py-2.5 text-right">Previous</th>
            <th className="px-4 py-2.5 text-right">Now</th>
            <th className="px-4 py-2.5 text-right">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                {report.comparison ? "No labelled automated tickets in either period." : "No labelled automated tickets in this period."}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label}>
                <td className="px-4 py-2">
                  <span className="text-neutral-900">{r.label}</span>
                  {r.known && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-sprout-50 text-sprout-700 rounded px-1 py-0.5">known</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{r.previous}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-neutral-900">{r.current}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums", r.delta > 0 ? "text-emerald-700" : r.delta < 0 ? "text-red-600" : "text-neutral-400")}>
                  {r.delta > 0 ? `+${r.delta}` : r.delta === 0 ? "—" : r.delta}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Automated vs manual

function VsManualTable({ report }: { report: AutomatedTicketsReport }) {
  const vm = report.vsManual;
  const Row = ({ label, a, m, strong }: { label: string; a: typeof vm.automated; m: typeof vm.manual; strong?: boolean }) => (
    <tr className={strong ? "bg-neutral-50/60" : undefined}>
      <td className={cn("px-4 py-2.5 whitespace-nowrap align-top", strong ? "font-semibold text-neutral-900" : "text-neutral-900")}>{label}</td>
      <td className="px-4 py-2.5 text-right tabular-nums align-top">{formatNumber(a.tickets)}</td>
      <td className="px-4 py-2.5 whitespace-nowrap align-top"><DurationCell minutes={a.leadMedianMinutes} strong /></td>
      <td className="px-4 py-2.5 whitespace-nowrap align-top"><DurationCell minutes={a.cycleMedianMinutes} /></td>
      <td className="px-4 py-2.5 text-right tabular-nums align-top border-l border-neutral-100">{formatNumber(m.tickets)}</td>
      <td className="px-4 py-2.5 whitespace-nowrap align-top"><DurationCell minutes={m.leadMedianMinutes} strong /></td>
      <td className="px-4 py-2.5 whitespace-nowrap align-top"><DurationCell minutes={m.cycleMedianMinutes} /></td>
    </tr>
  );
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">Median lead and cycle time, by issue type</h3>
        <p className="text-xs text-neutral-400 mt-0.5">Only issue types that had automated tickets this period. Medians, because a few long-parked tickets drag the mean.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 pt-2.5 pb-1" />
            <th colSpan={3} className="px-4 pt-2.5 pb-1 text-sprout-700">Automated</th>
            <th colSpan={3} className="px-4 pt-2.5 pb-1 border-l border-neutral-200">Manual</th>
          </tr>
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 pb-2.5 pt-1">Issue Type</th>
            <th className="px-4 pb-2.5 pt-1 text-right">Tickets</th>
            <th className="px-4 pb-2.5 pt-1">Lead</th>
            <th className="px-4 pb-2.5 pt-1">Cycle</th>
            <th className="px-4 pb-2.5 pt-1 text-right border-l border-neutral-200">Tickets</th>
            <th className="px-4 pb-2.5 pt-1">Lead</th>
            <th className="px-4 pb-2.5 pt-1">Cycle</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {vm.automated.tickets === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">No automated tickets in this period.</td>
            </tr>
          ) : (
            <>
              <Row label="All tickets" a={vm.automated} m={vm.manual} strong />
              {vm.byIssueType.map((r) => (
                <Row key={r.issueType} label={r.issueType} a={r.automated} m={r.manual} />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Pickers

function PickersTable({ report, empty }: { report: AutomatedTicketsReport; empty: string }) {
  const max = report.pickers.reduce((m, p) => Math.max(m, p.tickets), 0);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Assigned SE</th>
            <th className="px-4 py-3 text-right">Tickets</th>
            <th className="px-4 py-3 text-right w-20">Share</th>
            <th className="px-4 py-3">Median Lead</th>
            <th className="px-4 py-3">Avg Cycle</th>
            <th className="px-4 py-3">Top automation labels</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {report.pickers.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">{empty}</td>
            </tr>
          ) : (
            report.pickers.map((p) => (
              <tr key={p.name}>
                <td className="px-4 py-2.5">
                  <span className="text-neutral-900">{p.name}</span>
                  <span className="block mt-1 h-1 rounded-full bg-sprout-100 overflow-hidden">
                    <span className="block h-full bg-sprout-500" style={{ width: max ? `${Math.max(2, (p.tickets / max) * 100)}%` : "0%" }} />
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums align-top">{formatNumber(p.tickets)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-400 align-top">{formatPercent(p.share, 0)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap align-top"><DurationCell minutes={p.leadMedianMinutes} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap align-top"><DurationCell minutes={p.cycleAvgMinutes} /></td>
                <td className="px-4 py-2.5 text-xs text-neutral-500 align-top">{p.topLabels.join(", ") || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ Data quality

function DataQualityPanel({
  report,
  title,
  untaggedTitle,
  candidatesTitle,
  jiraBaseUrl,
}: {
  report: AutomatedTicketsReport;
  title: string;
  untaggedTitle: string;
  candidatesTitle: string;
  jiraBaseUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const { hiddenSet } = useLabelPrefs();
  const dq = report.dataQuality;
  const candidates = dq.candidateLabels.filter((l) => !hiddenSet.has(normalizeLabel(l.label)));
  const summary = [
    dq.untaggedCount && `${dq.untaggedCount} untagged`,
    candidates.length && `${candidates.length} uncatalogued bot label${candidates.length === 1 ? "" : "s"}`,
    dq.excludedByStatusCount && `${dq.excludedByStatusCount} automated ${report.excludedStatuses.join("/")} left out`,
  ].filter(Boolean);

  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className={cn("w-4 h-4", dq.untaggedCount || candidates.length ? "text-amber-600" : "text-neutral-300")} />
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          <span className="text-xs text-neutral-500">{summary.length ? summary.join(" · ") : "Nothing to fix in this period."}</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-5 text-sm animate-dropdown-in">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">{untaggedTitle}</h3>
            <p className="text-xs text-neutral-500 mt-0.5 mb-2">
              Resolved with a blank Assigned SE and no automation signal
              {report.includeBlank ? " — counted as automated right now (toggle above), listed here so they can still be tagged" : ", so they count as neither automated nor anyone's work"}. &quot;Jira
              assignee&quot; shows only when it names someone other than the reporter — the likely person to tag.
              {dq.untaggedExcludedByStatus > 0 && ` ${dq.untaggedExcludedByStatus} more were ${report.excludedStatuses.join("/")} (not worked, so not listed).`}
            </p>
            {dq.untagged.length === 0 ? (
              <p className="text-xs text-neutral-400">None this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] text-neutral-500 bg-neutral-50 border-b border-neutral-200">
                      <th className="px-3 py-2">Ticket</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Reporter</th>
                      <th className="px-3 py-2">Jira assignee</th>
                      <th className="px-3 py-2">Resolved</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {dq.untagged.map((t) => (
                      <tr key={t.issueKey}>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">
                          <JiraLink issueKey={t.issueKey} jiraBaseUrl={jiraBaseUrl} />
                          <span className="block text-neutral-400 font-normal">{t.issueType}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.status}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.reporter || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.jiraAssignee || <span className="text-neutral-300">—</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatManilaDate(t.resolvedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dq.untaggedCount > dq.untagged.length && (
                  <p className="text-[11px] text-neutral-400 mt-1">Most recent {dq.untagged.length} of {dq.untaggedCount}.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-neutral-900">{candidatesTitle}</h3>
            <p className="text-xs text-neutral-500 mt-0.5 mb-2">
              Labels on tickets the automation account owns that aren&apos;t in Known Automation Labels (your Hidden Labels are left out). &quot;All
              tickets&quot; is how many resolved tickets carry it in this period — roughly what cataloguing it would pull in.
            </p>
            {candidates.length === 0 ? (
              <p className="text-xs text-neutral-400">None — every label on bot-owned tickets is catalogued or hidden.</p>
            ) : (
              <table className="w-full text-xs max-w-xl">
                <thead>
                  <tr className="text-left text-[11px] text-neutral-500 bg-neutral-50 border-b border-neutral-200">
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2 text-right">Bot-owned tickets</th>
                    <th className="px-3 py-2 text-right">All tickets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {candidates.map((l) => (
                    <tr key={l.label}>
                      <td className="px-3 py-2">{l.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.botTickets}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.allTickets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-xs text-neutral-500">
            <span className="font-medium text-neutral-800">Status exclusions</span> — {formatNumber(dq.excludedByStatusCount)} automated{" "}
            {report.excludedStatuses.join(" and ")} tickets are left out of the count and the lead/cycle numbers (nobody did the work), but stay in the
            share&apos;s denominator like every other Team Stats rate.
          </p>
        </div>
      )}
    </div>
  );
}
