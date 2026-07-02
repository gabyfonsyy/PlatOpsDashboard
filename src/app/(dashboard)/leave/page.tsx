import { getTeams } from "@/lib/teams";
import { fetchGas } from "@/lib/gas-client";
import type { LeaveRecord } from "@/lib/types";
import { LeaveForm } from "@/components/forms/LeaveForm";
import { DeleteButton } from "@/components/ui/DeleteButton";

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const teams = await getTeams().catch(() => []);
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;
  const records = await fetchGas<LeaveRecord[]>("leave", { team }, { cache: "no-store" }).catch(() => []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>Leave Tracker</h1>
        <p className="text-sm text-neutral-500 mt-1">Manager-entered — team members do not submit their own leave.</p>
      </div>

      <LeaveForm teams={teams} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">No leave records yet.</td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.leave_id}>
                <td className="px-4 py-3 font-medium text-neutral-900">{r.employee_name}</td>
                <td className="px-4 py-3">{r.team_key}</td>
                <td className="px-4 py-3">{r.leave_type}</td>
                <td className="px-4 py-3 whitespace-nowrap">{r.start_date} → {r.end_date}</td>
                <td className="px-4 py-3">{r.num_days}</td>
                <td className="px-4 py-3">{r.status}</td>
                <td className="px-4 py-3"><DeleteButton endpoint="/api/gas/leave" id={r.leave_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
