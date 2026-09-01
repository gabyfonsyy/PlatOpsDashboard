"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import type { AutomatedTicket } from "@/lib/automated-tickets";
import {
  KNOWN_AUTOMATION_LABELS,
  persistAutomationLabelsCookie,
  sanitizeAutomationLabels,
} from "@/lib/automation-labels";
import { ANALYSIS_EXCLUDED_LABELS } from "@/lib/ticket-breakdowns";
import { DurationCell } from "@/components/dashboard/DurationCell";
import { LabelChipEditor } from "@/components/dashboard/LabelChipEditor";
import {
  useLabelPrefs,
  visibleLabels,
  normalizeLabel as normalize,
} from "@/components/dashboard/LabelPrefsContext";
import { formatDaysValue, formatManilaDate, formatNumber, formatPercent } from "@/lib/format";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function avg(values: number[]): number | null {
  return values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map(normalize));
  return b.every((x) => set.has(normalize(x)));
}

/**
 * The label side of the Automated Tickets drill-down: which labels the automation is actually
 * producing, and the ticket list behind them.
 *
 * TWO LISTS THAT LOOK ALIKE AND ARE NOT. Keeping them adjacent is deliberate — they are edited in
 * the same breath — but they act on different things, and confusing them would make every number
 * on the page suspect:
 *
 *   Hidden Labels        DISPLAY ONLY, client-side, localStorage — owned by LabelPrefsProvider.
 *                        Changes which ROWS the label table has, and the sum of its Tickets column,
 *                        and nothing else: never the ticket count, the lead/cycle averages, or which
 *                        tickets are listed. A ticket whose every label is hidden still happened, so
 *                        removing it from the population would be a lie about the team's volume.
 *
 *   Automation Labels    PART OF THE DEFINITION, cookie-backed, read by the SERVER. Adding one pulls
 *                        every ticket carrying it into the population — the count, the averages, the
 *                        records. So an edit here cannot be handled in the browser: it writes the
 *                        cookie and calls router.refresh(), and the server re-renders the report.
 *                        Chips render from the server's echoed list, never from local state, so what
 *                        you see is always what the numbers were computed with.
 *
 * The hidden list is client-side because it is meant to be edited while reading, and a round-trip
 * per chip would feel like a page load. The report sends raw label CSVs for exactly that reason — a
 * pre-filtered string could never have anything put back into it.
 */
