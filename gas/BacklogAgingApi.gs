/**
 * Backlog Aging drill-down — the per-ticket list sitting behind the Backlog Aging scorecard
 * (DBA/DevOps in particular, where the owner is the Assigned COD field).
 *
 * Recomputes from RAW_<team>_<year> rather than reading METRICS_DAILY: the scorecard number is a
 * rolled-up (issue_type, date) count, which has no per-ticket identity left to list. The overdue
 * test here is deliberately character-for-character the same one buildResolvedIndex_
 * (Aggregation.gs) applies when it builds `overdue_resolved_on_date` — a DATE comparison,
 * resolved calendar day strictly LATER than the due date — so the row count on this page
 * reconciles with the "N of M resolved overdue" on the card.
 *
 * Scans EVERY raw year tab, not just the ones the period spans: raw tabs are keyed by CREATED
 * year, so a ticket created in December and resolved in January lives in the previous year's
 * tab and getRawRowsForYears_ would silently miss it. Same reason buildResolvedIndex_ walks
 * listRawYears_ in full. sheetToObjectsCached_ keeps the repeated reads cheap.
 */
function getBacklogAgingReport_(params) {
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);
  const teams = params.team === 'ALL'
    ? getActiveTeamsConfig_()
    : getTeamsConfig_().filter((t) => t.team_key === params.team);

  if (!teams.length) throw new Error(`Unknown team: ${params.team}`);

  const issueType = params.issueType || '';
  const tickets = [];
  let resolvedInPeriod = 0;

  teams.forEach((team) => {
    getAllRawRowsForTeam_(team.team_key).forEach((r) => {
      if (!r.resolved_datetime) return;
      if (issueType && r.issue_type !== issueType) return;

      const resolvedIso = toDisplayDate_(r.resolved_datetime);
      if (!resolvedIso || resolvedIso < startDate || resolvedIso > endDate) return;
      // Denominator of the rate — every ticket resolved in the period, overdue or not.
      resolvedInPeriod++;

      const dueIso = toDisplayDate_(r.due_date);
      if (!dueIso || resolvedIso <= dueIso) return;

      tickets.push({
        teamKey: team.team_key,
        issueKey: r.issue_key,
        issueType: r.issue_type || '',
        assignee: backlogAgingAssignee_(team, r) || '(unassigned)',
        dueDate: dueIso,
        resolvedDate: resolvedIso,
        daysOverdue: isoDateDiffDays_(dueIso, resolvedIso),
      });
    });
  });

  tickets.sort((a, b) => (b.daysOverdue - a.daysOverdue) || String(a.issueKey).localeCompare(String(b.issueKey)));

  return {
    team: params.team,
    range: params.range,
    period: params.period,
    issueType: issueType || null,
    // Mixed ownership across an ALL rollup — only a single-team report can name the field.
    assigneeLabel: teams.length === 1 ? backlogAgingAssigneeLabel_(teams[0]) : 'Assignee',
    overdueCount: tickets.length,
    resolvedInPeriod: resolvedInPeriod,
    backlogAgingRate: resolvedInPeriod ? round4_(tickets.length / resolvedInPeriod) : null,
    tickets: tickets,
  };
}

/** The team's configured owner column — same switch Aggregation.gs uses for per-assignee rollups. */
function backlogAgingAssignee_(team, row) {
  return team.assignee_field_id === 'customfield_10189' ? row.assigned_se : row.assigned_cod;
}

function backlogAgingAssigneeLabel_(team) {
  return team.assignee_field_id === 'customfield_10189' ? 'Assigned SE' : 'Assigned COD';
}

/**
 * Whole-day difference between two 'yyyy-MM-dd' strings. Anchored to UTC midnight on both sides
 * so the arithmetic can't be skewed by a DST-style offset shift between the two dates.
 */
function isoDateDiffDays_(fromIso, toIso) {
  return Math.round((isoDateToUtcMs_(toIso) - isoDateToUtcMs_(fromIso)) / 86400000);
}

function isoDateToUtcMs_(iso) {
  const parts = String(iso).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}
