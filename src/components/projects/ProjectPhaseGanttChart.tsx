import { PHASE_STATUS_META, isPhaseDelayed, type ProjectMilestone, type ProjectPhase } from "@/lib/project-tracking";
import { formatManilaDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One project's own phases on a timeline — a new sibling to `ProjectsGanttChart.tsx` rather than an
 * edit to it (that one is the preserved cross-project/cross-team view). Same CSS-grid/month-ticks/
 * today-line mechanics, scoped down to a single project's phases with no team grouping. Dated
 * milestones (Phase 5) overlay as diamonds on the same timeline, in their own thin row.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PAD_DAYS = 7;
const MIN_BAR_PERCENT = 3;
const LABEL_COL = "160px";

const STATUS_BAR: Record<ProjectPhase["status"], { track: string; fill: string }> = {
  not_started: { track: "bg-neutral-200", fill: "bg-neutral-400" },
  in_progress: { track: "bg-amber-100", fill: "bg-amber-500" },
  blocked: { track: "bg-red-100", fill: "bg-red-500" },
  done: { track: "bg-emerald-100", fill: "bg-emerald-500" },
};

function parseLocalDate(value: string | undefined | null): number | null {
  if (!value) return null;
  const plain = formatManilaDate(value);
  if (!plain) return null;
  const d = new Date(`${plain}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function startOfMonth(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

type DatedPhase = { phase: ProjectPhase; start: number; end: number };
type DatedMilestone = { milestone: ProjectMilestone; at: number };

export function ProjectPhaseGanttChart({
  phases,
  milestones = [],
}: {
  phases: ProjectPhase[];
  milestones?: ProjectMilestone[];
}) {
  const dated: DatedPhase[] = phases
    .map((phase) => ({ phase, start: parseLocalDate(phase.start_date), end: parseLocalDate(phase.target_date) }))
    .filter((r): r is { phase: ProjectPhase; start: number; end: number } => r.start !== null && r.end !== null)
    .map((r) => ({ ...r, end: Math.max(r.end, r.start) }));

  const datedMilestones: DatedMilestone[] = milestones
    .map((milestone) => ({ milestone, at: parseLocalDate(milestone.target_date) }))
    .filter((m): m is DatedMilestone => m.at !== null);

  const omittedCount = phases.length - dated.length;

  if (dated.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        No phases have both a start and target date yet — add dates to see them on a timeline.
      </p>
    );
  }

  const domainStart =
    Math.min(...dated.map((r) => r.start), ...datedMilestones.map((m) => m.at)) - PAD_DAYS * DAY_MS;
  const domainEnd =
    Math.max(...dated.map((r) => r.end), ...datedMilestones.map((m) => m.at)) + PAD_DAYS * DAY_MS;
  const domainSpan = domainEnd - domainStart;
  const pct = (ts: number) => ((ts - domainStart) / domainSpan) * 100;

  const ticks: { left: number; label: string }[] = [];
  let cursor = startOfMonth(domainStart);
  while (cursor.getTime() <= domainEnd) {
    ticks.push({
      left: pct(cursor.getTime()),
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    });
    cursor = addMonths(cursor, 1);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const todayLeft = todayTs >= domainStart && todayTs <= domainEnd ? pct(todayTs) : null;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[480px]">
        <div className="grid gap-3" style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}>
          <div />
          <div className="relative h-6 border-b border-neutral-200">
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-neutral-100 text-[11px] text-neutral-400 pl-1.5"
                style={{ left: `${t.left}%` }}
              >
                {t.label}
              </div>
            ))}
            {todayLeft !== null && (
              <div className="absolute top-0 h-full border-l-2 border-sprout-500" style={{ left: `${todayLeft}%` }} />
            )}
          </div>
        </div>

        {datedMilestones.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}>
            <div className="text-[11px] text-neutral-400 self-center">Milestones</div>
            <div className="relative h-5">
              {datedMilestones.map(({ milestone, at }) => (
                <span
                  key={milestone.id}
                  className={cn(
                    "absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45",
                    milestone.done ? "bg-emerald-500" : "bg-neutral-400"
                  )}
                  style={{ left: `${pct(at)}%` }}
                  title={`${milestone.name} — ${formatManilaDate(milestone.target_date)}${milestone.done ? " (done)" : ""}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5 mt-2">
          {dated.map(({ phase, start, end }) => {
            const tone = STATUS_BAR[phase.status] ?? STATUS_BAR.not_started;
            const left = pct(start);
            const width = Math.max(pct(end) - left, MIN_BAR_PERCENT);
            const delayed = isPhaseDelayed(phase);
            return (
              <div
                key={phase.id}
                className="grid gap-3 items-center"
                style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}
              >
                <div className="text-xs text-neutral-700 truncate flex items-center gap-1" title={phase.name}>
                  {phase.name}
                </div>
                <div className="relative h-6">
                  {todayLeft !== null && (
                    <div className="absolute top-0 h-full border-l border-neutral-100" style={{ left: `${todayLeft}%` }} />
                  )}
                  <div
                    className={cn(
                      "absolute top-1 h-4 rounded-md overflow-hidden",
                      tone.track,
                      delayed && "ring-1 ring-amber-500"
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${phase.name} — ${formatManilaDate(phase.start_date)} to ${formatManilaDate(phase.target_date)} — ${PHASE_STATUS_META[phase.status].label}, ${phase.progress}% complete${delayed ? " (delayed)" : ""}`}
                  >
                    <div className={cn("h-full", tone.fill)} style={{ width: `${phase.progress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {omittedCount > 0 && (
          <p className="text-xs text-neutral-400 mt-3">
            {omittedCount} phase{omittedCount === 1 ? "" : "s"} without both a start and target date aren&apos;t shown here.
          </p>
        )}
      </div>
    </div>
  );
}