export function AutomatedTicketsPanel({
  tickets,
  totalCount,
  automationLabels,
  jiraBaseUrl,
}: {
  tickets: AutomatedTicket[];
  /** Total automated tickets in the period; above tickets.length the list is truncated. */
  totalCount: number;
  /**
   * The catalogue the report on this page was ACTUALLY computed with, echoed back by the server.
   * Rendered directly — never copied into state — so the chips cannot show a list the numbers
   * beside them were not built from.
   */
  automationLabels: string[];
  jiraBaseUrl?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<Record<string, string>>({});

  // The hidden list is owned by LabelPrefsProvider — see that file for why it is not local state.
  // Only the column filters below belong to this component.
  const { hidden, hiddenSet, isDefaultHidden, setHidden } = useLabelPrefs();
  const known = automationLabels;

  /**
   * Changes the catalogue: cookie first, then re-render from the server.
   *
   * router.refresh() re-runs the server component with the new cookie and leaves this component's
   * own state (the hidden list, the filters) alone — which is what makes it the right call here
   * rather than a full navigation.
   */
  const setAutomationLabels = (nextRaw: readonly string[]) => {
    const next = sanitizeAutomationLabels(nextRaw);
    persistAutomationLabelsCookie(next);
    startTransition(() => router.refresh());
  };

  const knownSet = useMemo(() => new Set(known.map(normalize)), [known]);

  // `.every` on an empty list is vacuously true, which would label the button "Show known…" with
  // nothing to show. An empty catalogue means nothing is hidden.
  const knownHidden = known.length > 0 && known.every((l) => hiddenSet.has(normalize(l)));

  const addTo = (list: string[], label: string): string[] | null => {
    const clean = label.trim();
    if (!clean) return null;
    if (list.some((l) => normalize(l) === normalize(clean))) return null;
    return [...list, clean];
  };

  const toggleKnownHidden = () => {
    if (knownHidden) {
      setHidden(hidden.filter((l) => !knownSet.has(normalize(l))));
    } else {
      setHidden([...hidden, ...known.filter((l) => !hiddenSet.has(normalize(l)))]);
    }
  };

  /**
   * One row per label still visible, with the average lead and cycle time of the tickets carrying
   * it. A ticket with three labels contributes to three rows — these are per-LABEL averages, not a
   * partition of the tickets, so the rows sum to more than the ticket total.
   */
  const labelRows = useMemo(() => {
    const buckets = new Map<string, { label: string; lead: number[]; cycle: number[]; count: number }>();
    for (const t of tickets) {
      for (const label of visibleLabels(t.labels, hiddenSet)) {
        const key = normalize(label);
        let b = buckets.get(key);
        if (!b) {
          b = { label, lead: [], cycle: [], count: 0 };
          buckets.set(key, b);
        }
        b.count++;
        if (t.leadMinutes !== null) b.lead.push(t.leadMinutes);
        if (t.cycleMinutes !== null) b.cycle.push(t.cycleMinutes);
      }
    }
    // Share is of label ENTRIES, not tickets — the denominator is the sum of the counts below,
    // because a ticket with three labels is three entries. Inherited from the By Label card this
    // table replaced, so the percentages read the same as they did there.
    const entries = Array.from(buckets.values()).reduce((n, b) => n + b.count, 0);

    return Array.from(buckets.values())
      .map((b) => ({
        label: b.label,
        count: b.count,
        share: entries ? b.count / entries : null,
        leadAvgMinutes: avg(b.lead),
        cycleAvgMinutes: avg(b.cycle),
        known: knownSet.has(normalize(b.label)),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [tickets, hiddenSet, knownSet]);

  const maxLabelCount = labelRows.reduce((m, r) => Math.max(m, r.count), 0);

  /**
   * Both totals, because the rows below do not sum to the ticket count and that difference has to be
   * stated rather than left looking like an error: `occurrences` is the sum of the rows (a 3-label
   * ticket contributes 3), while `uniqueTickets` is the population itself and never moves when a
   * label is hidden.
   */
  const totals = useMemo(() => {
    let occurrences = 0;
    for (const t of tickets) occurrences += visibleLabels(t.labels, hiddenSet).length;
    return { occurrences, uniqueTickets: tickets.length };
  }, [tickets, hiddenSet]);

  // Derived strings in column order, so filtering never re-formats a date on a keystroke. Each
  // column filters on the STRING THE CELL RENDERS — the same rule as BreakdownTicketsTable.
  const searchable = useMemo(
    () =>
      tickets.map((t) => {
        const labels = visibleLabels(t.labels, hiddenSet).join(", ");
        return {
          ticket: t,
          labels,
          cells: {
            issueKey: `${t.issueKey} ${t.issueType}`,
            product: t.product,
            labels,
            assignedSe: `${t.assignedSe || "(none)"} ${t.jiraAssignee}`,
            escalation: t.escalation || "(none)",
            lead: t.leadMinutes === null ? "" : formatDaysValue(t.leadMinutes),
            cycle: t.cycleMinutes === null ? "" : formatDaysValue(t.cycleMinutes),
            resolved: formatManilaDate(t.resolvedAt),
          } as Record<string, string>,
        };
      }),
    [tickets, hiddenSet]
  );

  const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");

  const visible = useMemo(
    () =>
      searchable.filter(({ cells }) =>
        active.every(([key, value]) => (cells[key] ?? "").toLowerCase().includes(value.trim().toLowerCase()))
      ),
    [searchable, active]
  );

  const columns: { key: string; label: string }[] = [
    { key: "issueKey", label: "Ticket" },
    { key: "product", label: "Product" },
    { key: "labels", label: "Labels" },
    { key: "assignedSe", label: "Assigned SE" },
    { key: "escalation", label: "Ticket Escalation" },
    { key: "lead", label: "Lead Time" },
    { key: "cycle", label: "Cycle Time" },
    { key: "resolved", label: "Resolved" },
  ];

  const truncated = totalCount > tickets.length;

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------- the two label lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LabelChipEditor
          title="Hidden Labels"
          description={
            <>
              Workflow and bookkeeping labels, hidden from the Labels column and the label table
              below so the labels that classify the actual work stand out. Remembered in this
              browser.{" "}
              <span className="text-neutral-500">
                Display only — unlike the list beside this one, it never changes the ticket count or
                the lead/cycle averages above.
              </span>
            </>
          }
          labels={hidden}
          onAdd={(l) => {
            const next = addTo(hidden, l);
            if (next) setHidden(next);
          }}
          onRemove={(l) => setHidden(hidden.filter((x) => normalize(x) !== normalize(l)))}
          onReset={() => setHidden([...ANALYSIS_EXCLUDED_LABELS])}
          canReset={!isDefaultHidden}
          addPlaceholder="Add a label to hide…"
          addLabel="Hide"
          emptyMessage="Nothing hidden — every label is shown."
          chipTitle={(l) => `Stop hiding "${l}"`}
          actions={
            <button
              onClick={toggleKnownHidden}
              className="btn-secondary py-1 px-2.5 text-xs"
              title={
                knownHidden
                  ? "Show the automation labels you have catalogued"
                  : "Hide every catalogued automation label at once, to surface the ones you haven't"
              }
              disabled={known.length === 0}
            >
              {knownHidden ? "Show known" : "Hide all known"}
            </button>
          }
        />

        <LabelChipEditor
          title="Known Automation Labels"
          description={
            <>
              Your catalogue of labels that mean &ldquo;this ticket was raised by automation&rdquo;.{" "}
              <strong className="text-neutral-600 font-medium">
                Adding one pulls every ticket carrying it into this report
              </strong>{" "}
              — the count, the averages and the records above, even where a person is the Assigned
              SE. They also get the <span className="text-sprout-700">known</span> badge below, and
              &ldquo;Hide all known&rdquo; hides exactly this set, so what remains in the label table is a
              candidate you haven&apos;t catalogued yet.
              {pending && (
                <span className="inline-flex items-center gap-1 ml-1 text-sprout-700">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  recalculating…
                </span>
              )}
            </>
          }
          labels={known}
          onAdd={(l) => {
            const next = addTo(known, l);
            if (next) setAutomationLabels(next);
          }}
          onRemove={(l) => setAutomationLabels(known.filter((x) => normalize(x) !== normalize(l)))}
          onReset={() => setAutomationLabels([...KNOWN_AUTOMATION_LABELS])}
          canReset={!sameList(known, KNOWN_AUTOMATION_LABELS)}
          addPlaceholder="Add an automation label…"
          addLabel="Add"
          emptyMessage="No labels catalogued yet — only unowned tickets are counted."
          chipTitle={(l) => `Remove "${l}" — its tickets leave this report unless they are unowned`}
          tone="sprout"
          busy={pending}
        />
      </div>

      {/* ------------------------------------------------------- label table */}
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">What the Automation Is Doing, by Label</h3>
            <p className="text-xs text-neutral-400 mt-0.5 max-w-2xl">
              One row per visible label, with the average lead and cycle time of the tickets carrying
              it. A ticket with three labels appears in three rows, so these are per-label averages,
              not a split of the tickets — and Share is of label entries, not of tickets, for the
              same reason.
            </p>
            {/* Says once, in words, why the rows do not add up to the ticket count. This replaced a
                unique-tickets / label-occurrences toggle: it made the reader choose between two
                framings of the same rows, when stating both numbers in a sentence answers it. */}
            <p className="text-xs mt-1.5">
              <span className="font-semibold text-neutral-900">
                {formatNumber(totals.uniqueTickets)} unique tickets
              </span>
              <span className="text-neutral-400">
                {" "}
                — unaffected by hiding a label; the rows below sum to{" "}
                {formatNumber(totals.occurrences)} because tickets carry more than one label.
              </span>
            </p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3 text-right">Tickets</th>
              <th className="px-4 py-3 text-right w-20">Share</th>
              <th className="px-4 py-3">Avg Lead Time</th>
              <th className="px-4 py-3">Avg Cycle Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {labelRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  {tickets.length === 0
                    ? "No automated tickets in this period."
                    : "Every label on these tickets is currently hidden."}
                </td>
              </tr>
            ) : (
              labelRows.map((r) => (
                <tr key={r.label}>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-neutral-900">{r.label}</span>
                      {r.known && (
                        <span
                          className="text-[10px] uppercase tracking-wide bg-sprout-50 text-sprout-700 rounded px-1 py-0.5"
                          title="On your list of known automation labels"
                        >
                          known
                        </span>
                      )}
                    </span>
                    <span className="block mt-1 h-1 rounded-full bg-sprout-100 overflow-hidden">
                      <span
                        className="block h-full bg-sprout-500"
                        style={{ width: maxLabelCount ? `${Math.max(2, (r.count / maxLabelCount) * 100)}%` : "0%" }}
                      />
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap align-top">
                    {formatNumber(r.count)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-neutral-400 tabular-nums whitespace-nowrap align-top">
                    {r.share === null ? "—" : formatPercent(r.share)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap align-top">
                    <DurationCell minutes={r.leadAvgMinutes} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap align-top">
                    <DurationCell minutes={r.cycleAvgMinutes} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------ ticket table */}
      <div className="card overflow-x-auto" id="tickets">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Automated Tickets</h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Filter any column to find a specific ticket. Filter Assigned SE on{" "}
              <code className="text-[11px] bg-neutral-100 px-1 rounded">(none)</code> for the ones
              missing an SE entirely, or on the automation account for the ones a bot owns.
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {active.length > 0
                ? `${visible.length} of ${tickets.length} shown`
                : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
              {truncated && ` · most recent ${tickets.length} of ${totalCount} in this period`}
            </p>
          </div>
          {active.length > 0 && (
            <button
              onClick={() => setFilters({})}
              className="btn-secondary py-1 px-2.5 text-xs"
              title="Clear every column filter"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          )}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              {columns.map((c) => (
                <th key={c.key} className="px-4 pt-3 pb-1">
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-neutral-200">
              {columns.map((c) => (
                <th key={c.key} className="px-4 pb-2.5 pt-0 font-normal">
                  <span className="relative block">
                    <Search className="w-3 h-3 text-neutral-300 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={filters[c.key] ?? ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                      placeholder="Filter…"
                      aria-label={`Filter by ${c.label}`}
                      className="form-input w-full !py-1 !pl-7 !pr-2 text-xs font-normal normal-case tracking-normal"
                    />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-neutral-400">
                  {tickets.length === 0
                    ? "No automated tickets in this period."
                    : "No tickets match these filters."}
                </td>
              </tr>
            ) : (
              visible.map(({ ticket: t, labels }) => (
                <tr key={t.issueKey}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap align-top">
                    {jiraBaseUrl ? (
                      <a
                        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sprout-700 hover:underline"
                      >
                        {t.issueKey}
                      </a>
                    ) : (
                      t.issueKey
                    )}
                    {t.issueType && (
                      <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap align-top">{t.product}</td>
                  {/* Hover shows the full CSV including hidden labels, so nothing is unreachable. */}
                  <td className="px-4 py-3 text-xs text-neutral-500 align-top" title={t.labels || undefined}>
                    {labels || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap align-top">
                    {t.assignedSe ? t.assignedSe : <span className="text-amber-700">(none)</span>}
                    {/* Jira's assignee is a repair hint for a blank Assigned SE, never attribution
                        — the same rule as the Tool-Assisted page's unattributable list. The report
                        already blanks it when it just repeats the reporter (assigneeRepairHint), so
                        this only renders when it names someone new. */}
                    {!t.assignedSe && t.jiraAssignee && (
                      <span className="block text-[11px] text-neutral-400 font-normal">
                        Jira: {t.jiraAssignee}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap align-top">{t.escalation || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap align-top">
                    <DurationCell minutes={t.leadMinutes} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap align-top">
                    <DurationCell minutes={t.cycleMinutes} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap align-top">{formatManilaDate(t.resolvedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
