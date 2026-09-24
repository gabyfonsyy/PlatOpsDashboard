import type { Project } from "@/lib/project-tracking";
import { computeProjection } from "@/lib/projection";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";

/**
 * Read-only batch stats inside the project drill-down — only rendered when
 * `batch_tracking_enabled`. Reuses `computeProjection` (`lib/projection.ts`), the exact same
 * function `ProjectsTable` already calls for its own Projection column; no new math. Doesn't
 * duplicate the logging UI — that stays on the existing "Batches" edge-tab panel.
 */
export function ProjectBatchSummary({ project, processed }: { project: Project; processed?: number }) {
  const proj = computeProjection({
    totalItems: project.total_items,
    batchSize: project.batch_size,
    batchesPerWeek: project.batches_per_week,
    startDate: project.start_date || null,
    targetDate: project.target_date || null,
    weeklyPlan: JSON.parse(project.weekly_plan_json || "[]"),
    processedItems: processed ?? null,
    observedItemsPerWeek: null,
  });

  const totalBatches = proj.totalBatches;
  const completedBatches =
    processed !== undefined && project.batch_size ? Math.floor(processed / Number(project.batch_size)) : undefined;
  const remainingBatches =
    totalBatches !== undefined && completedBatches !== undefined ? Math.max(0, totalBatches - completedBatches) : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total Batches" value={totalBatches?.toLocaleString() ?? "—"} />
        <Stat label="Completed" value={completedBatches?.toLocaleString() ?? "—"} />
        <Stat label="Remaining" value={remainingBatches?.toLocaleString() ?? "—"} />
        <Stat
          label="Projected Completion"
          value={proj.completionDate ? formatManilaDate(proj.completionDate) : "—"}
          badge={proj.onTrack === true ? { label: "On track", tone: "success" as const } : proj.onTrack === false ? { label: "Behind", tone: "danger" as const } : undefined}
        />
      </div>
      {project.batch_actuals_from_tickets && (
        <p className="text-xs text-neutral-400">
          Completed batches counted from linked tickets, not the progress log.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: { label: string; tone: "success" | "danger" };
}) {
  return (
    <div className="rounded-lg border border-sprout-100 bg-sprout-50/50 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-lg font-semibold text-sprout-800 mt-0.5">{value}</p>
      {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
    </div>
  );
}
