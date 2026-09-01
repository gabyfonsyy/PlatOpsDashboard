import { getTeams } from "@/lib/teams";
import { getRoster } from "@/lib/roster";
import { fetchGas } from "@/lib/gas-client";
import { isAiConfigured } from "@/lib/ai";
import type { RosterMember } from "@/lib/types";
import { teamLabel } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import {
  EMPTY_INCIDENT_RESULT,
  INCIDENT_ISSUE_GROUPS,
  INCIDENT_MONTHS,
  INCIDENT_PERIODS,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_CODES,
  formatScore,
  formatScoreImpact,
  issueGroupTone,
  severityTone,
  type IncidentListResult,
} from "@/lib/incidents";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { IncidentFilters } from "@/components/incidents/IncidentFilters";
import { IncidentLogsTable } from "@/components/incidents/IncidentLogsTable";
import { IncidentQueueTable } from "@/components/incidents/IncidentQueueTable";
import { SyncIncidentsButton } from "@/components/incidents/SyncIncidentsButton";
import { PageTitle } from "@/components/ui/PageTitle";

/** period value -> label for the month entries, so the header can name the window. */
const INCIDENT_MONTH_LABELS: Record<string, string> = Object.fromEntries(
  INCIDENT_MONTHS.map((m) => [m.value, m.label])
);

