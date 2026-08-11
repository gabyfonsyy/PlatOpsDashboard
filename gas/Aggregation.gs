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
  // MetricsApi.gs's sheetToObjectsCached_ fronts both sheets with a 10-min TTL cache — drop it
  // now so dashboard reads see this run's changes immediately instead of waiting out the TTL.
  const jiraData = getJiraDataSpreadsheet_();
  invalidateSheetCache_(jiraData.getSheetByName('METRICS_DAILY'));
  invalidateSheetCache_(jiraData.getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY'));
}

function aggregateTeam_(team) {
  const agg = readAggCheckpoint_(team.team_key);
  let remainingDates = agg.dirty_dates_json ? JSON.parse(agg.dirty_dates_json) : [];
  if (!remainingDates.length) return;

  // Group by year so each RAW_<team>_<year> tab is read at most once per run.
  const datesByYear = {};
  remainingDates.forEach((d) => {
    const year = d.slice(0, 4);
    (datesByYear[year] = datesByYear[year] || []).push(d);
  });

  // Complete resolved-by-resolved-date index (issueType -> isoDate -> count) across ALL of the
  // team's raw years. Needed because a dirty date's resolved count can include older, unchanged
  // tickets that happened to resolve that day, so an index built from the dirty years alone would
  // undercount. buildResolvedIndex_ reads only the issue_type + resolved_datetime columns to keep
  // this cheap; if a team ever grows large enough that this dominates the run, promote it to a
  // maintained RESOLVED_DAILY table instead.
  const resolvedIdx = buildResolvedIndex_(team.team_key);
  const resolvedIndex = resolvedIdx.resolved;
  const overdueIndex = resolvedIdx.overdue;
  const fcrYesIndex = resolvedIdx.fcrYes;
  const escQualifyingIndex = resolvedIdx.escQualifying;

  const affectedMonths = {};

  // Process one year at a time and save the checkpoint after each year. A 6-minute
  // timeout therefore saves real progress — the next run resumes from the next year
  // rather than restarting the entire dirty list from scratch.
  for (const year of Object.keys(datesByYear).sort()) {
    const sheet = getOrCreateRawTab_(team.team_key, year);
    const allRows = sheetToObjects_(sheet);

    // Bucket rows by created-date once so each dirty date is a map lookup instead
    // of a full-array filter — O(rows) total for the year instead of O(dates * rows).
    const rowsByDate = {};
    allRows.forEach((r) => {
      if (!r.created) return;
      const isoDate = toIsoDate_(new Date(r.created));
      (rowsByDate[isoDate] = rowsByDate[isoDate] || []).push(r);
    });

    datesByYear[year].forEach((isoDate) => {
      const rowsForDate = rowsByDate[isoDate] || [];

      const byIssueType = {};
      rowsForDate.forEach((r) => {
        const type = r.issue_type || 'Unspecified';
        (byIssueType[type] = byIssueType[type] || []).push(r);
      });

      // Union of issue types created on this date OR resolved on this date — so a date with
      // resolutions but no creations still produces a row carrying its resolved-on-date count.
      const types = {};
      Object.keys(byIssueType).forEach((t) => { types[t] = true; });
      Object.keys(resolvedIndex).forEach((t) => { if (resolvedIndex[t][isoDate]) types[t] = true; });

      Object.keys(types).forEach((issueType) => {
        const bucket = computeDailyBucket_(team, byIssueType[issueType] || []);
        bucket.tickets_resolved_on_date =
          (resolvedIndex[issueType] && resolvedIndex[issueType][isoDate]) || 0;
        bucket.overdue_resolved_on_date =
          (overdueIndex[issueType] && overdueIndex[issueType][isoDate]) || 0;
        bucket.fcr_yes_resolved_on_date =
          (fcrYesIndex[issueType] && fcrYesIndex[issueType][isoDate]) || 0;
        bucket.escalation_qualifying_resolved_on_date =
          (escQualifyingIndex[issueType] && escQualifyingIndex[issueType][isoDate]) || 0;
        upsertMetricsDailyRow_(team.team_key, issueType, isoDate, bucket);
      });

      affectedMonths[isoDate.slice(0, 7)] = true;
    });

    remainingDates = remainingDates.filter((d) => d.slice(0, 4) !== year);
    writeAggCheckpoint_(team.team_key, { dirty_dates_json: JSON.stringify(remainingDates) });
  }

  const resolvedByAssigneeMonth = buildResolvedByAssigneeMonth_(team);
  Object.keys(affectedMonths).forEach((month) => recomputeAssigneeMonthly_(team, month, resolvedByAssigneeMonth));
  writeAggCheckpoint_(team.team_key, { last_aggregated_at: nowIso_(), dirty_dates_json: '[]' });
}

/** Sorted list of years for which a RAW_<team>_<year> tab exists. */
function listRawYears_(teamKey) {
  const prefix = `RAW_${teamKey}_`;
  return getJiraDataSpreadsheet_().getSheets()
    .map((s) => s.getName())
    .filter((n) => n.indexOf(prefix) === 0 && /^\d{4}$/.test(n.slice(prefix.length)))
    .map((n) => n.slice(prefix.length))
    .sort();
}

