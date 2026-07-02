import Link from "next/link";
import { getTeams } from "@/lib/teams";
import { getTicketMetrics, getInsight } from "@/lib/metrics";
import { resolveFilters } from "@/lib/date-ranges";
import { formatMinutes, formatPercent, formatNumber } from "@/lib/format";
import { FilterBar } from "@/components/filters/FilterBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { InsightPanel } from "@/components/dashboard/InsightPanel";

export default async function RollupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const teams = await getTeams().catch(() => []);

  if (teams.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1>Overview</h1>
          <p className="text-sm text-neutral-500 mt-1">Cross-team rollup — Jira metrics, insights, and capacity.</p>
        </div>
        <div className="card p-6 text-sm text-neutral-500">
          No teams configured yet. Once the Apps Script backend is deployed and{" "}
          <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">TEAMS_CONFIG</code> is populated, team
          dashboards will appear here automatically.
        </div>
      </div>
    );
  }

  const { range, period } = resolveFilters(searchParams);
  const [rollupMetrics, insight, perTeamMetrics] = await Promise.all([
    getTicketMetrics("ALL", range, period),
    getInsight("ROLLUP:ALL"),
    Promise.all(teams.map((t) => getTicketMetrics(t.team_key, range, period))),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1>Overview</h1>
          <p className="text-sm text-neutral-500 mt-1">Cross-team rollup — Jira metrics, insights, and capacity.</p>
        </div>
        <FilterBar />
      </div>

      <InsightPanel insight={insight} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Ticket Volume"
          value={formatNumber(rollupMetrics.ticketVolume)}
          sublabel={`${rollupMetrics.ticketsCreated} created, ${rollupMetrics.ticketsResolved} resolved`}
        />
        <MetricCard label="Lead Time" value={formatMinutes(rollupMetrics.leadTimeAvgMinutes)} />
        <MetricCard label="Cycle Time" value={formatMinutes(rollupMetrics.cycleTimeAvgMinutes)} />
        <MetricCard label="Backlog Aging" value={formatPercent(rollupMetrics.backlogAgingRate)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {teams.map((t, i) => {
          const m = perTeamMetrics[i];
          return (
            <Link key={t.team_key} href={`/${t.team_key.toLowerCase()}`} className="card p-5 hover:border-sprout-300 transition-colors">
              <p className="text-sm font-medium text-neutral-900">{t.team_name}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{t.jira_project_key}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-neutral-400">Volume</p>
                  <p className="font-medium text-neutral-900">{formatNumber(m.ticketVolume)}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-400">Backlog Aging</p>
                  <p className="font-medium text-neutral-900">{formatPercent(m.backlogAgingRate)}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
