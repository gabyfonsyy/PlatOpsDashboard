"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, Hourglass } from "lucide-react";
import type {
  LongestReviewRow,
  ReviewerRow,
  ReviewQueueHealth,
  SegmentDimension,
  SegmentRow,
  ReviewWaitReport,
} from "@/lib/review-wait";
import { fmtDays, fmtDur, fmtPct, segmentLabel, type ReviewWaitCopy } from "@/lib/review-wait-view";
import { formatManilaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------------------ Sorting

type SortDir = "asc" | "desc";

function useSort<T, K extends string>(rows: T[], initial: K, valueOf: (row: T, key: K) => number | string | null) {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>("desc");
  const sorted = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const va = valueOf(a, key);
      const vb = valueOf(b, key);
      // Nulls ("—") always sink, whichever way the column is sorted.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return dir === "asc" ? cmp : -cmp;
    });
    return out;
    // valueOf is a stable inline accessor per table; rows/key/dir are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir]);
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir(rows.length && typeof valueOf(rows[0], k) === "string" ? "asc" : "desc");
    }
  };
  return { sorted, key, dir, toggle };
}

function SortTh<K extends string>({
  k, label, sort, align = "left", title,
}: {
  k: K;
  label: string;
  sort: { key: K; dir: SortDir; toggle: (k: K) => void };
  align?: "left" | "right";
  title?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={cn("px-3 py-2.5 font-medium whitespace-nowrap", align === "right" && "text-right")} title={title}>
      <button
        onClick={() => sort.toggle(k)}
        className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-neutral-800 transition-colors", active && "text-neutral-800")}
      >
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

/** Days value with the human duration underneath — the page's one duration cell. */
function Dur({ minutes, strong }: { minutes: number | null; strong?: boolean }) {
  if (minutes === null) return <span className="text-neutral-300">—</span>;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={cn("tabular-nums", strong ? "font-semibold text-neutral-900" : "text-neutral-800")}>{fmtDays(minutes)}d</span>
      <span className="text-[11px] text-neutral-400 tabular-nums">{fmtDur(minutes)}</span>
    </span>
  );
}

function SmallSample({ n }: { n: number }) {
  return (
    <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1 py-px" title={`Only ${n} review${n === 1 ? "" : "s"} — too few to read much into.`}>
      n={n}
    </span>
  );
}

/** Thin inline bar, relative to the table's max — enough to eyeball, not a chart. */
function Meter({ value, max }: { value: number | null; max: number }) {
  if (value === null || !max) return null;
  return (
    <span className="block h-1 mt-1 rounded-full bg-neutral-100 overflow-hidden w-20">
      <span className="block h-full rounded-full bg-sprout-400 transition-all duration-500" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </span>
  );
}

function JiraLink({ issueKey, jiraBaseUrl }: { issueKey: string; jiraBaseUrl?: string }) {
  if (!jiraBaseUrl) return <span className="font-medium text-neutral-900">{issueKey}</span>;
  return (
    <a
      href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${issueKey}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:text-sprout-700 transition-colors"
    >
      {issueKey}
      <ExternalLink className="w-3 h-3 opacity-50" />
    </a>
  );
}

const TH_ROW = "text-left text-[11px] text-neutral-500 bg-neutral-50 border-b border-neutral-200";

// ------------------------------------------------------------------------------ Who is waiting?

type ReviewerKey = "name" | "reviews" | "volumeShare" | "avg" | "median" | "p90" | "longest" | "overTarget" | "queueDepth" | "urgent";

export function ReviewWaitReviewerTable({ rows, hasTarget, copy }: { rows: ReviewerRow[]; hasTarget: boolean; copy: ReviewWaitCopy }) {
  const sort = useSort<ReviewerRow, ReviewerKey>(rows, "reviews", (r, k) => {
    switch (k) {
      case "name": return r.name;
      case "reviews": return r.reviews;
      case "volumeShare": return r.volumeShare;
      case "avg": return r.avgMinutes;
      case "median": return r.medianMinutes;
      case "p90": return r.p90Minutes;
      case "longest": return r.longestMinutes;
      case "overTarget": return r.overTargetPct;
      case "queueDepth": return r.avgQueueDepthAtEntry;
      case "urgent": return r.urgentShare;
    }
  });
  const maxReviews = Math.max(0, ...rows.map((r) => r.reviews));

  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-neutral-900">{copy.whoIsWaiting}</h3>
        <p className="text-xs text-neutral-500 mt-1 max-w-3xl">{copy.reviewerCaveat}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={TH_ROW}>
              <SortTh k="name" label="Reviewer" sort={sort} />
              <SortTh k="reviews" label="Reviews" sort={sort} title="Completed review cycles attributed to this reviewer (the assignee when the ticket entered review)." />
              <SortTh k="volumeShare" label="Share" sort={sort} title="Share of the team's completed reviews this period — workload." />
              <SortTh k="avg" label="Avg" sort={sort} />
              <SortTh k="median" label="Median" sort={sort} />
              <SortTh k="p90" label="P90" sort={sort} title="Shown once a reviewer has 10+ reviews." />
              <SortTh k="longest" label="Longest" sort={sort} />
              {hasTarget && <SortTh k="overTarget" label="Over target" sort={sort} />}
              <SortTh k="queueDepth" label="Queue depth" sort={sort} title="Context: on average, how many OTHER reviews were already open when theirs arrived. A deep queue means waits were partly queue conditions." />
              <SortTh k="urgent" label="P1/P2 share" sort={sort} title="Context: share of their reviews on P1/P2 tickets." />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sort.sorted.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-neutral-400">{copy.noData}</td></tr>
            ) : (
              sort.sorted.map((r) => (
                <tr key={r.name} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={cn("font-medium", r.name.startsWith("(") ? "text-neutral-400 italic" : "text-neutral-900")}>{r.name}</span>
                    {r.smallSample && <SmallSample n={r.reviews} />}
                    <span className="block text-[11px] text-neutral-400">{r.tickets} ticket{r.tickets === 1 ? "" : "s"} · {r.distinctSes} SE{r.distinctSes === 1 ? "" : "s"}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.reviews}
                    <Meter value={r.reviews} max={maxReviews} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-600">{fmtPct(r.volumeShare)}</td>
                  <td className="px-3 py-2.5"><Dur minutes={r.avgMinutes} /></td>
                  <td className="px-3 py-2.5"><Dur minutes={r.medianMinutes} strong /></td>
                  <td className="px-3 py-2.5"><Dur minutes={r.p90Minutes} /></td>
                  <td className="px-3 py-2.5"><Dur minutes={r.longestMinutes} /></td>
                  {hasTarget && (
                    <td className="px-3 py-2.5 tabular-nums">
                      <span className={cn((r.overTargetPct ?? 0) >= 0.5 ? "text-red-600" : (r.overTargetPct ?? 0) >= 0.25 ? "text-amber-700" : "text-neutral-700")}>{fmtPct(r.overTargetPct)}</span>
                      <span className="block text-[11px] text-neutral-400">{r.overTargetCount} of {r.reviews}</span>
                    </td>
                  )}
                  <td className="px-3 py-2.5 tabular-nums text-neutral-600">{r.avgQueueDepthAtEntry === null ? "—" : r.avgQueueDepthAtEntry.toFixed(1)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-600">{fmtPct(r.urgentShare)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Queue health

export function ReviewWaitQueueCard({
  queue, targetMinutes, withinTargetPct, copy, jiraBaseUrl,
}: {
  queue: ReviewQueueHealth;
  targetMinutes: number | null;
  withinTargetPct: number | null;
  copy: ReviewWaitCopy;
  jiraBaseUrl?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? queue.tickets : queue.tickets.slice(0, 6);
  const maxAge = Math.max(0, ...queue.tickets.map((t) => t.ageMinutes));

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5">
          <Hourglass className="w-4 h-4 text-sprout-600" />
          <h3 className="text-sm font-semibold text-neutral-900">{copy.queueHealth}</h3>
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          <span className="font-medium text-neutral-700">Current Review Queue Age</span> — how long tickets waiting right now have already sat. Separate from
          Review Wait Time above, which only counts reviews that finished.
          {queue.asOf && <> As of last sync {formatManilaDateTime(queue.asOf)}.</>}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QueueStat label="Waiting now" value={String(queue.count)} />
        <QueueStat label="Avg age" value={queue.avgAgeMinutes === null ? "—" : `${fmtDays(queue.avgAgeMinutes)}d`} sub={fmtDur(queue.avgAgeMinutes)} />
        <QueueStat
          label="Past target"
          value={targetMinutes === null ? "—" : String(queue.overTargetCount)}
          tone={queue.overTargetCount > 0 ? "bad" : "good"}
          sub={targetMinutes === null ? undefined : `target ${fmtDur(targetMinutes)}`}
        />
        <QueueStat label="Reviewed in target" value={fmtPct(withinTargetPct)} sub="this period (historical)" />
      </div>

      {queue.tickets.length === 0 ? (
        <p className="text-sm text-neutral-500 bg-neutral-50 rounded-xl px-4 py-3">{copy.queueEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((t, i) => (
            <li key={`${t.issueKey}-${t.cycleIndex}`} className="flex items-center gap-3 text-sm rounded-lg px-2 py-1.5 hover:bg-neutral-50 transition-colors">
              <span className="w-24 shrink-0"><JiraLink issueKey={t.issueKey} jiraBaseUrl={jiraBaseUrl} /></span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-neutral-700">
                  {t.reviewer} <span className="text-neutral-400">reviewing</span> {t.assignedSe}
                  {t.cycleIndex > 1 && <span className="ml-1 text-[11px] text-amber-700">review #{t.cycleIndex}</span>}
                </span>
                <span className="block h-1 mt-1 rounded-full bg-neutral-100 overflow-hidden">
                  <span
                    className={cn("block h-full rounded-full transition-all duration-700", t.overTarget ? "bg-red-400" : "bg-sprout-400")}
                    style={{ width: `${maxAge ? Math.max(4, (t.ageMinutes / maxAge) * 100) : 0}%` }}
                  />
                </span>
              </span>
              <span className={cn("shrink-0 text-right tabular-nums text-xs", t.overTarget ? "text-red-600 font-medium" : "text-neutral-600")}>
                {fmtDur(t.ageMinutes)}
                {i === 0 && <span className="block text-[10px] uppercase tracking-wide text-neutral-400">oldest</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {queue.tickets.length > 6 && (
        <button onClick={() => setShowAll((v) => !v)} className="text-xs text-neutral-500 hover:text-sprout-700 self-start transition-colors">
          {showAll ? "Show fewer" : `Show all ${queue.tickets.length}`}
        </button>
      )}
    </div>
  );
}

function QueueStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-neutral-900")}>{value}</p>
      {sub && <p className="text-[11px] text-neutral-400">{sub}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------ What's getting stuck?

type LongestKey = "wait" | "entered" | "reviewer" | "se" | "priority" | "total" | "cycles";

function SlaPill({ sla }: { sla: LongestReviewRow["sla"] }) {
  const tone = sla.p1Breach ? "bg-red-100 text-red-700" : sla.overdue ? "bg-amber-100 text-amber-700" : sla.overdue === null ? "bg-neutral-100 text-neutral-500" : "bg-emerald-100 text-emerald-700";
  return <span className={cn("inline-block text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap", tone)}>{sla.label}</span>;
}

export function ReviewWaitLongestTable({
  rows, outlier, targetMinutes, assigneeLabel, jiraBaseUrl, copy,
}: {
  rows: LongestReviewRow[];
  outlier: ReviewWaitReport["outlier"];
  targetMinutes: number | null;
  assigneeLabel: string;
  jiraBaseUrl?: string;
  copy: ReviewWaitCopy;
}) {
  const [outliersOnly, setOutliersOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  // Ten at a time: a busy month has 60+ outliers, and the full list buried every section below it.
  const [limit, setLimit] = useState(10);
  const threshold = outlier.thresholdMinutes;
  const filtered = useMemo(
    () => (outliersOnly && threshold !== null ? rows.filter((r) => r.waitMinutes >= threshold) : rows),
    [rows, outliersOnly, threshold]
  );
  const sort = useSort<LongestReviewRow, LongestKey>(filtered, "wait", (r, k) => {
    switch (k) {
      case "wait": return r.waitMinutes;
      case "entered": return r.enteredAt;
      case "reviewer": return r.reviewer;
      case "se": return r.assignedSe;
      case "priority": return r.priority;
      case "total": return r.totalReviewMinutes;
      case "cycles": return r.cycleCount;
    }
  });

  const basisText =
    outlier.basis === "p90" ? `at or above this period's P90 (${fmtDur(threshold)})` : outlier.basis === "2x-median" ? `at or above 2× the median (${fmtDur(threshold)}) — too few reviews for a P90` : "";

  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{copy.longestReviews}</h3>
          <p className="text-xs text-neutral-500 mt-1">
            {outlier.count} review outlier{outlier.count === 1 ? "" : "s"} {basisText}. Click a row for the ticket&apos;s full review history.
          </p>
        </div>
        {threshold !== null && (
          <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
            {[
              { v: true, label: "Outliers" },
              { v: false, label: `Top ${rows.length}` },
            ].map((o) => (
              <button
                key={String(o.v)}
                onClick={() => setOutliersOnly(o.v)}
                className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors", outliersOnly === o.v ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={TH_ROW}>
              <th className="w-6" />
              <th className="px-3 py-2.5 font-medium uppercase tracking-wide">Ticket</th>
              <SortTh k="wait" label="Wait" sort={sort} />
              <SortTh k="reviewer" label="Reviewer" sort={sort} />
              <SortTh k="se" label={assigneeLabel} sort={sort} />
              <SortTh k="entered" label="In → Out" sort={sort} />
              <th className="px-3 py-2.5 font-medium uppercase tracking-wide whitespace-nowrap">Exited to / Now</th>
              <SortTh k="priority" label="Priority" sort={sort} />
              <th className="px-3 py-2.5 font-medium uppercase tracking-wide">SLA</th>
              <SortTh k="cycles" label="Cycles" sort={sort} title="Review cycles on this ticket across its whole history." />
              <SortTh k="total" label="Total review" sort={sort} title="Sum of every completed review on this ticket." />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sort.sorted.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-6 text-center text-neutral-400">{copy.noData}</td></tr>
            ) : (
              sort.sorted.slice(0, limit).map((r) => {
                const id = `${r.issueKey}-${r.cycleIndex}`;
                const isOpen = open === id;
                return (
                  <Fragment key={id}>
                    <tr onClick={() => setOpen(isOpen ? null : id)} className={cn("cursor-pointer transition-colors", isOpen ? "bg-sprout-50/60" : "hover:bg-neutral-50/60")}>
                      <td className="pl-3 text-neutral-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <JiraLink issueKey={r.issueKey} jiraBaseUrl={jiraBaseUrl} />
                        <span className="block text-[11px] text-neutral-400 max-w-[14rem] truncate" title={`${r.issueType} · ${r.product}`}>{r.issueType} · {r.product}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Dur minutes={r.waitMinutes} strong />
                        {r.vsTarget !== null && r.vsTarget > 1 && <span className="block text-[11px] text-red-600 whitespace-nowrap">{r.vsTarget >= 10 ? Math.round(r.vsTarget) : r.vsTarget.toFixed(1)}× target</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{r.reviewer}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{r.assignedSe}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-neutral-600 tabular-nums">
                        {formatManilaDateTime(r.enteredAt)}
                        <span className="block text-neutral-400">{formatManilaDateTime(r.exitedAt)}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                        {r.exitedToStatus}
                        <span className="block text-neutral-400">now {r.currentStatus || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">{r.priority}</td>
                      <td className="px-3 py-2.5"><SlaPill sla={r.sla} /></td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {r.cycleCount}
                        {r.cycleCount > 1 && <span className="block text-[11px] text-amber-700">#{r.cycleIndex} shown</span>}
                      </td>
                      <td className="px-3 py-2.5"><Dur minutes={r.totalReviewMinutes} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-sprout-50/40">
                        <td />
                        <td colSpan={10} className="px-3 pb-4 pt-1">
                          <TicketDrilldown row={r} targetMinutes={targetMinutes} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {sort.sorted.length > 10 && (
        <div className="px-5 py-3 border-t border-neutral-100 flex items-center gap-3 text-xs text-neutral-500">
          <span>Showing {Math.min(limit, sort.sorted.length)} of {sort.sorted.length}</span>
          {limit < sort.sorted.length && (
            <button onClick={() => setLimit((l) => l + 10)} className="hover:text-sprout-700 transition-colors">Show 10 more</button>
          )}
          {limit > 10 && (
            <button onClick={() => setLimit(10)} className="hover:text-sprout-700 transition-colors">Show fewer</button>
          )}
        </div>
      )}
    </div>
  );
}

function TicketDrilldown({ row, targetMinutes }: { row: LongestReviewRow; targetMinutes: number | null }) {
  const maxWait = Math.max(0, ...row.history.map((h) => h.waitMinutes ?? 0));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs animate-dropdown-in">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-600">
        <dt className="text-neutral-400">Requester</dt><dd>{row.requester}</dd>
        <dt className="text-neutral-400">Type</dt><dd>{row.issueType}</dd>
        <dt className="text-neutral-400">Product</dt><dd>{row.product}</dd>
        <dt className="text-neutral-400">Labels</dt><dd>{row.labels.length ? row.labels.join(", ") : "—"}</dd>
        <dt className="text-neutral-400">Priority</dt><dd>{row.priority}</dd>
        <dt className="text-neutral-400">SLA</dt><dd>{row.sla.label}</dd>
      </dl>
      <div className="lg:col-span-2">
        <p className="text-neutral-400 mb-1.5">Review history ({row.history.length} cycle{row.history.length === 1 ? "" : "s"})</p>
        <ol className="flex flex-col gap-1.5">
          {row.history.map((h) => (
            <li key={h.cycleIndex} className={cn("rounded-lg px-3 py-2 bg-surface", h.cycleIndex === row.cycleIndex && "ring-1 ring-sprout-300")}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="font-medium text-neutral-800">#{h.cycleIndex} · {h.reviewer}</span>
                <span className="tabular-nums text-neutral-600">
                  {h.waitMinutes === null ? "still in review" : fmtDur(h.waitMinutes)}
                  {h.kind === "otherExit" && <span className="ml-1 text-amber-700">(not counted)</span>}
                  {h.kind === "skipped" && <span className="ml-1 text-neutral-400">(skipped — not counted)</span>}
                </span>
              </div>
              <div className="text-neutral-400 tabular-nums">
                {formatManilaDateTime(h.enteredAt)} → {h.exitedAt ? formatManilaDateTime(h.exitedAt) : "…"} {h.exitedToStatus && <>· {h.exitedToStatus}</>}
              </div>
              {h.waitMinutes !== null && (
                <span className="block h-1 mt-1.5 rounded-full bg-neutral-100 overflow-hidden">
                  <span
                    className={cn("block h-full rounded-full", targetMinutes !== null && h.waitMinutes > targetMinutes ? "bg-red-400" : "bg-sprout-400")}
                    style={{ width: `${maxWait ? Math.max(3, (h.waitMinutes / maxWait) * 100) : 0}%` }}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Why?

const DIMENSION_GROUPS: { group: string; dims: { dim: SegmentDimension; label: string }[] }[] = [
  { group: "Work", dims: [{ dim: "category", label: "Category" }, { dim: "issueType", label: "Ticket type" }, { dim: "label", label: "Label" }, { dim: "priority", label: "Priority" }] },
  { group: "People", dims: [{ dim: "reviewer", label: "Reviewer" }, { dim: "assignedSe", label: "Assigned SE" }, { dim: "requester", label: "Requester" }] },
  { group: "Time", dims: [{ dim: "dayOfWeek", label: "Day of week" }, { dim: "timeOfDay", label: "Time of day" }, { dim: "month", label: "Month" }, { dim: "quarter", label: "Quarter" }] },
  { group: "Outcome", dims: [{ dim: "outcome", label: "Review outcome" }] },
];

const DIM_NOTES: Partial<Record<SegmentDimension, string>> = {
  category: "Issue Type · Product. Labels (bot/automation labels removed) are their own tab.",
  label: "A ticket with several labels counts once under each. Bot and automation labels are excluded.",
  dayOfWeek: "By the day the ticket entered review (Manila time).",
  timeOfDay: "By the hour the ticket entered review (Manila time).",
  requester: "Jira reporter.",
  outcome: "Where the ticket went when it left review.",
};

type SegKey = "key" | "count" | "avg" | "median" | "p90" | "over";

export function ReviewWaitSegmentsPanel({
  segments, hasTarget, overallMedian, copy,
}: {
  segments: Record<SegmentDimension, SegmentRow[]>;
  hasTarget: boolean;
  overallMedian: number | null;
  copy: ReviewWaitCopy;
}) {
  const [dim, setDim] = useState<SegmentDimension>("category");
  const rows = segments[dim] ?? [];
  const ordered = dim === "dayOfWeek" || dim === "timeOfDay" || dim === "month" || dim === "quarter";
  const sort = useSort<SegmentRow, SegKey>(rows, ordered ? "key" : "count", (r, k) => {
    switch (k) {
      case "key": return r.key;
      case "count": return r.count;
      case "avg": return r.avgMinutes;
      case "median": return r.medianMinutes;
      case "p90": return r.p90Minutes;
      case "over": return r.overTargetPct;
    }
  });
  const maxMedian = Math.max(0, ...rows.map((r) => r.medianMinutes ?? 0));
  const label = DIMENSION_GROUPS.flatMap((g) => g.dims).find((d) => d.dim === dim)?.label ?? "";

  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Review Wait Time by…</h3>
          <p className="text-xs text-neutral-500 mt-1">Review Wait Time split every way that might explain it. Rows under 5 reviews are flagged — read them lightly.</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {DIMENSION_GROUPS.map((g) => (
            <div key={g.group} className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide text-neutral-400 mr-0.5">{g.group}</span>
              {g.dims.map((d) => (
                <button
                  key={d.dim}
                  onClick={() => setDim(d.dim)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs transition-all",
                    dim === d.dim ? "bg-sprout-100 text-sprout-800 font-medium shadow-sm" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        {DIM_NOTES[dim] && <p className="text-[11px] text-neutral-400">{DIM_NOTES[dim]}</p>}
      </div>
      <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className={TH_ROW}>
              <SortTh k="key" label={label} sort={sort} />
              <SortTh k="count" label="Reviews" sort={sort} />
              <SortTh k="median" label="Median" sort={sort} />
              <SortTh k="avg" label="Avg" sort={sort} />
              <SortTh k="p90" label="P90" sort={sort} />
              {hasTarget && <SortTh k="over" label="Over target" sort={sort} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sort.sorted.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-400">{copy.noData}</td></tr>
            ) : (
              sort.sorted.map((r) => {
                const slow = overallMedian !== null && !r.smallSample && (r.medianMinutes ?? 0) > overallMedian * 1.5;
                return (
                  <tr key={r.key} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-3 py-2.5">
                      <span className={cn(r.key.startsWith("(") ? "text-neutral-400 italic" : "text-neutral-900")}>{segmentLabel(r.key)}</span>
                      {r.smallSample && <SmallSample n={r.count} />}
                      {slow && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-sprout-700 bg-sprout-100 rounded px-1 py-px">slower</span>}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{r.count}</td>
                    <td className="px-3 py-2.5">
                      <Dur minutes={r.medianMinutes} strong />
                      <Meter value={r.medianMinutes} max={maxMedian} />
                    </td>
                    <td className="px-3 py-2.5"><Dur minutes={r.avgMinutes} /></td>
                    <td className="px-3 py-2.5"><Dur minutes={r.p90Minutes} /></td>
                    {hasTarget && <td className="px-3 py-2.5 tabular-nums text-neutral-700">{fmtPct(r.overTargetPct)}</td>}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
