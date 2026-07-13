import { getTeams } from "@/lib/teams";
import { getRoster } from "@/lib/roster";
import { fetchGas } from "@/lib/gas-client";
import type { LeaveRecord, LeaveStats, RosterMember } from "@/lib/types";
import { LeaveForm } from "@/components/forms/LeaveForm";
import { LeaveRecordsTable } from "@/components/forms/LeaveRecordsTable";
import { LeaveGanttChart } from "@/components/forms/LeaveGanttChart";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { formatNumber, formatManilaDate } from "@/lib/format";
import { teamSelectOptions } from "@/lib/utils";

type LeaveListResult = { records: LeaveRecord[]; stats: LeaveStats };

const EMPTY_STATS: LeaveStats = {
  totalRecords: 0,
  totalDays: 0,
  employeesOnLeave: 0,
  halfDayCount: 0,
  byType: [],
  byEmployee: [],
};

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;
  // From/To date range (default: current month-to-date — 1st of the month through today, Manila).
  const isDate = (s: string | string[] | undefined): s is string =>
    typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = formatManilaDate(new Date().toISOString());
  const startDate = isDate(searchParams.from) ? searchParams.from : `${today.slice(0, 7)}-01`;
  const endDate = isDate(searchParams.to) ? searchParams.to : today;
  // The Gantt is a single-month calendar; anchor it to the "From" month.
  const month = startDate.slice(0, 7);

  const [teams, roster, result] = await Promise.all([
    getTeams().catch(() => [] as Awaited<ReturnType<typeof getTeams>>),
    getRoster().catch(() => [] as RosterMember[]),
    fetchGas<LeaveListResult>("leave", { team, startDate, endDate }, { cache: "no-store" }).catch(
      () => ({ records: [] as LeaveRecord[], stats: EMPTY_STATS })
    ),
  ]);

  const { records, stats } = result;
  const teamOptions = teamSelectOptions(teams, roster);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>Leave Tracker</h1>
        <p className="text-sm text-neutral-500 mt-1">Manager-entered — team members do not submit their own leave.</p>
      </div>

      <LeaveForm teams={teams} roster={roster} />

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label">From</label>
          <input type="date" name="from" defaultValue={startDate} max={endDate} className="form-input" />
        </div>
        <div>
          <label className="form-label">To</label>
          <input type="date" name="to" defaultValue={endDate} min={startDate} className="form-input" />
        </div>
        <div>
          <label className="form-label">Team</label>
          <select name="team" defaultValue={team ?? ""} className="form-input w-auto">
            <option value="">All teams</option>
            {teamOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">Apply filter</button>
        {(team || startDate !== `${today.slice(0, 7)}-01` || endDate !== today) && (
          <a href="/leave" className="text-xs text-neutral-500 self-center hover:text-neutral-700">
            Reset
          </a>
        )}
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Days Off"
          value={formatNumber(stats.totalDays)}
          sublabel={`${formatNumber(stats.totalRecords)} leave record${stats.totalRecords === 1 ? "" : "s"}`}
          tooltip="Sum of num_days across all leave records in the current filter (a half-day counts as 0.5)."
        />
        <MetricCard
          label="People on Leave"
          value={formatNumber(stats.employeesOnLeave)}
          tooltip="Distinct employees with at least one leave record in the current filter."
        />
        <MetricCard
          label="Half-Days"
          value={formatNumber(stats.halfDayCount)}
          tooltip="Leave records flagged as a half-day (First Half / Second Half)."
        />
        <MetricCard
          label="Leave Types"
          value={formatNumber(stats.byType.length)}
          sublabel={stats.byType[0] ? `Most: ${stats.byType[0].type}` : undefined}
          tooltip="Number of distinct leave types used in the current filter."
        />
      </div>

      <LeaveGanttChart records={records} month={month} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Days by Leave Type
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Records</th>
                <th className="px-4 py-2">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {stats.byType.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-neutral-400">No data.</td></tr>
              )}
              {stats.byType.map((t) => (
                <tr key={t.type}>
                  <td className="px-4 py-2 font-medium text-neutral-900">{t.type}</td>
                  <td className="px-4 py-2">{t.count}</td>
                  <td className="px-4 py-2">{formatNumber(t.days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Days by Employee
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                <th className="px-4 py-2">Employee</th>
                <th className="px-4 py-2">Records</th>
                <th className="px-4 py-2">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {stats.byEmployee.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-neutral-400">No data.</td></tr>
              )}
              {stats.byEmployee.map((e) => (
                <tr key={e.employee}>
                  <td className="px-4 py-2 font-medium text-neutral-900">{e.employee}</td>
                  <td className="px-4 py-2">{e.count}</td>
                  <td className="px-4 py-2">{formatNumber(e.days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <LeaveRecordsTable records={records} teams={teams} roster={roster} />
    </div>
  );
}
