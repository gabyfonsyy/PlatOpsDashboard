/**
 * Lead Time / Cycle Time deep-dive — the drill-down behind those two scorecards for DE/DEV
 * (teams without peer-review tracking, where Cycle Time = first_out_of_backlog_todo -> resolved
 * and Lead Time = created -> resolved, both using the changelog-derived resolved_datetime — see
 * JiraSync.gs). One shared function for both metrics (`params.metric` = 'lead' | 'cycle') since
 * the breakdown shape is identical either way — only which two timestamps get diffed differs.
 *
 * Scans EVERY raw year tab, not just the ones the period spans — same reason BacklogAgingApi.gs
 * does: raw tabs are keyed by CREATED year, so a ticket created in December and resolved in
 * January would be missed by a created-year-bounded scan. sheetToObjectsCached_ keeps repeated
 * reads cheap.
 */
function getLeadCycleTimeDrilldownReport_(params) {
  const metric = params.metric === 'cycle' ? 'cycle' : 'lead';
  const { startDate, endDate } = resolvePeriodToDateRange_(params.range, params.period, params.start, params.end);
  const team = getTeamsConfig_().find((t) => t.team_key === params.team);
  if (!team) throw new Error(`Unknown team: ${params.team}`);
  const issueType = params.issueType || '';

  const durationMinutesFor = function (r) {
    if (!r.resolved_datetime) return null;
    if (metric === 'cycle') {
      if (!r.first_out_of_backlog_todo) return null;
      return minutesBetween_(new Date(r.first_out_of_backlog_todo), new Date(r.resolved_datetime));
    }
    if (!r.created) return null;
    return minutesBetween_(new Date(r.created), new Date(r.resolved_datetime));
  };

  const withDuration = getAllRawRowsForTeam_(team.team_key)
    .filter((r) => {
      if (issueType && r.issue_type !== issueType) return false;
      if (!r.resolved_datetime) return false;
      const resolvedIso = toDisplayDate_(r.resolved_datetime);
      return resolvedIso && resolvedIso >= startDate && resolvedIso <= endDate;
    })
    .map((r) => ({ row: r, minutes: durationMinutesFor(r) }))
    .filter((x) => x.minutes !== null && isFinite(x.minutes));

  const topTickets = withDuration
    .slice()
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10)
    .map((x) => ({
      issueKey: x.row.issue_key,
      issueType: x.row.issue_type || '',
      assignee: backlogAgingAssignee_(team, x.row) || '(unassigned)',
      product: x.row.product || '(none)',
      labels: x.row.labels || '',
      minutes: round2_(x.minutes),
      createdAt: x.row.created,
      startedAt: x.row.first_out_of_backlog_todo || '',
      resolvedAt: x.row.resolved_datetime,
    }));

  function rankBy(keyFn) {
    const buckets = {};
    withDuration.forEach((x) => {
      const key = keyFn(x.row);
      if (!key) return;
      if (!buckets[key]) buckets[key] = { key: key, sum: 0, count: 0 };
      buckets[key].sum += x.minutes;
      buckets[key].count++;
    });
    return Object.keys(buckets)
      .map((k) => ({ key: k, avgMinutes: round2_(buckets[k].sum / buckets[k].count), count: buckets[k].count }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes);
  }

  const byAssignee = rankBy(function (r) { return backlogAgingAssignee_(team, r) || '(unassigned)'; });
  const byProduct = rankBy(function (r) { return r.product || '(none)'; });

  // Labels: a ticket's labels are a CSV of tags — expand to individual tokens and attribute this
  // ticket's duration to each one, excluding department/team tags like se-ops, hr-ops, payroll-ops
  // (anything containing "-ops") since those aren't a meaningful task classification here.
  const labelBuckets = {};
  withDuration.forEach((x) => {
    String(x.row.labels || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((label) => {
      if (label.toLowerCase().indexOf('-ops') !== -1) return;
      if (!labelBuckets[label]) labelBuckets[label] = { key: label, sum: 0, count: 0 };
      labelBuckets[label].sum += x.minutes;
      labelBuckets[label].count++;
    });
  });
  const byLabel = Object.keys(labelBuckets)
    .map((k) => ({ key: k, avgMinutes: round2_(labelBuckets[k].sum / labelBuckets[k].count), count: labelBuckets[k].count }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes);

  return {
    team: team.team_key,
    range: params.range,
    period: params.period,
    metric: metric,
    issueType: issueType || null,
    assigneeLabel: backlogAgingAssigneeLabel_(team),
    count: withDuration.length,
    avgMinutes: withDuration.length
      ? round2_(withDuration.reduce(function (sum, x) { return sum + x.minutes; }, 0) / withDuration.length)
      : null,
    topTickets: topTickets,
    byAssignee: byAssignee,
    byProduct: byProduct,
    byLabel: byLabel,
  };
}
