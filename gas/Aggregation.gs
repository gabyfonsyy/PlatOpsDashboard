/**
 * Precomputes METRICS_DAILY and METRICS_BY_ASSIGNEE_MONTHLY from raw ticket rows.
 * Runs every 2h, ~15min after syncAllTeams. Only touches "dirty" dates (tracked by
 * JiraSync.gs's markDirtyDate_/flushDirtyDates_), so a run with few changed tickets
 * stays fast even as raw tabs grow into the tens of thousands of rows.
 *
 * The frontend NEVER reads raw ticket tabs directly — only these precomputed tables,
 * via MetricsApi.gs.
 */

function aggregateAllTeams() {
  getActiveTeamsConfig_().forEach((team) => {
    try {
      aggregateTeam_(team);
    } catch (err) {
      notifyFailure_(`aggregateAllTeams failed for ${team.team_key}`, err);
    }
  });
}

function aggregateTeam_(team) {
  const agg = readAggCheckpoint_(team.team_key);
  const dirtyDates = agg.dirty_dates_json ? JSON.parse(agg.dirty_dates_json) : [];
  if (!dirtyDates.length) return;

  // Group by year so each RAW_<team>_<year> tab is read at most once per run.
  const datesByYear = {};
  dirtyDates.forEach((d) => {
    const year = d.slice(0, 4);
    (datesByYear[year] = datesByYear[year] || []).push(d);
  });

  const affectedMonths = {};

  Object.keys(datesByYear).forEach((year) => {
    const sheet = getOrCreateRawTab_(team.team_key, year);
    const allRows = sheetToObjects_(sheet);

    datesByYear[year].forEach((isoDate) => {
      const rowsForDate = allRows.filter((r) => r.created && toIsoDate_(new Date(r.created)) === isoDate);

      const byIssueType = {};
      rowsForDate.forEach((r) => {
        const type = r.issue_type || 'Unspecified';
        (byIssueType[type] = byIssueType[type] || []).push(r);
      });

      Object.keys(byIssueType).forEach((issueType) => {
        const bucket = computeDailyBucket_(team, byIssueType[issueType]);
        upsertMetricsDailyRow_(team.team_key, issueType, isoDate, bucket);
      });

      affectedMonths[isoDate.slice(0, 7)] = true;
    });
  });

  Object.keys(affectedMonths).forEach((month) => recomputeAssigneeMonthly_(team, month));

  writeAggCheckpoint_(team.team_key, { last_aggregated_at: nowIso_(), dirty_dates_json: '[]' });
}

