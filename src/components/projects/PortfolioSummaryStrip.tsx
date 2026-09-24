import type { Project } from "@/lib/project-tracking";
import { portfolioSummary } from "@/lib/project-tracking";
import { MetricCard } from "@/components/dashboard/MetricCard";

/** Six glanceable scorecards above the matrix — server component, pure derivation off the
 * already-team-filtered project list (no separate fetch). `blockedProjectIds` (Phase 5) makes
 * "Blocked" count a project stuck for EITHER reason — workflow status or an active blocker note. */
export function PortfolioSummaryStrip({
  projects,
  blockedProjectIds,
}: {
  projects: Project[];
  blockedProjectIds?: Set<string>;
}) {
  const s = portfolioSummary(projects, blockedProjectIds);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <MetricCard label="Active" value={String(s.active)} sublabel={`of ${s.total} total`} />
      <MetricCard label="On Track" value={String(s.onTrack)} badge={s.onTrack > 0 ? { label: "Healthy", tone: "success" } : undefined} />
      <MetricCard label="At Risk" value={String(s.atRisk)} badge={s.atRisk > 0 ? { label: "Watch", tone: "warning" } : undefined} />
      <MetricCard label="Blocked" value={String(s.blocked)} badge={s.blocked > 0 ? { label: "Blocked", tone: "danger" } : undefined} />
      <MetricCard label="Due Soon" value={String(s.dueSoon)} sublabel="within 14 days" />
      <MetricCard label="Completed" value={String(s.completed)} badge={s.completed > 0 ? { label: "Done", tone: "success" } : undefined} />
    </div>
  );
}
