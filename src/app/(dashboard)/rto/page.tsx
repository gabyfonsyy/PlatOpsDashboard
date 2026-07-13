import { getTeams } from "@/lib/teams";
import { getRoster } from "@/lib/roster";
import { fetchGas } from "@/lib/gas-client";
import type { RtoRecord, RtoSummaryRow, RosterMember } from "@/lib/types";
import { RtoForm } from "@/components/forms/RtoForm";
import { RtoRecordsTable } from "@/components/forms/RtoRecordsTable";
import { formatPercent } from "@/lib/format";

export default async function RtoPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;
  const startDate = typeof searchParams.startDate === "string" ? searchParams.startDate : undefined;
  const endDate = typeof searchParams.endDate === "string" ? searchParams.endDate : undefined;

  const [teams, roster, result] = await Promise.all([
    getTeams().catch(() => [] as Awaited<ReturnType<typeof getTeams>>),
    getRoster().catch(() => [] as RosterMember[]),
    fetchGas<{ records: RtoRecord[]; summary?: RtoSummaryRow[] }>(
      "rto",
      { team, startDate, endDate },
      { cache: "no-store" }
    ).catch(() => ({ records: [] as RtoRecord[], summary: undefined as RtoSummaryRow[] | undefined })),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>RTO Tracker</h1>
        <p className="text-sm text-neutral-500 mt-1">Manager-entered attendance log and compliance summary.</p>
      </div>

      <RtoForm teams={teams} roster={roster} />

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label">From</label>
          <input type="date" name="startDate" defaultValue={startDate} className="form-input" />
        </div>
        <div>
          <label className="form-label">To</label>
          <input type="date" name="endDate" defaultValue={endDate} className="form-input" />
        </div>
        <button type="submit" className="btn-secondary">View compliance summary</button>
      </form>

      {result.summary && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">In-Office</th>
                <th className="px-4 py-3">Remote</th>
                <th className="px-4 py-3">Absent</th>
                <th className="px-4 py-3">Total Days</th>
                <th className="px-4 py-3">Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {result.summary.map((s) => (
                <tr key={s.employee}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{s.employee}</td>
                  <td className="px-4 py-3">{s.daysInOffice}</td>
                  <td className="px-4 py-3">{s.daysRemote}</td>
                  <td className="px-4 py-3">{s.daysAbsent}</td>
                  <td className="px-4 py-3">{s.totalDays}</td>
                  <td className="px-4 py-3">{formatPercent(s.compliancePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RtoRecordsTable records={result.records} teams={teams} roster={roster} />
    </div>
  );
}