/**
 * "Real" escalation for the Escalation Rate: the Ticket Escalation field holds something other
 * than N/A, CA, SE, or blank (case-insensitive, trimmed). CA/SE are non-escalation dispositions,
 * so they don't count as escalated.
 */
function isRealEscalation_(esc) {
  if (!esc) return false;
  const v = String(esc).trim().toUpperCase();
  return v !== '' && v !== 'N/A' && v !== 'CA' && v !== 'SE';
}

/**
 * Rows to drop from per-assignee PERFORMANCE metrics only (team scorecards are unaffected): the
 * Automation for Jira bot always, and Unassigned tickets that only fell into the Unassigned bucket
 * because they reached a terminal status nobody works — Archived/Rejected on ST-shaped teams
 * (has_fcr_escalation), Cancelled on DE/DEV. Genuinely-unassigned active tickets are kept.
 */
function excludeFromAssigneePerf_(team, assignee, status) {
  if (assignee === 'Automation for Jira') return true;
  if (assignee === 'Unassigned') {
    const s = String(status || '').trim().toLowerCase();
    const terminal = team.has_fcr_escalation ? ['archived', 'rejected'] : ['cancelled', 'canceled'];
    return terminal.indexOf(s) !== -1;
  }
  return false;
}

/**
 * Builds resolved-by-resolved-date counts across every raw year for the team, returning
 * { resolved: {issueType -> isoDate -> count}, overdue: {issueType -> isoDate -> count} } where
 * "overdue" = tickets whose resolved_datetime > due_date (both parsed). resolved_datetime is
 * already normalized to ISO at sync time (parseResolvedDateField_ handles DE/DEV's text field),
 * so new Date() is safe here. Reads only issue_type, resolved_datetime, and due_date columns.
 */
function buildResolvedIndex_(teamKey) {
  const resolved = {};
  const overdue = {};
  const fcrYes = {};
  const escQualifying = {};
  listRawYears_(teamKey).forEach((year) => {
    const sheet = getOrCreateRawTab_(teamKey, year);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const typeCol = headers.indexOf('issue_type');
    const resolvedCol = headers.indexOf('resolved_datetime');
    const dueCol = headers.indexOf('due_date');
    const fcrCol = headers.indexOf('fcr_value');
    const escCol = headers.indexOf('escalation_value');
    if (resolvedCol === -1) return;

    const types = sheet.getRange(2, typeCol + 1, lastRow - 1, 1).getValues();
    const resolvedVals = sheet.getRange(2, resolvedCol + 1, lastRow - 1, 1).getValues();
    const dueVals = dueCol !== -1 ? sheet.getRange(2, dueCol + 1, lastRow - 1, 1).getValues() : null;
    const fcrVals = fcrCol !== -1 ? sheet.getRange(2, fcrCol + 1, lastRow - 1, 1).getValues() : null;
    const escVals = escCol !== -1 ? sheet.getRange(2, escCol + 1, lastRow - 1, 1).getValues() : null;
    for (let i = 0; i < resolvedVals.length; i++) {
      const raw = resolvedVals[i][0];
      if (!raw) continue;
      const rDate = new Date(raw);
      const rd = toIsoDate_(rDate);
      const type = types[i][0] || 'Unspecified';
      (resolved[type] = resolved[type] || {});
      resolved[type][rd] = (resolved[type][rd] || 0) + 1;
      const dueRaw = dueVals ? dueVals[i][0] : null;
      const dueIso = dueRaw ? toDisplayDate_(dueRaw) : '';
      // Overdue is a DATE comparison, not datetime. due_date is date-only, so `new Date(dueRaw)`
      // is midnight of that day; comparing it against the resolved timestamp flags every same-day
      // resolution as late. rd is already the resolved calendar date (Manila) — overdue only when
      // the ticket is resolved on a strictly LATER calendar day than its due date.
      if (dueIso && rd > dueIso) {
        (overdue[type] = overdue[type] || {});
        overdue[type][rd] = (overdue[type][rd] || 0) + 1;
      }
      // FCR=Yes and "real" escalations, bucketed by RESOLVED date — these back FCR Rate and
      // Escalation Rate, both taken over tickets resolved in the period (denominator =
      // tickets_resolved_on_date). fcr_value/escalation_value exist only on FCR/escalation teams;
      // when the columns are absent these indexes stay empty.
      if (fcrVals && fcrVals[i][0] === 'Yes') {
        (fcrYes[type] = fcrYes[type] || {});
        fcrYes[type][rd] = (fcrYes[type][rd] || 0) + 1;
      }
      if (escVals && isRealEscalation_(escVals[i][0])) {
        (escQualifying[type] = escQualifying[type] || {});
        escQualifying[type][rd] = (escQualifying[type][rd] || 0) + 1;
      }
    }
  });
  return { resolved: resolved, overdue: overdue, fcrYes: fcrYes, escQualifying: escQualifying };
}

