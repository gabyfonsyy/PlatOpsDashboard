import Link from "next/link";
import {
  ArrowRight,
  CircleDot,
  Clock,
  Plug,
  Sparkles,
  TriangleAlert,
  Check,
} from "lucide-react";
import { SectionCard, EmptyState } from "@/components/overview/SectionCard";
import { MODULE_REGISTRY, type AttentionItem, type MyDaySummary, type OperationsRow, type OverviewModule, type PulseMetric, type StableStatement, type TeamPulseSummary } from "@/lib/overview";
import type { BriefingNote, PriorityItem } from "@/lib/overview-ai";
import { formatDuration } from "@/lib/work";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Every section body the Overview renders. They are all pure and prop-driven — the page decides
 * order and copy, these decide only how a shape looks, so adding a module later means passing more
 * items in rather than touching any of this.
 */

// ---------------------------------------------------------------------------- priority

/**
 * The AI's priority items merged with the deterministic ones from the modules.
 *
 * Both are shown, and the deterministic ones are NOT filtered out when the AI also mentions them:
 * a rule that fired is a fact, and dropping it because a model happened to phrase something
 * similarly would mean the page silently depends on the model having noticed.
 */
export function PriorityList({
  items,
  aiItems,
  emptyMessage,
}: {
  items: AttentionItem[];
  aiItems: PriorityItem[];
  emptyMessage: string;
}) {
  if (items.length === 0 && aiItems.length === 0) {
    return (
      <EmptyState>
        <span className="inline-flex items-center gap-1.5 text-neutral-500">
          <Check className="w-4 h-4 text-emerald-600" />
          {emptyMessage}
        </span>
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-neutral-100">
      {aiItems.map((item, i) => (
        <li key={`ai-${i}`} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <UrgencyDot urgent={item.urgency === "urgent"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-neutral-900">{item.title}</p>
                <span
                  className={cn(
                    "badge",
                    item.urgency === "urgent"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-neutral-100 text-neutral-600"
                  )}
                >
                  {item.urgency === "urgent" ? "act today" : "monitor"}
                </span>
              </div>
              {item.what && <p className="text-sm text-neutral-600 mt-1 leading-relaxed">{item.what}</p>}
              {item.why && <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{item.why}</p>}
              <p className="text-sm text-neutral-700 mt-1.5 leading-relaxed">
                <span className="text-sprout-600 mr-1">→</span>
                {item.action}
              </p>
              {item.module && MODULE_REGISTRY[item.module] && (
                <ModuleLink module={MODULE_REGISTRY[item.module]} />
              )}
            </div>
          </div>
        </li>
      ))}

      {items.map((item) => (
        <li key={item.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <UrgencyDot urgent={item.priority === "high"} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900">{item.title}</p>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{item.why}</p>
              <p className="text-sm text-neutral-700 mt-1.5 leading-relaxed">
                <span className="text-sprout-600 mr-1">→</span>
                {item.action}
              </p>
              <Link
                href={item.href}
                className="text-xs text-sprout-700 hover:underline inline-flex items-center gap-1 mt-1.5"
              >
                {MODULE_REGISTRY[item.source]?.label ?? "Open"}
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function UrgencyDot({ urgent }: { urgent: boolean }) {
  return (
    <CircleDot
      className={cn("w-4 h-4 mt-0.5 shrink-0", urgent ? "text-amber-600" : "text-neutral-300")}
      aria-hidden="true"
    />
  );
}

function ModuleLink({ module }: { module: OverviewModule }) {
  return (
    <Link
      href={module.href}
      className="text-xs text-sprout-700 hover:underline inline-flex items-center gap-1 mt-1.5"
    >
      {module.label}
      <ArrowRight className="w-3 h-3" />
    </Link>
  );
}

// ---------------------------------------------------------------------------- my day

export function MyDayPanel({ day, note }: { day: MyDaySummary; note: string }) {
  const openFocus = day.focusTasks.filter((t) => !t.done);

  return (
    <div className="flex flex-col gap-4">
      {/* The model's read comes first: the counts below are already visible, and what deserves
          priority is the part that needs saying. */}
      {note && <p className="text-sm text-neutral-700 leading-relaxed">{note}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Open today" value={String(day.openTasks)} sub={`${day.doneToday} done`} />
        <Stat
          label="Overdue"
          value={String(day.overdueCount)}
          sub={day.overdueCount ? "from earlier days" : "nothing late"}
          tone={day.overdueCount > 0 ? "warn" : "neutral"}
        />
        <Stat label="In focus" value={String(openFocus.length)} sub={openFocus[0]?.title ?? "nothing claimed"} />
        <Stat
          label="Workday"
          value={day.workdayOpen ? "Running" : "Not started"}
          sub={day.loggedMinutesToday > 0 ? `${formatDuration(day.loggedMinutesToday)} logged` : "—"}
          tone={day.workdayOpen ? "good" : "neutral"}
        />
      </div>

      {day.projectTasks.length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
            Today, by project
          </p>
          <ul className="flex flex-col gap-1">
            {day.projectTasks.map((t) => (
              <li key={t.id} className="text-sm flex items-center gap-2">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    t.done ? "bg-emerald-500" : "bg-neutral-300"
                  )}
                />
                <span className={cn("truncate", t.done ? "text-neutral-400 line-through" : "text-neutral-700")}>
                  {t.title}
                </span>
                <span className="text-xs text-neutral-400 shrink-0">· {t.project}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold mt-0.5",
          tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-neutral-900"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-neutral-400 truncate">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------- team pulse

export function TeamPulsePanel({
  pulse,
  metrics,
  note,
}: {
  pulse: TeamPulseSummary;
  metrics: PulseMetric[];
  note: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {note && <p className="text-sm text-neutral-700 leading-relaxed">{note}</p>}

      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {metrics.map((m) => (
            <Link
              key={m.id}
              href={m.href ?? "#"}
              className="rounded-xl border border-line/70 px-3 py-2.5 hover:border-sprout-200 transition-colors"
            >
              <p className="text-xs text-neutral-500">{m.label}</p>
              <p
                className={cn(
                  "text-lg font-semibold mt-0.5",
                  m.tone === "warn" ? "text-amber-700" : "text-neutral-900"
                )}
              >
                {m.value}
              </p>
              {m.sublabel && <p className="text-xs text-neutral-400 truncate">{m.sublabel}</p>}
              {m.delta && (
                <p className="text-[11px] text-neutral-400 mt-0.5">{m.delta.label}</p>
              )}
            </Link>
          ))}
        </div>
      )}

      {pulse.teams.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                <th className="pb-2 font-medium">Team</th>
                <th className="pb-2 font-medium text-right">Resolved MTD</th>
                <th className="pb-2 font-medium text-right">Escalation</th>
                <th className="pb-2 font-medium text-right">Aging</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pulse.teams.map((t) => (
                <tr key={t.key}>
                  <td className="py-2">
                    <Link href={t.href} className="text-neutral-900 hover:text-sprout-700 transition-colors">
                      {t.name}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-700">
                    {t.resolvedInPeriod}
                    {t.previousResolved !== null && t.previousResolved > 0 && (
                      <span className="text-xs text-neutral-400 ml-1">
                        vs {t.previousResolved}
                      </span>
                    )}
                  </td>
                  {/* Dashes, not zeros: DBA and DevOps do not track these at all, and a 0% would
                      read as "perfect" rather than "not measured". */}
                  <td className="py-2 text-right tabular-nums text-neutral-700">
                    {t.escalationRate === null ? "—" : formatPercent(t.escalationRate)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-700">
                    {t.backlogAgingRate === null ? "—" : formatPercent(t.backlogAgingRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pulse.onLeaveToday.length > 0 && (
        <p className="text-xs text-neutral-500">
          On leave today:{" "}
          {pulse.onLeaveToday
            .map((p) => `${p.name}${p.halfDay ? ` (${p.halfDay})` : ""}`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- prose sections

/** System Pulse / Sustainable Momentum — model prose with nothing else in the way. */
export function ProsePanel({ text, fallback }: { text: string; fallback: string }) {
  if (!text) return <EmptyState>{fallback}</EmptyState>;
  return <p className="text-sm text-neutral-700 leading-relaxed">{text}</p>;
}

export function WatchList({ notes, emptyMessage }: { notes: BriefingNote[]; emptyMessage: string }) {
  if (notes.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;
  return (
    <ul className="flex flex-col gap-3">
      {notes.map((n, i) => (
        <li key={i} className="flex items-start gap-3">
          <TriangleAlert className="w-4 h-4 text-neutral-300 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            {/* Title is optional: some responses carry only a sentence, and an empty <p> above the
                detail reads as a rendering fault rather than a note without a heading. */}
            {n.title && <p className="text-sm font-medium text-neutral-900">{n.title}</p>}
            <p className={cn("text-sm text-neutral-600 leading-relaxed", n.title && "mt-0.5")}>
              {n.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stable statements. Deterministic ones from the modules come first because they are checks that
 * actually ran; the model's come after and are visually identical, because to the reader they mean
 * the same thing — "you can leave this alone".
 */
export function StableList({
  statements,
  aiStatements,
  emptyMessage,
}: {
  statements: StableStatement[];
  aiStatements: string[];
  emptyMessage: string;
}) {
  const all = [...statements.map((s) => s.text), ...aiStatements];
  if (all.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {all.map((text, i) => (
        <li key={i} className="text-sm text-neutral-600 flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function FocusList({ moves, emptyMessage }: { moves: string[]; emptyMessage: string }) {
  if (moves.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;
  return (
    <ol className="flex flex-col gap-2.5">
      {moves.map((move, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="w-5 h-5 rounded-full bg-sprout-50 text-sprout-700 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
            {i + 1}
          </span>
          <p className="text-sm text-neutral-800 leading-relaxed">{move}</p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------- operations

/**
 * Live operational rows, then an explicit placeholder per module that has no data source yet.
 *
 * The placeholders are the point of this section right now. A module that is simply hidden reads
 * as "nothing to worry about there", which is a claim this page cannot support — so an unwired
 * module says so, by name, with a link.
 */
export function OperationsPanel({
  rows,
  planned,
  emptyMessage,
}: {
  rows: OperationsRow[];
  planned: OverviewModule[];
  emptyMessage: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100">
          {rows.map((row) => (
            <li key={row.id} className="py-2 first:pt-0 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={row.href} className="text-sm text-neutral-900 hover:text-sprout-700 transition-colors">
                  {row.label}
                </Link>
                <p className="text-xs text-neutral-500 truncate">{row.detail}</p>
              </div>
              <span className="text-xs text-neutral-400 shrink-0">
                {MODULE_REGISTRY[row.source]?.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {planned.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line/70 pt-3">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Not connected yet
          </p>
          {planned.map((m) => (
            <div key={m.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={m.href}
                  className="text-sm text-neutral-700 hover:text-sprout-700 transition-colors inline-flex items-center gap-1.5"
                >
                  <Plug className="w-3.5 h-3.5 text-neutral-300" />
                  {m.label}
                </Link>
                {m.plannedContribution && (
                  <p className="text-xs text-neutral-400 mt-0.5">Will contribute: {m.plannedContribution}</p>
                )}
              </div>
              <span className="badge bg-neutral-100 text-neutral-500 shrink-0">no data source</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- re-exports

export { SectionCard, EmptyState };
export { Clock, Sparkles };