export default async function IncidentLogsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = typeof searchParams.team === "string" ? searchParams.team : "";
  const year =
    typeof searchParams.year === "string" && /^\d{4}$/.test(searchParams.year)
      ? searchParams.year
      : String(new Date().getFullYear());
  // "" = full year, "Q1".."Q4" = quarter, "01".."12" = month. Validated here so a hand-edited
  // URL can't push an arbitrary string into the GAS date resolver.
  const rawPeriod = typeof searchParams.period === "string" ? searchParams.period.toUpperCase() : "";
  const period = /^(Q[1-4]|0[1-9]|1[0-2])$/.test(rawPeriod) ? rawPeriod : "";
  const group = typeof searchParams.group === "string" ? searchParams.group : "";
  const member = typeof searchParams.member === "string" ? searchParams.member : "";

  // Defaults to the full year, not the current month. Incidents are sparse by construction —
  // each one is a ticket a manager tagged by hand — so a month-scoped default would routinely
  // open on an empty page, which on a new feature reads as "it's broken" rather than "nothing
  // happened in August". The period selector narrows from there.

  const [teams, roster, result] = await Promise.all([
    getTeams().catch(() => [] as Awaited<ReturnType<typeof getTeams>>),
    getRoster().catch(() => [] as RosterMember[]),
    fetchGas<IncidentListResult>(
      "incidents",
      {
        team: team || undefined,
        year,
        period: period || undefined,
        group: group || undefined,
        member: member || undefined,
      },
      { cache: "no-store" }
    ).catch(() => EMPTY_INCIDENT_RESULT),
  ]);

  const { tickets, logs, stats, availableYears } = result;
  // The backend owns the floor (INCIDENT_SYNC_START_DATE); the page only reports it, so the two
  // can't disagree about what "from 2026" means.
  const windowStart = result.startDate;

  // team_key -> presentation + whether the team even has a validator role. Built from
  // TEAMS_CONFIG rather than hardcoded, so adding a fourth team needs no change here.
  const teamMeta = Object.fromEntries(
    teams.map((t) => [t.team_key, { hasPeerReview: t.has_peer_review_tracking, label: teamLabel(t.team_name) }])
  );
  const teamTabs = teams.map((t) => ({ key: t.team_key, label: teamLabel(t.team_name) }));

  const loggedKeys = new Set(logs.map((l) => l.issue_key));
  const queue = tickets.filter((t) => !loggedKeys.has(t.issue_key));

  const rosterNames = roster
    .filter((m) => !team || m.team_key === team)
    .map((m) => m.employee_name);

  // JIRA_BASE_URL is server-only, so the deep-link base is handed to the client tables as a prop
  // rather than read from the environment inside them.
  const jiraBaseUrl = process.env.JIRA_BASE_URL ?? "https://sprouthq.atlassian.net";
  const aiEnabled = isAiConfigured();

  const worstSeverity = stats.bySeverity.find((s) => s.count > 0);

  // Issue-type grouping only applies to teams that file more than one issue type. With "All teams"
  // selected it stays available, since ST is in scope.
  const issueGroupTeamKeys = result.issueGroupTeamKeys ?? ["ST"];
  const showIssueGroups = !team || issueGroupTeamKeys.includes(team);

  const periodLabel =
    INCIDENT_PERIODS.find((p) => p.value === period)?.label ??
    INCIDENT_MONTH_LABELS[period] ??
    "Full year";

  // With one team in scope there is a single team score to headline; across teams the per-team
  // rows below carry it, and averaging the averages would misweight teams of different sizes.
  const singleTeamScore = stats.teamScores.length === 1 ? stats.teamScores[0] : null;

  // Backend-owned so the picker can never offer a name GAS would reject.
  const validatorNames = result.validatorNames ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <PageTitle page="incidents" />
          <p className="text-sm text-neutral-500 mt-1 max-w-2xl">
            Tickets you tagged with <span className="font-medium text-neutral-700">Report Tagging</span> in Jira,
            with the severity and feedback that feed each person&apos;s evaluation. Clear that field in Jira
            and a sync takes the ticket off this page; &ldquo;not an incident&rdquo; on a row does the same from
            this end, by clearing the field for you. Your feedback stays here — it is never written to Jira.
            {windowStart && (
              <> Incidents are tracked from <span className="font-medium text-neutral-700">{windowStart}</span> onwards.</>
            )}
          </p>
        </div>
        <SyncIncidentsButton team={team || undefined} />
      </div>

      <IncidentFilters
        teams={teamTabs}
        availableYears={availableYears}
        team={team}
        year={year}
        period={period}
        group={group}
        issueGroups={result.issueGroups ?? [...INCIDENT_ISSUE_GROUPS]}
        showIssueGroups={showIssueGroups}
        member={member}
        availableMembers={result.availableMembers ?? []}
      />

      {/* Two panels on one row: each is a short table, and stacked full-width they left a lot of
          dead horizontal space and pushed the logged incidents below the fold. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200/70 text-xs font-medium text-neutral-500 uppercase tracking-wide">
          Team Score · {periodLabel}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
              <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                <th className="px-4 py-2">Team</th>
                <th className="px-4 py-2">Active Roster</th>
                <th className="px-4 py-2 text-right">Total Deduction</th>
                <th className="px-4 py-2 text-right">Avg / Member</th>
                <th className="px-4 py-2 text-right">Team Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {stats.teamScores.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No teams in scope.</td></tr>
              )}
              {stats.teamScores.map((t) => (
                <tr key={t.team_key}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Badge>{teamMeta[t.team_key]?.label ?? t.team_key}</Badge>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatNumber(t.rosterCount)}</td>
                  <td className="px-4 py-2 text-right text-red-600 tabular-nums">
                    −{formatScore(t.deductionTotal)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-500 tabular-nums">
                    −{formatScore(t.avgDeductionPerMember)}
                  </td>
                  {/* A number here would read as a finished assessment. While tickets are still
                      awaiting feedback the score genuinely isn't known, so say that instead. */}
                  <td className="px-4 py-2 text-right tabular-nums">
                    {t.scoreReady ? (
                      <span className="font-semibold text-neutral-900">{formatScore(t.teamScore)}</span>
                    ) : (
                      <span className="text-xs font-normal text-amber-600">
                        {formatNumber(t.unloggedTickets)} to write up
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
          Team score = 100 − (total deductions ÷ active roster size), so it is the true average of
          its members&apos; individual scores. Always covers the whole team, even when a member
          filter is applied. A score appears only once every tagged ticket in the period has a
          log — otherwise a team with an untouched backlog would show a perfect 100.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200/70 text-xs font-medium text-neutral-500 uppercase tracking-wide">
          By Issue Type Group
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
              <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                <th className="px-4 py-2">Group</th>
                <th className="px-4 py-2">Tagged Tickets</th>
                <th className="px-4 py-2">Logs</th>
                <th className="px-4 py-2 text-right">Score Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {stats.byIssueGroup.map((g) => (
                <tr key={g.group}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Badge tone={issueGroupTone(g.group)}>{g.group}</Badge>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatNumber(g.tickets)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatNumber(g.logs)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-red-600 tabular-nums">
                    {formatScoreImpact(g.scoreImpact)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
          Backend Changes: Backend Changes, Account Creation, Task, Company Policy, Data Deletion,
          Technical Story · Investigation: Data Generation, Investigation · anything else falls in Others.
          Applies to SE only — DBA and DevOps file a single issue type, so their incidents aren&apos;t grouped.
        </p>
      </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Incident Logs"
          value={formatNumber(stats.totalLogs)}
          sublabel={`across ${formatNumber(stats.totalTickets)} tagged ticket${stats.totalTickets === 1 ? "" : "s"}`}
          tooltip="One log per person per incident. An SE incident can carry two — one for the doer, one for the validator."
        />
        <MetricCard
          label={singleTeamScore ? "Team Score" : "Total Deduction"}
          value={
            singleTeamScore
              ? singleTeamScore.scoreReady
                ? formatScore(singleTeamScore.teamScore)
                : "—"
              : formatScoreImpact(stats.totalScoreImpact)
          }
          sublabel={
            singleTeamScore
              ? singleTeamScore.scoreReady
                ? `100 − ${formatScore(singleTeamScore.avgDeductionPerMember)} avg across ${singleTeamScore.rosterCount} member${singleTeamScore.rosterCount === 1 ? "" : "s"}`
                : `${formatNumber(singleTeamScore.unloggedTickets)} ticket${singleTeamScore.unloggedTickets === 1 ? "" : "s"} still to write up`
              : "sum of every deduction in view"
          }
          tooltip={
            singleTeamScore
              ? "100 minus the team's total severity deductions divided by its active roster size. Shown only once every tagged ticket in the period has a log — until then the score isn't determined yet."
              : "Sum of every log's severity deduction: S1 -3, S2 -2, S3 -1.5, S4 -1. Pick a single team to see its Team Score."
          }
        />
        <MetricCard
          label="Awaiting Feedback"
          value={formatNumber(stats.unloggedTickets)}
          sublabel={stats.unloggedTickets ? "tagged but not written up" : "all caught up"}
          tooltip="Tickets tagged in Jira with no incident log yet."
          // The one genuinely good state on this page gets a slow ambient drift in ADHD View.
          // Styling only — the number and sublabel already say it, so nothing depends on motion.
          className={stats.unloggedTickets === 0 ? "adhd-happy" : undefined}
        />
        <MetricCard
          label="Most Common"
          value={worstSeverity ? worstSeverity.severity : "—"}
          sublabel={worstSeverity ? `${worstSeverity.label} · ${worstSeverity.count} log${worstSeverity.count === 1 ? "" : "s"}` : undefined}
          tooltip="Highest-severity band that has at least one log in this period."
        />
      </div>

      <IncidentQueueTable
        tickets={queue}
        teamMeta={teamMeta}
        jiraBaseUrl={jiraBaseUrl}
        aiEnabled={aiEnabled}
        rosterNames={rosterNames}
        validatorNames={validatorNames}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200/70 text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Severity Mix
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-100">
              {INCIDENT_SEVERITY_CODES.map((code) => {
                const row = stats.bySeverity.find((s) => s.severity === code);
                const rubric = INCIDENT_SEVERITIES[code];
                return (
                  <tr key={code} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={severityTone(code)}>{code}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-900">{rubric.label}</p>
                      <p className="text-xs text-neutral-500">{rubric.description}</p>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <p className="font-semibold text-neutral-900 tabular-nums">{row?.count ?? 0}</p>
                      <p className="text-xs text-red-600 tabular-nums">{formatScoreImpact(rubric.scoreImpact)} each</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200/70 text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Score by Person · {periodLabel}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50/70 border-b border-neutral-200/70">
                <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Person</th>
                  <th className="px-4 py-2">Logs</th>
                  <th className="px-4 py-2">Doer / Val</th>
                  <th className="px-4 py-2 text-right">Deduction</th>
                  <th className="px-4 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {stats.byEmployee.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No logs yet.</td></tr>
                )}
                {stats.byEmployee.map((e) => (
                  <tr key={e.employee}>
                    <td className="px-4 py-2 font-medium text-neutral-900 whitespace-nowrap">{e.employee}</td>
                    <td className="px-4 py-2 tabular-nums">{e.count}</td>
                    <td className="px-4 py-2 text-neutral-500 tabular-nums whitespace-nowrap">
                      {e.asDoer} / {e.asValidator}
                    </td>
                    <td className="px-4 py-2 text-right text-red-600 tabular-nums">
                      −{formatScore(e.deduction)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-neutral-900 tabular-nums">
                      {formatScore(e.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-neutral-400 border-t border-neutral-200/70">
            Individual score = 100 − the sum of that person&apos;s severity deductions for the period.
            Only people with at least one log appear; everyone else is at 100.
          </p>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200/70 text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Concern Categories
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-100">
              {stats.byCategory.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-neutral-400">Nothing categorised yet.</td></tr>
              )}
              {stats.byCategory.map((c) => (
                <tr key={c.category}>
                  <td className="px-4 py-2 text-neutral-700">{c.category}</td>
                  <td className="px-4 py-2 text-right font-semibold text-neutral-900 tabular-nums">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Logged incidents</h2>
        <IncidentLogsTable
          tickets={tickets}
          logs={logs}
          teamMeta={teamMeta}
          jiraBaseUrl={jiraBaseUrl}
          aiEnabled={aiEnabled}
          rosterNames={rosterNames}
          validatorNames={validatorNames}
        />
      </div>
    </div>
  );
}
