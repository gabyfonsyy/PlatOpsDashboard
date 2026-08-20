/**
 * "Tool-assisted" cycle-time comparison (SE/ST) — measures whether the tools recently introduced
 * to SEs have actually shortened backend execution time. Cycle time here = the span from when a
 * ticket first moved OUT of Backlog/To Do (`first_out_of_backlog_todo`) to when it entered For
 * Peer Review (`cycle_time_end`, already computed by extractReviewCycleTimeRange_ in JiraSync.gs)
 * — both already-synced fields, no new changelog extraction needed for this report.
 *
 * Restricted to issue types whose review path actually ends at For Peer Review
 * (cycleTimeEndStatusForIssueType_ in JiraSync.gs) — Investigations (Data Generation, External
 * Support Request, Investigation, Team Viewer) end at For Checking/For Product Team instead, so
 * `cycle_time_end` wouldn't mean the same thing for those.
 *
 * Splits tickets CREATED in the period into "tool-assisted" (Jira label match, case-insensitive,
 * defaults to 'tool-assisted') vs every other in-scope ticket, so the two averages are directly
 * comparable — the whole point of the report is seeing whether the tool-assisted group is faster.
 */
function getToolAssistedCycleTimeReport_(params) {
  const label = String(params.label || 'tool-assisted').trim().toLowerCase();
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);

  const rows = getRawRowsForYears_('ST', startDate, endDate).filter((r) => {
    if (!r.created) return false;
    const createdDate = toIsoDate_(new Date(r.created));
    if (createdDate < startDate || createdDate > endDate) return false;
    return cycleTimeEndStatusForIssueType_(r.issue_type) === 'for peer review';
  });

  const withCycleTime = rows
    .filter((r) => r.first_out_of_backlog_todo && r.cycle_time_end)
    .map((r) => {
      const labelList = String(r.labels || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
      return {
        issueKey: r.issue_key,
        issueType: r.issue_type,
        assignee: r.assigned_se || '(unassigned)',
        labels: r.labels || '',
        hasLabel: labelList.indexOf(label) !== -1,
        created: r.created,
        todoExitAt: r.first_out_of_backlog_todo,
        peerReviewAt: r.cycle_time_end,
        cycleTimeMinutes: round2_(minutesBetween_(new Date(r.first_out_of_backlog_todo), new Date(r.cycle_time_end))),
      };
    });

  const toolAssisted = withCycleTime.filter((t) => t.hasLabel).sort((a, b) => b.cycleTimeMinutes - a.cycleTimeMinutes);
  const others = withCycleTime.filter((t) => !t.hasLabel);

  const avgMinutes = (list) =>
    list.length ? round2_(list.reduce((sum, t) => sum + t.cycleTimeMinutes, 0) / list.length) : null;

  return {
    team: 'ST',
    range: params.range,
    period: params.period,
    label: params.label || 'tool-assisted',
    toolAssisted: {
      count: toolAssisted.length,
      avgCycleTimeMinutes: avgMinutes(toolAssisted),
      tickets: toolAssisted,
    },
    others: {
      count: others.length,
      avgCycleTimeMinutes: avgMinutes(others),
    },
  };
}
