import type { Project } from "@/lib/project-tracking";
import { portfolioSummary } from "@/lib/project-tracking";
import { MetricCard } from "@/components/dashboard/MetricCard";

/** Five glanceable counts above the matrix — server component, pure derivation off the
 * already-team-filtered project list (no separate fetch). */
export function PortfolioSummaryStrip({ projects }: { projects: Project[] }) {
  const s = portfolioSummary(projects);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <MetricCard label="Active" value={String(s.active)} sublabel={`of ${s.total} total`} />
      <MetricCard label="On Track" value={String(s.onTrack)} badge={s.onTrack > 0 ? { label: "Healthy", tone: "success" } : undefined} />
      <MetricCard label="At Risk" value={String(s.atRisk)} badge={s.atRisk > 0 ? { label: "Watch", tone: "warning" } : undefined} />
      <MetricCard label="Blocked" value={String(s.blocked)} badge={s.blocked > 0 ? { label: "Blocked", tone: "danger" } : undefined} />
      <MetricCard label="Due Soon" value={String(s.dueSoon)} sublabel="within 14 days" />
    </div>
  );
}