/**
 * One-time backfill of tickets_resolved_on_date across existing METRICS_DAILY history (the
 * incremental aggregateTeam_ only fills it for dates touched since the feature shipped). Run
 * once, from the editor, AFTER migrateAddResolvedOnDate. Writes the whole column in a single
 * batched setValues per run (per-row updates would time out), then appends rows for any
 * (issue_type, date) that had resolutions but no created-based row yet.
 */
function backfillResolvedOnDate() {
  getActiveTeamsConfig_().forEach((team) => backfillResolvedOnDateForTeam_(team));
  Logger.log('backfillResolvedOnDate done.');
}

function backfillResolvedOnDateForTeam_(team) {
  const idx = buildResolvedIndex_(team.team_key);
  const resolvedIndex = idx.resolved;
  const overdueIndex = idx.overdue;
  const fcrYesIndex = idx.fcrYes;
  const escQualifyingIndex = idx.escQualifying;
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY');
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const resolvedColIdx = headers.indexOf('tickets_resolved_on_date');
  const overdueColIdx = headers.indexOf('overdue_resolved_on_date');
  const fcrYesColIdx = headers.indexOf('fcr_yes_resolved_on_date');
  const escColIdx = headers.indexOf('escalation_qualifying_resolved_on_date');
  if (resolvedColIdx === -1 || overdueColIdx === -1) throw new Error('Run migrateAddResolvedOnDate first — column missing.');
  if (fcrYesColIdx === -1 || escColIdx === -1) throw new Error('Run migrateAddFcrEscResolvedOnDate first — column missing.');
  const teamCol = headers.indexOf('team_key');
  const typeCol = headers.indexOf('issue_type');
  const dateCol = headers.indexOf('date');

  const seen = {};
  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    // Preserve other teams' existing values; overwrite this team's with the recomputed counts.
    const resolvedCol = [];
    const overdueCol = [];
    const fcrYesCol = [];
    const escCol = [];
    data.forEach((row) => {
      if (String(row[teamCol]) !== team.team_key) {
        resolvedCol.push([row[resolvedColIdx]]);
        overdueCol.push([row[overdueColIdx]]);
        fcrYesCol.push([row[fcrYesColIdx]]);
        escCol.push([row[escColIdx]]);
        return;
      }
      const type = row[typeCol];
      const date = formatDateCell_(row[dateCol]);
      seen[`${type}|${date}`] = true;
      resolvedCol.push([(resolvedIndex[type] && resolvedIndex[type][date]) || 0]);
      overdueCol.push([(overdueIndex[type] && overdueIndex[type][date]) || 0]);
      fcrYesCol.push([(fcrYesIndex[type] && fcrYesIndex[type][date]) || 0]);
      escCol.push([(escQualifyingIndex[type] && escQualifyingIndex[type][date]) || 0]);
    });
    sheet.getRange(2, resolvedColIdx + 1, resolvedCol.length, 1).setValues(resolvedCol);
    sheet.getRange(2, overdueColIdx + 1, overdueCol.length, 1).setValues(overdueCol);
    sheet.getRange(2, fcrYesColIdx + 1, fcrYesCol.length, 1).setValues(fcrYesCol);
    sheet.getRange(2, escColIdx + 1, escCol.length, 1).setValues(escCol);
  }

  // Dates that had resolutions but never had a created-based row (e.g. resolved on a day nothing
  // was created) — create them now so the trend isn't missing those resolutions.
  Object.keys(resolvedIndex).forEach((type) => {
    Object.keys(resolvedIndex[type]).forEach((date) => {
      if (seen[`${type}|${date}`]) return;
      const bucket = computeDailyBucket_(team, []);
      bucket.tickets_resolved_on_date = resolvedIndex[type][date];
      bucket.overdue_resolved_on_date = (overdueIndex[type] && overdueIndex[type][date]) || 0;
      bucket.fcr_yes_resolved_on_date = (fcrYesIndex[type] && fcrYesIndex[type][date]) || 0;
      bucket.escalation_qualifying_resolved_on_date = (escQualifyingIndex[type] && escQualifyingIndex[type][date]) || 0;
      upsertMetricsDailyRow_(team.team_key, type, date, bucket);
    });
  });
  Logger.log(`backfillResolvedOnDate: ${team.team_key} done.`);
}

/**
 * One-time backfill of peer_review_wait_sum_minutes/peer_review_wait_count across existing
 * METRICS_DAILY history (the incremental aggregateTeam_ only fills it for dates touched since the
 * feature shipped). Run once, from the editor, AFTER migrateAddPeerReviewWaitMetric.
 *
 * Chunked and self-continuing — an earlier version marked EVERY historical date dirty in one shot
 * and called aggregateTeam_ once, which reliably timed out: each (issue_type, date) bucket upsert
 * is its own couple of Sheets API round-trips (updateSheetRow_/appendObjectToSheet_ re-read the
 * header row every call), and two years of ST tickets add up to thousands of buckets — far more
 * than fits in the 6-minute execution limit, and aggregateTeam_ only checkpoints progress at YEAR
 * boundaries, so a mid-year timeout lost all of that year's work on every retry.
 *
 * This version processes one calendar month per execution instead (a few hundred buckets at most,
 * comfortably under the limit), then reschedules itself ~1s later via a one-off trigger until
 * every month with ST history has been redone. Progress lives in a Script Property (not
 * SYNC_CHECKPOINT/AGG_CHECKPOINT), so it never interferes with the regular sync/aggregation
 * triggers — though the per-month aggregateTeam_ call below does briefly overwrite AGG_CHECKPOINT's
 * dirty_dates_json for ST, so avoid running this at the same moment as a scheduled sync/aggregate
 * cycle for ST.
 */
