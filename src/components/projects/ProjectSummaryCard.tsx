import type { Project } from "@/lib/project-tracking";
import { formatManilaDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { HealthDot, healthAccentBg } from "@/components/projects/HealthDot";
import { ProgressBar } from "@/components/projects/ProgressBar";
import { cn } from "@/lib/utils";

/**
 * The one compact project row used everywhere a list of projects needs to be scannable rather
 * than read: the quadrant drill-down, and the Ongoing/Completed sections on the landing page.
 * Purely presentational — callers resolve team label/percent/current-phase once per list (via
 * `resolveDisplayPercent`/`currentPhaseFor`, already in `lib/projection.ts`/`lib/project-tracking.ts`)
 * rather than this component re-deriving them per card off raw maps.
 */
export function ProjectSummaryCard({
  project,
  teamLabel,
  percentComplete,
  currentPhaseName,
  onClick,
}: {
  project: Project;
  teamLabel: string;
  percentComplete: number;
  currentPhaseName: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative overflow-hidden w-full text-left card py-3 pr-3 pl-4 hover:shadow-md transition-shadow flex flex-col gap-2"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", healthAccentBg(project.health))} aria-hidden="true" />

      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm text-neutral-900 truncate min-w-0" title={project.project_name}>
          {project.project_name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {project.archived && <Badge tone="neutral">Archived</Badge>}
          <HealthDot health={project.health} />
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-neutral-500 min-w-0">
        <span className="shrink-0">{teamLabel}</span>
        {project.owner && (
          <>
            <span className="shrink-0">·</span>
            <span className="truncate">{project.owner}</span>
          </>
        )}
        {currentPhaseName && (
          <>
            <span className="shrink-0">·</span>
            <span className="truncate">{currentPhaseName}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ProgressBar percent={percentComplete} className="flex-1" />
        <span className="text-xs text-neutral-500 shrink-0 w-9 text-right">{percentComplete}%</span>
      </div>

      <p className="text-[11px] text-neutral-400">
        {project.target_date ? `Due ${formatManilaDate(project.target_date)}` : "No target date"}
      </p>
    </button>
  );
}
