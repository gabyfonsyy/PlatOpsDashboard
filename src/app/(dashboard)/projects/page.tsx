import { getTeams } from "@/lib/teams";
import { fetchGas } from "@/lib/gas-client";
import type { ProjectRecord } from "@/lib/types";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { Badge } from "@/components/ui/Badge";

const STATUS_TONE: Record<ProjectRecord["status"], "neutral" | "warning" | "success" | "danger"> = {
  "Not Started": "neutral",
  "In Progress": "warning",
  "Blocked": "danger",
  "Done": "success",
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const teams = await getTeams().catch(() => []);
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;
  const records = await fetchGas<ProjectRecord[]>("projects", { team }, { cache: "no-store" }).catch(() => []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>Project Tracker</h1>
        <p className="text-sm text-neutral-500 mt-1">Manager-entered status tracking across all teams.</p>
      </div>

      <ProjectForm teams={teams} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">% Complete</th>
              <th className="px-4 py-3">Target Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">No projects tracked yet.</td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.project_id}>
                <td className="px-4 py-3 font-medium text-neutral-900">{r.project_name}</td>
                <td className="px-4 py-3">{r.owning_team}</td>
                <td className="px-4 py-3">{r.owner}</td>
                <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge></td>
                <td className="px-4 py-3">{r.percent_complete}%</td>
                <td className="px-4 py-3">{r.target_date}</td>
                <td className="px-4 py-3"><DeleteButton endpoint="/api/gas/projects" id={r.project_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
