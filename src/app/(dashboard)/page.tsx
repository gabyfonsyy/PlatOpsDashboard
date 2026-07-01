import { getTeams } from "@/lib/teams";

export default async function RollupPage() {
  const teams = await getTeams().catch(() => []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>Overview</h1>
        <p className="text-sm text-neutral-500 mt-1">Cross-team rollup — Jira metrics, insights, and capacity.</p>
      </div>

      {teams.length === 0 ? (
        <div className="card p-6 text-sm text-neutral-500">
          No teams configured yet. Once the Apps Script backend is deployed and{" "}
          <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">TEAMS_CONFIG</code> is populated, team
          dashboards will appear here automatically.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {teams.map((t) => (
            <div key={t.team_key} className="card p-5">
              <p className="text-sm font-medium text-neutral-900">{t.team_name}</p>
              <p className="text-xs text-neutral-400 mt-1">{t.jira_project_key}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
