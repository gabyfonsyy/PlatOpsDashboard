import { getTeams } from "@/lib/teams";
import { getRoster } from "@/lib/roster";
import { fetchGas } from "@/lib/gas-client";
import type { RtoRecord, RtoSummaryRow, RosterMember } from "@/lib/types";
import { RtoAttendanceGrid } from "@/components/forms/RtoAttendanceGrid";
import { RtoRecordsTable } from "@/components/forms/RtoRecordsTable";
import { RtoTeamFilter } from "@/components/forms/RtoTeamFilter";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { formatPercent } from "@/lib/format";
import { teamSelectOptions } from "@/lib/utils";
import { computeRtoQuickStats } from "@/lib/rto-stats";

export default async function RtoPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;
  const startDate = typeof searchParams.startDate === "string" ? searchParams.startDate : undefined;
  const endDate = typeof searchParams.endDate === "string" ? searchParams.endDate : undefined;

  const [teams, roster, result, quickStatsSource] = await Promise.all([
    getTeams().catch(() => [] as Awaited<ReturnType<typeof getTeams>>),
    getRoster().catch(() => [] as RosterMember[]),
    fetchGas<{ records: RtoRecord[]; summary?: RtoSummaryRow[] }>(
      "rto",
      { team, startDate, endDate },
      { cache: "no-store" }
    ).catch(() => ({ records: [] as RtoRecord[], summary: undefined as RtoSummaryRow[] | undefined })),
    // Independent of the manual From/To range above — the quick-stat cards always reflect the
    // current calendar year/quarter/month regardless of whatever custom range is selected.
    fetchGas<{ records: RtoRecord[] }>("rto", { team }, { cache: "no-store" })
      .catch(() => ({ records: [] as RtoRecord[] })),
  ]);

  const quickStats = computeRtoQuickStats(quickStatsSource.records);
  const teamOptions = teamSelectOptions(teams, roster);
  const attTeam = typeof searchParams.attTeam === "string" ? searchParams.attTeam : (teamOptions[0]?.value ?? "");
  const attDate = typeof searchParams.attDate === "string" ? searchParams.attDate : new Date().toISOString().slice(0, 10);

  const existingForGrid = attTeam
    ? await fetchGas<{ records: RtoRecord[] }>(
        "rto",
        { team: attTeam, startDate: attDate, endDate: attDate },
        { cache: "no-store" }
      ).catch(() => ({ records: [] as RtoRecord[] }))
    : { records: [] as RtoRecord[] };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>RTO Tracker</h1>
        <p className="text-sm text-neutral-500 mt-1">Manager-entered attendance log and compliance summary.</p>
      </div>

      <RtoAttendanceGrid
        key={`${attTeam}-${attDate}`}
        teams={teams}
        roster={roster}
        existingRecords={existingForGrid.records}
        team={attTeam}
        date={attDate}
      />

      <RtoTeamFilter teamOptions={teamOptions} team={team ?? ""} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="This Year"
          value={formatPercent(quickStats.year.compliancePct)}
          sublabel={`${quickStats.year.daysInOffice} in-office / ${quickStats.year.totalDays} logged`}
          tooltip="In-office days ÷ total logged days this calendar year, across all logged attendance."
        />
        <MetricCard
          label="This Quarter"
          value={formatPercent(quickStats.quarter.compliancePct)}
          sublabel={`${quickStats.quarter.daysInOffice} in-office / ${quickStats.quarter.totalDays} logged`}
          tooltip="In-office days ÷ total logged days this calendar quarter, across all logged attendance."
        />
        <MetricCard
          label="This Month"
          value={formatPercent(quickStats.month.compliancePct)}
          sublabel={`${quickStats.month.daysInOffice} in-office / ${quickStats.month.totalDays} logged`}
          tooltip="In-office days ÷ total logged days this calendar month, across all logged attendance."
        />
      </div>

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="team" value={team ?? ""} />
        <input type="hidden" name="attTeam" value={attTeam} />
        <input type="hidden" name="attDate" value={attDate} />
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