/** Business logic for one team+issueType+date bucket — see plan Section 4.4 for the exact formulas. */
function computeDailyBucket_(team, rows) {
  let ticketsResolved = 0;
  let leadTimeSum = 0, leadTimeCount = 0;
  let cycleTimeSum = 0, cycleTimeCount = 0;
  let fcrEligible = 0, fcrNotEscalated = 0, escalated = 0;
  let resolvedAfterDue = 0, totalForAgingDenom = 0;
  let assignedCount = 0;
  const holdingReasonCounts = {};
  const rejectionCategoryCounts = {};
  const cancellationReasonCounts = {};
  let onHoldPickupSum = 0, onHoldPickupCount = 0;

  rows.forEach((r) => {
    const created = r.created ? new Date(r.created) : null;
    const resolved = r.resolved_datetime ? new Date(r.resolved_datetime) : null;
    const cycleStart = r.first_out_of_backlog_todo ? new Date(r.first_out_of_backlog_todo) : null;
    const due = r.due_date ? new Date(r.due_date) : null;
    const onHoldEntered = r.on_hold_entered_at ? new Date(r.on_hold_entered_at) : null;
    const onHoldExited = r.on_hold_exited_at ? new Date(r.on_hold_exited_at) : null;

    if (resolved) {
      ticketsResolved++;
      if (created) { leadTimeSum += minutesBetween_(created, resolved); leadTimeCount++; }
      if (cycleStart) { cycleTimeSum += minutesBetween_(cycleStart, resolved); cycleTimeCount++; }
    }

    if (team.has_fcr_escalation) {
      const fcr = r.fcr_value;
      const esc = r.escalation_value;
      if (fcr && fcr !== 'N/A') {
        fcrEligible++;
        if (esc === 'N/A' && fcr === 'Yes') fcrNotEscalated++;
        if (esc && esc !== 'N/A' && fcr === 'No') escalated++;
      }
    }

    if (due) {
      totalForAgingDenom++;
      if (resolved && resolved > due) resolvedAfterDue++;
    }

    const assigneeField = team.assignee_field_id === 'customfield_10189' ? r.assigned_se : r.assigned_cod;
    if (assigneeField) assignedCount++;

    if (team.has_holding_reason && r.holding_reason) {
      holdingReasonCounts[r.holding_reason] = (holdingReasonCounts[r.holding_reason] || 0) + 1;
    }
    if (team.has_rejection_category && r.rejection_category) {
      rejectionCategoryCounts[r.rejection_category] = (rejectionCategoryCounts[r.rejection_category] || 0) + 1;
    }
    if (team.has_cancellation_reason && r.cancellation_reason) {
      cancellationReasonCounts[r.cancellation_reason] = (cancellationReasonCounts[r.cancellation_reason] || 0) + 1;
    }
    if (onHoldEntered && onHoldExited) {
      onHoldPickupSum += minutesBetween_(onHoldEntered, onHoldExited);
      onHoldPickupCount++;
    }
  });

  return {
    tickets_created_count: rows.length,
    tickets_resolved_count: ticketsResolved,
    lead_time_sum_minutes: leadTimeSum,
    lead_time_count: leadTimeCount,
    cycle_time_sum_minutes: cycleTimeSum,
    cycle_time_count: cycleTimeCount,
    fcr_eligible_count: fcrEligible,
    fcr_not_escalated_count: fcrNotEscalated,
    escalated_count: escalated,
    resolved_after_due_count: resolvedAfterDue,
    total_for_aging_denominator: totalForAgingDenom,
    assigned_count: assignedCount,
    holding_reason_json: JSON.stringify(holdingReasonCounts),
    rejection_category_json: JSON.stringify(rejectionCategoryCounts),
    cancellation_reason_json: JSON.stringify(cancellationReasonCounts),
    on_hold_pickup_sum_minutes: onHoldPickupSum,
    on_hold_pickup_count: onHoldPickupCount,
  };
}

/** Full recompute of one team+month (not incremental) — simplest way to avoid double-counting across dirty-date reruns. */
function recomputeAssigneeMonthly_(team, month) {
  const year = month.slice(0, 4);
  const sheet = getOrCreateRawTab_(team.team_key, year);
  const allRows = sheetToObjects_(sheet);
  const rowsForMonth = allRows.filter((r) => r.created && monthLabel_(new Date(r.created)) === month);

  const byAssignee = {};
  rowsForMonth.forEach((r) => {
    const assigneeField = team.assignee_field_id === 'customfield_10189' ? r.assigned_se : r.assigned_cod;
    const assignee = assigneeField || r.assignee_display_name || 'Unassigned';
    (byAssignee[assignee] = byAssignee[assignee] || []).push(r);
  });

  Object.keys(byAssignee).forEach((assignee) => {
    const bucket = computeAssigneeMonthlyBucket_(team, byAssignee[assignee]);
    upsertAssigneeMonthlyRow_(team.team_key, assignee, month, bucket);
  });
}