const PEER_REVIEW_WAIT_BACKFILL_CURSOR_KEY = 'PEER_REVIEW_WAIT_BACKFILL_REMAINING_MONTHS';

function backfillPeerReviewWait() {
  const team = getTeamsConfig_().find((t) => t.team_key === 'ST');
  if (!team) { Logger.log('ST team not found in TEAMS_CONFIG.'); return; }

  const props = PropertiesService.getScriptProperties();
  let remaining = JSON.parse(props.getProperty(PEER_REVIEW_WAIT_BACKFILL_CURSOR_KEY) || 'null');

  if (!remaining) {
    const months = {};
    getAllRawYearsForTeam_('ST').forEach((year) => {
      const sheet = getJiraDataSpreadsheet_().getSheetByName(`RAW_ST_${year}`);
      if (!sheet) return;
      sheetToObjects_(sheet).forEach((r) => {
        if (r.created) months[toIsoDate_(new Date(r.created)).slice(0, 7)] = true;
      });
    });
    remaining = Object.keys(months).sort();
    Logger.log(`backfillPeerReviewWait: starting fresh — ${remaining.length} month(s) to process.`);
  }

  deletePeerReviewWaitBackfillTrigger_();

  if (!remaining.length) {
    props.deleteProperty(PEER_REVIEW_WAIT_BACKFILL_CURSOR_KEY);
    invalidateSheetCache_(getJiraDataSpreadsheet_().getSheetByName('METRICS_DAILY'));
    sendAlertEmail_(
      'Peer review wait backfill complete',
      'All ST months have been re-aggregated with peer_review_wait_sum_minutes/count.'
    );
    Logger.log('backfillPeerReviewWait: done.');
    return;
  }

  const month = remaining[0]; // 'yyyy-MM'
  writeAggCheckpoint_('ST', { dirty_dates_json: JSON.stringify(datesInMonth_(month)) });
  aggregateTeam_(team);

  remaining = remaining.slice(1);
  props.setProperty(PEER_REVIEW_WAIT_BACKFILL_CURSOR_KEY, JSON.stringify(remaining));
  Logger.log(`backfillPeerReviewWait: finished ${month}, ${remaining.length} month(s) left.`);
  ScriptApp.newTrigger('backfillPeerReviewWait').timeBased().after(1000).create();
}

function deletePeerReviewWaitBackfillTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'backfillPeerReviewWait')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Every 'yyyy-MM-dd' calendar date in the given 'yyyy-MM' month. */
function datesInMonth_(yyyyMM) {
  const [y, m] = yyyyMM.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${yyyyMM}-${String(d).padStart(2, '0')}`);
  }
  return dates;
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
  let peerReviewWaitSum = 0, peerReviewWaitCount = 0;

  rows.forEach((r) => {
    const created = r.created ? new Date(r.created) : null;
    const resolved = r.resolved_datetime ? new Date(r.resolved_datetime) : null;
    const due = r.due_date ? new Date(r.due_date) : null;

    if (resolved) {
      ticketsResolved++;
      if (created) { leadTimeSum += minutesBetween_(created, resolved); leadTimeCount++; }
    }

    // Cycle time: has_peer_review_tracking teams (ST/SE) use the new In-Progress-entry ->
    // most-recent-For-Peer-Review-entry span (cycle_time_start/end, from
    // extractReviewCycleTimeRange_ in JiraSync.gs), counted as soon as that span exists —
    // independent of resolution, since it measures the SE's active work time, not the
    // ticket's full lifecycle. Other teams keep the original backlog-exit -> resolution span.
    if (team.has_peer_review_tracking) {
      if (r.cycle_time_start && r.cycle_time_end) {
        cycleTimeSum += minutesBetween_(new Date(r.cycle_time_start), new Date(r.cycle_time_end));
        cycleTimeCount++;
      }
    } else if (resolved) {
      const cycleStart = r.first_out_of_backlog_todo ? new Date(r.first_out_of_backlog_todo) : null;
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
      // Date comparison, not datetime — due is date-only (midnight), so a datetime compare counts
      // same-day resolutions as late.
      if (resolved && toIsoDate_(resolved) > toDisplayDate_(r.due_date)) resolvedAfterDue++;
    }

    const assigneeField = team.assignee_field_id === 'customfield_10189' ? r.assigned_se : r.assigned_cod;
    if (assigneeField) assignedCount++;

    if (team.has_holding_reason && r.holding_reasons_json) {
      try {
        JSON.parse(r.holding_reasons_json).forEach((reason) => {
          if (reason) holdingReasonCounts[reason] = (holdingReasonCounts[reason] || 0) + 1;
        });
      } catch (e) {}
    }
    if (team.has_rejection_category && r.rejection_category) {
      rejectionCategoryCounts[r.rejection_category] = (rejectionCategoryCounts[r.rejection_category] || 0) + 1;
    }
    if (team.has_cancellation_reason && r.cancellation_reason) {
      cancellationReasonCounts[r.cancellation_reason] = (cancellationReasonCounts[r.cancellation_reason] || 0) + 1;
    }
    if (r.total_on_hold_minutes) {
      onHoldPickupSum += Number(r.total_on_hold_minutes);
      onHoldPickupCount++;
    }

    // Ticket Wait Time (SE): average time spent in "For Peer Review" per completed review cycle.
    // Same business rule as getPeerReviewWaitReport_ (PeerReviewApi.gs) — only cycles that exited
    // to On Hold or For Checking count as a real completed wait; other exits (e.g. cancelled) are
    // excluded so the two views of this data never disagree. Bucketed by the ticket's CREATED date
    // (like on-hold pickup above), not by when each cycle actually occurred — a ticket created in
    // an earlier period whose review cycle finishes now still counts against its creation date.
    if (team.has_peer_review_tracking && r.peer_review_cycles_json) {
      try {
        JSON.parse(r.peer_review_cycles_json).forEach((c) => {
          if (!c.enteredAt || !c.exitedAt) return;
          const exitedToStatus = (c.exitedToStatus || '').toLowerCase();
          if (exitedToStatus !== 'on hold' && exitedToStatus !== 'for checking') return;
          peerReviewWaitSum += minutesBetween_(new Date(c.enteredAt), new Date(c.exitedAt));
          peerReviewWaitCount++;
        });
      } catch (e) {}
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
    peer_review_wait_sum_minutes: peerReviewWaitSum,
    peer_review_wait_count: peerReviewWaitCount,
  };
}

/**
 * Full recompute of one team+month (not incremental) — simplest way to avoid double-counting
 * across dirty-date reruns. Created-based fields (tickets_assigned, tickets_resolved,
 * lead/cycle time, etc.) are bucketed by created month; tickets_resolved_in_month is bucketed
 * by RESOLVED month (from resolvedByAssigneeMonth) so the Performance page can show tickets a
 * person resolved DURING the period, not just those they were created-assigned that month.
 */
function recomputeAssigneeMonthly_(team, month, resolvedByAssigneeMonth) {
  const year = month.slice(0, 4);
  const sheet = getOrCreateRawTab_(team.team_key, year);
  const allRows = sheetToObjects_(sheet);
  const rowsForMonth = allRows.filter((r) => r.created && monthLabel_(new Date(r.created)) === month);

  const byAssignee = {};
  rowsForMonth.forEach((r) => {
    const assigneeField = team.assignee_field_id === 'customfield_10189' ? r.assigned_se : r.assigned_cod;
    const assignee = assigneeField || 'Unassigned';
    if (excludeFromAssigneePerf_(team, assignee, r.status)) return;
    (byAssignee[assignee] = byAssignee[assignee] || []).push(r);
  });

  const resolvedByAssignee = (resolvedByAssigneeMonth && resolvedByAssigneeMonth.resolved) || {};
  const overdueByAssignee = (resolvedByAssigneeMonth && resolvedByAssigneeMonth.overdue) || {};
  const fcrYesByAssignee = (resolvedByAssigneeMonth && resolvedByAssigneeMonth.fcrYes) || {};
  const escQualifyingByAssignee = (resolvedByAssigneeMonth && resolvedByAssigneeMonth.escQualifying) || {};

  // Union with assignees who RESOLVED tickets this month even if none were created-assigned to
  // them this month, so their resolved-in-period count still shows up.
  const assignees = {};
  Object.keys(byAssignee).forEach((a) => { assignees[a] = true; });
  Object.keys(resolvedByAssignee).forEach((a) => {
    if (resolvedByAssignee[a][month]) assignees[a] = true;
  });

  Object.keys(assignees).forEach((assignee) => {
    const bucket = computeAssigneeMonthlyBucket_(team, byAssignee[assignee] || []);
    bucket.tickets_resolved_in_month = (resolvedByAssignee[assignee] && resolvedByAssignee[assignee][month]) || 0;
    bucket.overdue_resolved_in_month = (overdueByAssignee[assignee] && overdueByAssignee[assignee][month]) || 0;
    bucket.fcr_yes_resolved_in_month = (fcrYesByAssignee[assignee] && fcrYesByAssignee[assignee][month]) || 0;
    bucket.escalation_qualifying_resolved_in_month = (escQualifyingByAssignee[assignee] && escQualifyingByAssignee[assignee][month]) || 0;
    upsertAssigneeMonthlyRow_(team.team_key, assignee, month, bucket);
  });
}

/**
 * Builds resolved-by-resolved-month counts per assignee across every raw year for the team,
 * returning { resolved: {assignee -> month -> count}, overdue: {assignee -> month -> count} }
 * where overdue = resolved_datetime > due_date. Uses the team's configured assignee column and
 * reads only the assignee, resolved_datetime, and due_date columns per year.
 */
function buildResolvedByAssigneeMonth_(team) {
  const assigneeHeader = team.assignee_field_id === 'customfield_10189' ? 'assigned_se' : 'assigned_cod';
  const resolved = {};
  const overdue = {};
  const fcrYes = {};
  const escQualifying = {};
  listRawYears_(team.team_key).forEach((year) => {
    const sheet = getOrCreateRawTab_(team.team_key, year);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const aCol = headers.indexOf(assigneeHeader);
    const rCol = headers.indexOf('resolved_datetime');
    const dueCol = headers.indexOf('due_date');
    const fcrCol = headers.indexOf('fcr_value');
    const escCol = headers.indexOf('escalation_value');
    const statusCol = headers.indexOf('status');
    if (rCol === -1 || aCol === -1) return;

    const assignees = sheet.getRange(2, aCol + 1, lastRow - 1, 1).getValues();
    const resolvedVals = sheet.getRange(2, rCol + 1, lastRow - 1, 1).getValues();
    const dueVals = dueCol !== -1 ? sheet.getRange(2, dueCol + 1, lastRow - 1, 1).getValues() : null;
    const fcrVals = fcrCol !== -1 ? sheet.getRange(2, fcrCol + 1, lastRow - 1, 1).getValues() : null;
    const escVals = escCol !== -1 ? sheet.getRange(2, escCol + 1, lastRow - 1, 1).getValues() : null;
    const statusVals = statusCol !== -1 ? sheet.getRange(2, statusCol + 1, lastRow - 1, 1).getValues() : null;
    for (let i = 0; i < resolvedVals.length; i++) {
      const raw = resolvedVals[i][0];
      if (!raw) continue;
      const rDate = new Date(raw);
      const rd = toIsoDate_(rDate);
      const month = monthLabel_(rDate);
      const assignee = assignees[i][0] || 'Unassigned';
      // Same Performance-only exclusion as recomputeAssigneeMonthly_ so the resolved-in-period
      // counts and the created-based counts drop the same rows.
      if (excludeFromAssigneePerf_(team, assignee, statusVals ? statusVals[i][0] : '')) continue;
      (resolved[assignee] = resolved[assignee] || {});
      resolved[assignee][month] = (resolved[assignee][month] || 0) + 1;
      const dueRaw = dueVals ? dueVals[i][0] : null;
      const dueIso = dueRaw ? toDisplayDate_(dueRaw) : '';
      // Date comparison, not datetime (see buildResolvedIndex_): overdue only when the ticket is
      // resolved on a strictly later calendar day than its due date.
      if (dueIso && rd > dueIso) {
        (overdue[assignee] = overdue[assignee] || {});
        overdue[assignee][month] = (overdue[assignee][month] || 0) + 1;
      }
      // FCR=Yes and "real" escalations by resolved month — back the per-assignee FCR/Escalation
      // rates on the Performance page (denominator = tickets_resolved_in_month). See buildResolvedIndex_.
      if (fcrVals && fcrVals[i][0] === 'Yes') {
        (fcrYes[assignee] = fcrYes[assignee] || {});
        fcrYes[assignee][month] = (fcrYes[assignee][month] || 0) + 1;
      }
      if (escVals && isRealEscalation_(escVals[i][0])) {
        (escQualifying[assignee] = escQualifying[assignee] || {});
        escQualifying[assignee][month] = (escQualifying[assignee][month] || 0) + 1;
      }
    }
  });
  return { resolved: resolved, overdue: overdue, fcrYes: fcrYes, escQualifying: escQualifying };
}

/**
 * One-time backfill of tickets_resolved_in_month across existing METRICS_BY_ASSIGNEE_MONTHLY
 * (the assignee counterpart of backfillResolvedOnDate). Run once after migrateAddResolvedInMonth.
 * Batched single-column write, then appends rows for (assignee, month) that resolved but had no
 * created-based row. Idempotent — safe to re-run.
 */
function backfillResolvedInMonth() {
  getActiveTeamsConfig_().forEach((team) => backfillResolvedInMonthForTeam_(team));
  Logger.log('backfillResolvedInMonth done.');
}

function backfillResolvedInMonthForTeam_(team) {
  const idx = buildResolvedByAssigneeMonth_(team);
  const resolvedIndex = idx.resolved;
  const overdueIndex = idx.overdue;
  const fcrYesIndex = idx.fcrYes;
  const escQualifyingIndex = idx.escQualifying;
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const resolvedColIdx = headers.indexOf('tickets_resolved_in_month');
  const overdueColIdx = headers.indexOf('overdue_resolved_in_month');
  const fcrYesColIdx = headers.indexOf('fcr_yes_resolved_in_month');
  const escColIdx = headers.indexOf('escalation_qualifying_resolved_in_month');
  if (resolvedColIdx === -1 || overdueColIdx === -1) throw new Error('Run migrateAddResolvedInMonth first — column missing.');
  if (fcrYesColIdx === -1 || escColIdx === -1) throw new Error('Run migrateAddFcrEscResolvedInMonth first — column missing.');
  const teamCol = headers.indexOf('team_key');
  const assigneeCol = headers.indexOf('assignee_display_name');
  const monthCol = headers.indexOf('month');

  const seen = {};
  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const resolvedCol = [];
    const overdueCol = [];
    const fcrYesCol = [];
    const escCol = [];
    data.forEach((row) => {
      if (String(row[teamCol]) !== team.team_key) {
        resolvedCol.push([row[resolvedColIdx]]);
        overdueCol.push([row[overdueColIdx]]);
        fcrYesCol.push([row[fcrYesColIdx]]);
        escCol.push([row[escColIdx]]);
        return;
      }
      const assignee = row[assigneeCol];
      const month = formatMonthCell_(row[monthCol]);
      seen[`${assignee}|${month}`] = true;
      resolvedCol.push([(resolvedIndex[assignee] && resolvedIndex[assignee][month]) || 0]);
      overdueCol.push([(overdueIndex[assignee] && overdueIndex[assignee][month]) || 0]);
      fcrYesCol.push([(fcrYesIndex[assignee] && fcrYesIndex[assignee][month]) || 0]);
      escCol.push([(escQualifyingIndex[assignee] && escQualifyingIndex[assignee][month]) || 0]);
    });
    sheet.getRange(2, resolvedColIdx + 1, resolvedCol.length, 1).setValues(resolvedCol);
    sheet.getRange(2, overdueColIdx + 1, overdueCol.length, 1).setValues(overdueCol);
    sheet.getRange(2, fcrYesColIdx + 1, fcrYesCol.length, 1).setValues(fcrYesCol);
    sheet.getRange(2, escColIdx + 1, escCol.length, 1).setValues(escCol);
  }

  Object.keys(resolvedIndex).forEach((assignee) => {
    Object.keys(resolvedIndex[assignee]).forEach((month) => {
      if (seen[`${assignee}|${month}`]) return;
      const bucket = computeAssigneeMonthlyBucket_(team, []);
      bucket.tickets_resolved_in_month = resolvedIndex[assignee][month];
      bucket.overdue_resolved_in_month = (overdueIndex[assignee] && overdueIndex[assignee][month]) || 0;
      bucket.fcr_yes_resolved_in_month = (fcrYesIndex[assignee] && fcrYesIndex[assignee][month]) || 0;
      bucket.escalation_qualifying_resolved_in_month = (escQualifyingIndex[assignee] && escQualifyingIndex[assignee][month]) || 0;
      upsertAssigneeMonthlyRow_(team.team_key, assignee, month, bucket);
    });
  });
  Logger.log(`backfillResolvedInMonth: ${team.team_key} done.`);
}

/**
 * One-time cleanup for the duplicate rows METRICS_BY_ASSIGNEE_MONTHLY accumulated while
 * getAssigneeMonthlyIndex_ keyed on the raw (Date-parsed) month cell — every aggregation/backfill
 * run appended instead of updating, inflating per-assignee counts ~Nx. Simple dedup won't do
 * because recompute-appended and backfill-appended duplicates populate different columns, so this
 * clears the tab once and recomputes every (team, assignee, month) from raw — each
 * recomputeAssigneeMonthly_ writes a complete row (created-based + resolved-in-month + FCR/esc).
 *
 * Chunked and self-continuing — the original version cleared the WHOLE sheet then looped every
 * team's every month in one execution, which reliably exceeded the 6-minute limit for ST's ticket
 * volume alone (same failure mode backfillPeerReviewWait had, see its comment). Worse, because it
 * cleared unconditionally on every call, the original "just re-run it if it times out" advice
 * actively made things worse — each re-run wiped whatever partial progress existed and restarted
 * from team #1, so it could never converge past wherever the first team happened to land. This
 * version clears ONCE on a fresh start, then processes one (team, month) pair per execution,
 * tracking remaining work in a Script Property and rescheduling itself ~1s later via a one-off
 * trigger until every team+month is done.
 */
const REBUILD_ASSIGNEE_MONTHLY_CURSOR_KEY = 'REBUILD_ASSIGNEE_MONTHLY_REMAINING';

function rebuildAssigneeMonthly() {
  const props = PropertiesService.getScriptProperties();
  let remaining = JSON.parse(props.getProperty(REBUILD_ASSIGNEE_MONTHLY_CURSOR_KEY) || 'null');

  if (!remaining) {
    const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    _assigneeMonthlyIndexCache_ = null;

    remaining = [];
    getActiveTeamsConfig_().forEach((team) => {
      const resolvedByAssigneeMonth = buildResolvedByAssigneeMonth_(team);
      const months = {};
      // Every month a ticket was CREATED in (drives the created-based columns)...
      listRawYears_(team.team_key).forEach((year) => {
        const raw = getOrCreateRawTab_(team.team_key, year);
        sheetToObjects_(raw).forEach((r) => {
          if (r.created) months[monthLabel_(new Date(r.created))] = true;
        });
      });
      // ...plus every month a ticket RESOLVED in, so resolution-only months still get rows.
      Object.keys(resolvedByAssigneeMonth.resolved).forEach((a) => {
        Object.keys(resolvedByAssigneeMonth.resolved[a]).forEach((m) => { months[m] = true; });
      });
      Object.keys(months).sort().forEach((month) => remaining.push({ teamKey: team.team_key, month: month }));
    });
    Logger.log(`rebuildAssigneeMonthly: starting fresh — ${remaining.length} team-month(s) to process.`);
  }

  deleteRebuildAssigneeMonthlyTrigger_();

  if (!remaining.length) {
    props.deleteProperty(REBUILD_ASSIGNEE_MONTHLY_CURSOR_KEY);
    invalidateSheetCache_(getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY'));
    sendAlertEmail_(
      'Assignee-monthly rebuild complete',
      'METRICS_BY_ASSIGNEE_MONTHLY has been fully recomputed for every active team.'
    );
    Logger.log('rebuildAssigneeMonthly: done.');
    return;
  }

  const next = remaining[0];
  const team = getActiveTeamsConfig_().find((t) => t.team_key === next.teamKey);
  if (team) {
    const resolvedByAssigneeMonth = buildResolvedByAssigneeMonth_(team);
    recomputeAssigneeMonthly_(team, next.month, resolvedByAssigneeMonth);
  }

  remaining = remaining.slice(1);
  props.setProperty(REBUILD_ASSIGNEE_MONTHLY_CURSOR_KEY, JSON.stringify(remaining));
  Logger.log(`rebuildAssigneeMonthly: finished ${next.teamKey} ${next.month}, ${remaining.length} left.`);
  ScriptApp.newTrigger('rebuildAssigneeMonthly').timeBased().after(1000).create();
}

function deleteRebuildAssigneeMonthlyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'rebuildAssigneeMonthly')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

function computeAssigneeMonthlyBucket_(team, rows) {
  let resolved = 0;
  let leadTimeSum = 0, leadTimeCount = 0;
  let cycleTimeSum = 0, cycleTimeCount = 0;
  let fcrEligible = 0, fcrNotEscalated = 0, escalated = 0;
  let resolvedAfterDue = 0;
  let inProgressSum = 0, inProgressCount = 0;

  rows.forEach((r) => {
    const created = r.created ? new Date(r.created) : null;
    const resolvedAt = r.resolved_datetime ? new Date(r.resolved_datetime) : null;
    const due = r.due_date ? new Date(r.due_date) : null;

    if (resolvedAt) {
      resolved++;
      if (created) { leadTimeSum += minutesBetween_(created, resolvedAt); leadTimeCount++; }
      // Date comparison, not datetime (see aggregateTeam_) — same-day resolutions are on time.
      if (due && toIsoDate_(resolvedAt) > toDisplayDate_(r.due_date)) resolvedAfterDue++;
    }

    // Cycle time: see computeDailyBucket_ for the full rationale — has_peer_review_tracking
    // teams (ST/SE) use cycle_time_start/end (In-Progress-entry -> most recent For-Peer-Review
    // entry), counted independent of resolution; other teams keep the original
    // backlog-exit -> resolution span, still gated on resolution.
    if (team.has_peer_review_tracking) {
      if (r.cycle_time_start && r.cycle_time_end) {
        cycleTimeSum += minutesBetween_(new Date(r.cycle_time_start), new Date(r.cycle_time_end));
        cycleTimeCount++;
      }
    } else if (resolvedAt) {
      const cycleStart = r.first_out_of_backlog_todo ? new Date(r.first_out_of_backlog_todo) : null;
      if (cycleStart) { cycleTimeSum += minutesBetween_(cycleStart, resolvedAt); cycleTimeCount++; }
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

    if (team.has_in_progress_tracking && r.total_in_progress_minutes) {
      inProgressSum += Number(r.total_in_progress_minutes);
      inProgressCount++;
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
    avg_in_progress_minutes: inProgressCount ? round2_(inProgressSum / inProgressCount) : '',
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

  // Phase 3 of the Sheets -> Supabase migration — see dualWriteTicketToSupabase_ in
  // JiraSync.gs for the same rationale (never let a Supabase hiccup break aggregation).
  dualWriteMetricsDailyToSupabase_(record);
}

var _assigneeMonthlyIndexCache_ = null;

function getAssigneeMonthlyIndex_() {
  if (_assigneeMonthlyIndexCache_) return _assigneeMonthlyIndexCache_;
  const sheet = getJiraDataSpreadsheet_().getSheetByName('METRICS_BY_ASSIGNEE_MONTHLY');
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow > 1) {
    // Normalize the month cell: Sheets auto-parses the 'yyyy-MM' string into a Date on write, so
    // row[2] reads back as a Date. Without formatMonthCell_ here the key never matches the
    // 'yyyy-MM' string upsertAssigneeMonthlyRow_ builds, and every run appends a duplicate row
    // instead of updating (mirrors getMetricsDailyIndex_'s formatDateCell_ on the date cell).
    sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach((row, i) => {
      map[`${row[0]}|${row[1]}|${formatMonthCell_(row[2])}`] = i + 2;
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

  // Phase 3 of the Sheets -> Supabase migration — see dualWriteTicketToSupabase_ in
  // JiraSync.gs for the same rationale (never let a Supabase hiccup break aggregation).
  dualWriteAssigneeMonthlyToSupabase_(record);
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
