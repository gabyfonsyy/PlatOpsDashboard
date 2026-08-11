/**
 * Shared Supabase REST plumbing + row mappers, used by BOTH the one-time historical migration
 * (SupabaseMigration.gs, Phase 2) and the ongoing dual-write hooks in JiraSync.gs/Aggregation.gs
 * (Phase 3) — kept in one place so the two never drift apart on how a ticket/metrics row gets
 * shaped for Supabase. See supabase/schema.sql and the migration sketch for the full plan.
 */

// ============================================================================
// Supabase REST helpers (PostgREST over UrlFetchApp — Apps Script cannot open a raw
// Postgres/TCP connection, so this is the only way in; see the migration sketch)
// ============================================================================

function supabaseRequest_(method, path, payload, extraHeaders) {
  const url = `${getScriptProperty_('SUPABASE_URL')}/rest/v1/${path}`;
  const key = getScriptProperty_('SUPABASE_SERVICE_ROLE_KEY');
  const headers = Object.assign(
    { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    extraHeaders || {}
  );
  const options = { method, headers, muteHttpExceptions: true };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      const text = res.getContentText();
      return { body: text ? JSON.parse(text) : null, headers: res.getHeaders() };
    }
    lastError = `Supabase ${method} ${path} failed (HTTP ${code}): ${res.getContentText()}`;
    // Sporadic 404s/5xx from either side of this call are a known gotcha (see the migration
    // sketch's "Apps Script Web Apps" callout) — retry with backoff instead of failing on the first hit.
    if (code === 404 || code >= 500) {
      Utilities.sleep(1000 * attempt);
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error(lastError);
}

/** Upserts rows in batches of 500 (keeps each request small/fast) via PostgREST's on_conflict. */
function supabaseUpsert_(table, rows, onConflict) {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    supabaseRequest_('POST', `${table}?on_conflict=${onConflict}`, rows.slice(i, i + CHUNK), {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
}

function supabaseInsert_(table, rows) {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    supabaseRequest_('POST', table, rows.slice(i, i + CHUNK), { Prefer: 'return=minimal' });
  }
}

function supabaseCount_(table) {
  const res = supabaseRequest_('GET', `${table}?select=*&limit=1`, undefined, { Prefer: 'count=exact' });
  const range = res.headers['Content-Range'] || res.headers['content-range'];
  if (!range) throw new Error(`Supabase count failed for ${table}: no Content-Range header returned`);
  return Number(range.split('/')[1]);
}

// ============================================================================
// Value coercion — Sheets cells surface as native JS Date objects OR plain strings depending
// on how the cell happens to be formatted, and blanks must become SQL NULL, not '' or 0, for
// nullable columns to behave correctly (e.g. an empty date string is not a valid `date`).
// ============================================================================

function toTimestampOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDateOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  return toDisplayDate_(value);
}

function toJsonOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function toNumberOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function toNumberOrZero_(value) {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function toStringOrNull_(value) {
  return value === '' || value === null || value === undefined ? null : String(value);
}

/**
 * Collapses rows sharing the same natural key down to one, keeping the highest `freshnessOf`
 * value (ties/missing favor whichever occurs LAST in `rows`, i.e. sheet order). Needed because
 * PostgREST's upsert fails outright — not silently — if a single INSERT contains two rows for
 * the same on_conflict target ("ON CONFLICT DO UPDATE command cannot affect row a second time").
 * The RAW/METRICS/INITIATIVE_TICKETS sheets are meant to hold at most one row per natural key
 * (each is written through a find-or-update index in JiraSync.gs/Aggregation.gs/InitiativesSync.gs),
 * but that index is rebuilt fresh per execution — two overlapping trigger runs (e.g. a rebackfill
 * still finishing when the regular 2h sync fires) can each decide independently to append a new
 * row for the same key, leaving a genuine duplicate sitting in the sheet. `freshnessOf` can be
 * omitted when there's no reliable timestamp to compare — sheet order alone is still a reasonable
 * tiebreaker since appendRow always adds at the bottom. Only needed for batch (migration) upserts;
 * the dual-write hooks below send one row at a time, so this never applies to them.
 */
function dedupeByKey_(rows, keyOf, freshnessOf) {
  const byKey = {};
  const order = [];
  rows.forEach((row) => {
    const key = keyOf(row);
    const freshness = freshnessOf ? freshnessOf(row) : '';
    if (!(key in byKey)) order.push(key);
    if (!(key in byKey) || freshness >= byKey[key].freshness) {
      byKey[key] = { row, freshness };
    }
  });
  return order.map((key) => byKey[key].row);
}

// ============================================================================
// Row mappers — Sheets row shape -> Supabase row shape. Shared between the one-time migration
// and the ongoing dual-write hooks so they can never disagree on how a field gets transformed.
// ============================================================================

/** `r` matches RAW_TICKET_HEADERS (JiraSync.gs) — either a pre-write row (always plain strings)
 *  or a row read back via sheetToObjects_ (some fields may surface as Date objects). */
function mapRawTicketRowToSupabase_(teamKey, r) {
  return {
    issue_key: r.issue_key,
    team_key: teamKey,
    project_key: r.project_key,
    issue_type: r.issue_type,
    status: r.status,
    created: toTimestampOrNull_(r.created),
    updated: toTimestampOrNull_(r.updated),
    resolved_datetime: toTimestampOrNull_(r.resolved_datetime),
    resolved_raw_text: toStringOrNull_(r.resolved_raw_text),
    first_out_of_backlog_todo: toTimestampOrNull_(r.first_out_of_backlog_todo),
    fcr_value: toStringOrNull_(r.fcr_value),
    escalation_value: toStringOrNull_(r.escalation_value),
    assigned_se: toStringOrNull_(r.assigned_se),
    assigned_cod: toStringOrNull_(r.assigned_cod),
    due_date: toDateOrNull_(r.due_date),
    product: toStringOrNull_(r.product),
    holding_reasons_json: toJsonOrNull_(r.holding_reasons_json),
    rejection_category: toStringOrNull_(r.rejection_category),
    cancellation_reason: toStringOrNull_(r.cancellation_reason),
    total_on_hold_minutes: toNumberOrNull_(r.total_on_hold_minutes),
    total_in_progress_minutes: toNumberOrNull_(r.total_in_progress_minutes),
    assignee_display_name: toStringOrNull_(r.assignee_display_name),
    reporter_display_name: toStringOrNull_(r.reporter_display_name),
    last_synced_at: toTimestampOrNull_(r.last_synced_at) || nowIso_(),
    peer_review_cycles_json: toJsonOrNull_(r.peer_review_cycles_json),
    cycle_time_start: toTimestampOrNull_(r.cycle_time_start),
    cycle_time_end: toTimestampOrNull_(r.cycle_time_end),
    labels: toStringOrNull_(r.labels),
  };
}

/** `r` matches METRICS_DAILY's columns (team_key/issue_type/date + the bucket fields). */
function mapMetricsDailyRowToSupabase_(r) {
  return {
    team_key: r.team_key,
    issue_type: r.issue_type,
    date: toDateOrNull_(r.date),
    tickets_created_count: toNumberOrZero_(r.tickets_created_count),
    tickets_resolved_count: toNumberOrZero_(r.tickets_resolved_count),
    tickets_resolved_on_date: toNumberOrZero_(r.tickets_resolved_on_date),
    overdue_resolved_on_date: toNumberOrZero_(r.overdue_resolved_on_date),
    fcr_yes_resolved_on_date: toNumberOrZero_(r.fcr_yes_resolved_on_date),
    escalation_qualifying_resolved_on_date: toNumberOrZero_(r.escalation_qualifying_resolved_on_date),
    lead_time_sum_minutes: toNumberOrZero_(r.lead_time_sum_minutes),
    lead_time_count: toNumberOrZero_(r.lead_time_count),
    cycle_time_sum_minutes: toNumberOrZero_(r.cycle_time_sum_minutes),
    cycle_time_count: toNumberOrZero_(r.cycle_time_count),
    fcr_eligible_count: toNumberOrZero_(r.fcr_eligible_count),
    fcr_not_escalated_count: toNumberOrZero_(r.fcr_not_escalated_count),
    escalated_count: toNumberOrZero_(r.escalated_count),
    resolved_after_due_count: toNumberOrZero_(r.resolved_after_due_count),
    total_for_aging_denominator: toNumberOrZero_(r.total_for_aging_denominator),
    assigned_count: toNumberOrZero_(r.assigned_count),
    holding_reason_json: toJsonOrNull_(r.holding_reason_json),
    rejection_category_json: toJsonOrNull_(r.rejection_category_json),
    cancellation_reason_json: toJsonOrNull_(r.cancellation_reason_json),
    on_hold_pickup_sum_minutes: toNumberOrZero_(r.on_hold_pickup_sum_minutes),
    on_hold_pickup_count: toNumberOrZero_(r.on_hold_pickup_count),
    peer_review_wait_sum_minutes: toNumberOrZero_(r.peer_review_wait_sum_minutes),
    peer_review_wait_count: toNumberOrZero_(r.peer_review_wait_count),
  };
}

/**
 * `r` matches METRICS_BY_ASSIGNEE_MONTHLY's columns. `month` gets the SAME formatMonthCell_
 * (MetricsApi.gs) treatment the sheet's own index lookup already needs — Sheets auto-coerces a
 * bare 'yyyy-MM' string into a Date-typed cell, so a row read back via sheetToObjects_ can hand
 * this a Date instead of "2026-07". Passing that straight through (as the original migration
 * script did) silently produces a full UTC ISO timestamp in Supabase instead of "2026-07" —
 * the exact same bug INSIGHTS_CACHE.period_label had. formatMonthCell_ converts it back
 * correctly since the Date is always midnight Manila time on the 1st of the real month.
 */
function mapAssigneeMonthlyRowToSupabase_(r) {
  return {
    team_key: r.team_key,
    assignee_display_name: r.assignee_display_name,
    month: formatMonthCell_(r.month),
    tickets_assigned: toNumberOrZero_(r.tickets_assigned),
    tickets_resolved: toNumberOrZero_(r.tickets_resolved),
    tickets_resolved_in_month: toNumberOrZero_(r.tickets_resolved_in_month),
    overdue_resolved_in_month: toNumberOrZero_(r.overdue_resolved_in_month),
    fcr_yes_resolved_in_month: toNumberOrZero_(r.fcr_yes_resolved_in_month),
    escalation_qualifying_resolved_in_month: toNumberOrZero_(r.escalation_qualifying_resolved_in_month),
    escalated_count: toNumberOrZero_(r.escalated_count),
    fcr_eligible_count: toNumberOrZero_(r.fcr_eligible_count),
    fcr_not_escalated_count: toNumberOrZero_(r.fcr_not_escalated_count),
    resolved_after_due_count: toNumberOrZero_(r.resolved_after_due_count),
    avg_lead_time_minutes: toNumberOrNull_(r.avg_lead_time_minutes),
    avg_cycle_time_minutes: toNumberOrNull_(r.avg_cycle_time_minutes),
    avg_in_progress_minutes: toNumberOrNull_(r.avg_in_progress_minutes),
  };
}

// ============================================================================
// Phase 3 dual-write hooks — called from JiraSync.gs/Aggregation.gs right after the matching
// Sheets write. Every one of these swallows its own errors: Sheets stays the source of truth
// during this phase, so a Supabase hiccup (rate limit, brief outage) must never break sync/
// aggregation. Failures are logged the same way a sync-side field error already is
// (logSyncError_ -> ERROR_LOG), so they're visible without being fatal.
// ============================================================================

function dualWriteTicketToSupabase_(teamKey, row) {
  try {
    supabaseUpsert_('tickets', [mapRawTicketRowToSupabase_(teamKey, row)], 'issue_key');
  } catch (err) {
    Logger.log(`dualWriteTicketToSupabase_ failed for ${row.issue_key}: ${err}`);
    logSyncError_(teamKey, row.issue_key, 'supabase_dual_write', '', String(err));
  }
}

function dualWriteMetricsDailyToSupabase_(record) {
  try {
    supabaseUpsert_('metrics_daily', [mapMetricsDailyRowToSupabase_(record)], 'team_key,issue_type,date');
  } catch (err) {
    Logger.log(`dualWriteMetricsDailyToSupabase_ failed for ${record.team_key}/${record.issue_type}/${record.date}: ${err}`);
    logSyncError_(record.team_key, '', 'supabase_dual_write_metrics_daily', '', String(err));
  }
}

function dualWriteAssigneeMonthlyToSupabase_(record) {
  try {
    supabaseUpsert_(
      'metrics_by_assignee_monthly',
      [mapAssigneeMonthlyRowToSupabase_(record)],
      'team_key,assignee_display_name,month'
    );
  } catch (err) {
    Logger.log(`dualWriteAssigneeMonthlyToSupabase_ failed for ${record.team_key}/${record.assignee_display_name}/${record.month}: ${err}`);
    logSyncError_(record.team_key, '', 'supabase_dual_write_assignee_monthly', '', String(err));
  }
}