function computeAssigneeMonthlyBucket_(team, rows) {
  let resolved = 0;
  let leadTimeSum = 0, leadTimeCount = 0;
  let cycleTimeSum = 0, cycleTimeCount = 0;
  let fcrEligible = 0, fcrNotEscalated = 0, escalated = 0;
  let resolvedAfterDue = 0;

  rows.forEach((r) => {
    const created = r.created ? new Date(r.created) : null;
    const resolvedAt = r.resolved_datetime ? new Date(r.resolved_datetime) : null;
    const cycleStart = r.first_out_of_backlog_todo ? new Date(r.first_out_of_backlog_todo) : null;
    const due = r.due_date ? new Date(r.due_date) : null;

    if (resolvedAt) {
      resolved++;
      if (created) { leadTimeSum += minutesBetween_(created, resolvedAt); leadTimeCount++; }
      if (cycleStart) { cycleTimeSum += minutesBetween_(cycleStart, resolvedAt); cycleTimeCount++; }
      if (due && resolvedAt > due) resolvedAfterDue++;
    }

    if (team.has_fcr_escalation) {
      const fcr = r.fcr_value;
      const esc = r.escalation_value;
      if (fcr && fcr !== 'N/A') {
        fcrEligible++;
        if (esc === 'N/A' && fcr === 'Yes') fcrNotEscalated++;
        if (esc && esc !== 'N/A' && fcr === 'No') escalated++;
      }
    }
  });

  return {
    tickets_assigned: rows.length,
    tickets_resolved: resolved,
    escalated_count: escalated,
    fcr_eligible_count: fcrEligible,
    fcr_not_escalated_count: fcrNotEscalated,
    resolved_after_due_count: resolvedAfterDue,
    avg_lead_time_minutes: leadTimeCount ? round2_(leadTimeSum / leadTimeCount) : '',
    avg_cycle_time_minutes: cycleTimeCount ? round2_(cycleTimeSum / cycleTimeCount) : '',
  };
}

function minutesBetween_(a, b) {
  return (b.getTime() - a.getTime()) / 60000;
}

/** team_key|issue_type|date -> row number, built once per execution so repeated upserts don't rescan the sheet. */
var _metricsDailyIndexCache_ = null;

function getMetricsDailyIndex_() {
  if (_metricsDailyIndexCache_) return _metricsDailyIndexCache_;
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY');
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach((row, i) => {
      map[`${row[0]}|${row[1]}|${formatDateCell_(row[2])}`] = i + 2;
    });
  }
  _metricsDailyIndexCache_ = { sheet: sheet, map: map, nextRow: lastRow + 1 };
  return _metricsDailyIndexCache_;
}

function formatDateCell_(value) {
  return value instanceof Date ? toIsoDate_(value) : String(value);
}

function upsertMetricsDailyRow_(teamKey, issueType, date, bucket) {
  const index = getMetricsDailyIndex_();
  const key = `${teamKey}|${issueType}|${date}`;
  const record = Object.assign({ team_key: teamKey, issue_type: issueType, date: date }, bucket);
  const existingRow = index.map[key];
  if (existingRow) {
    updateSheetRow_(index.sheet, existingRow, record);
  } else {
    appendObjectToSheet_(index.sheet, record);
    index.map[key] = index.nextRow;
    index.nextRow += 1;
  }
}

var _assigneeMonthlyIndexCache_ = null;

function getAssigneeMonthlyIndex_() {
  if (_assigneeMonthlyIndexCache_) return _assigneeMonthlyIndexCache_;
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach((row, i) => {
      map[`${row[0]}|${row[1]}|${row[2]}`] = i + 2;
    });
  }
  _assigneeMonthlyIndexCache_ = { sheet: sheet, map: map, nextRow: lastRow + 1 };
  return _assigneeMonthlyIndexCache_;
}

function upsertAssigneeMonthlyRow_(teamKey, assignee, month, bucket) {
  const index = getAssigneeMonthlyIndex_();
  const key = `${teamKey}|${assignee}|${month}`;
  const record = Object.assign({ team_key: teamKey, assignee_display_name: assignee, month: month }, bucket);
  const existingRow = index.map[key];
  if (existingRow) {
    updateSheetRow_(index.sheet, existingRow, record);
  } else {
    appendObjectToSheet_(index.sheet, record);
    index.map[key] = index.nextRow;
    index.nextRow += 1;
  }
}

function readAggCheckpoint_(teamKey) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('AGG_CHECKPOINT');
  const rows = sheetToObjects_(sheet);
  return rows.find((r) => r.team_key === teamKey) || { team_key: teamKey, dirty_dates_json: '[]' };
}

function writeAggCheckpoint_(teamKey, patch) {
  const sheet = getJiraDataSpreadsheet_().getSheetByName('AGG_CHECKPOINT');
  const rows = sheetToObjects_(sheet);
  const existing = rows.find((r) => r.team_key === teamKey);
  const record = Object.assign({}, existing, patch, { team_key: teamKey });
  if (existing) {
    updateSheetRow_(sheet, existing._row, record);
  } else {
    appendObjectToSheet_(sheet, record);
  }
}
