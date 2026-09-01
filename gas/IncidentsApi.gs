/**
 * Incident Logs — two layers, deliberately kept apart:
 *
 *   INCIDENT_TICKETS  synced FROM Jira. A ticket enters the incident list when the manager sets
 *                     the "Report Tagging" custom field (customfield_10262) on it in Jira, and
 *                     LEAVES the list when that field is cleared again — untagging is how an
 *                     incident is retracted after a second look (see
 *                     sweepUntaggedIncidentTickets_). Its value is used purely as a flag —
 *                     presence means "valid incident log" — so it isn't stored or surfaced.
 *                     The sync only ever READS it. The one code path in this project that writes
 *                     to Jira at all is removeTicket, which clears this single field when the
 *                     retraction is started from the dashboard instead of from Jira.
 *
 *   INCIDENT_LOGS     entered on the dashboard. Severity (S1-S4, each carrying a fixed evaluation
 *                     score impact), the manager's feedback, the AI-rephrased version of that
 *                     feedback, AI-inferred improvement notes and concern categories.
 *
 * The split matters because the two have different lifecycles: a re-sync upserts ticket rows from
 * Jira on every run, and must never touch the feedback a manager typed. Keeping feedback in its
 * own tab makes that structural rather than something the upsert has to remember to avoid.
 *
 * One ticket can carry MORE THAN ONE log. On SE (has_peer_review_tracking) an incident can be the
 * doer's, the validator's, or both — those are separate records with their own severity and
 * feedback, because they feed different people's evaluations. Teams without a peer-review step
 * (DBA, DevOps) only ever log the doer.
 */

/** The manager-set Jira field whose presence marks a ticket as a valid incident log. */
const INCIDENT_REPORT_TAGGING_FIELD = 'customfield_10262';

const INCIDENT_TICKET_HEADERS = [
  'issue_key', 'team_key', 'project_key', 'summary', 'issue_type', 'status',
  'doer', 'validator', 'validator_source', 'validator_override',
  'created', 'updated', 'resolved_datetime', 'incident_date', 'last_synced_at',
  // When the sweep found Report Tagging cleared in Jira on a ticket it could not delete because it
  // already carries logs. Blank on every normal row; re-cleared if the ticket is tagged again.
  'untagged_at',
];

/**
 * Stamped into validator_source on every row this version of the attribution writes.
 *
 * It exists to make a forced re-derive CONVERGE. `force` deliberately ignores the
 * updated-unchanged skip, so without a marker every run re-derives every ticket, always runs out
 * of time budget on the same first N, and never reaches the rest — progress isn't remembered, so
 * repeated runs make none. Rows already carrying this marker are skipped even under force, so each
 * run strictly advances and the operation terminates.
 *
 * Bump this string whenever the validator derivation changes meaning again; that alone is enough
 * to make the next forced sync revisit every row exactly once.
 */
// v2 adds the designated-validator allowlist on top of the entry-assignee rule, so every row
// derived under v1 needs revisiting - which bumping this string is exactly what triggers.
const INCIDENT_VALIDATOR_ATTRIBUTION = 'peer-review-entry-assignee+allowlist';

const INCIDENT_LOG_HEADERS = [
  'incident_id', 'issue_key', 'team_key', 'role', 'employee_name',
  'severity', 'score_impact', 'incident_date',
  'feedback_raw', 'feedback_polished', 'improvements', 'categories_json',
  'ai_model', 'ai_generated_at', 'notes', 'created_by', 'created_at', 'updated_at',
];

/**
 * The severity rubric. score_impact is the deduction applied to the person's evaluation, and is
 * ALWAYS recomputed here from the severity code on write — never trusted from the request body —
 * so a stale frontend or a hand-edited sheet row can't silently change what an incident costs.
 * src/lib/incidents.ts mirrors the labels/descriptions for display; this table is the authority.
 */
const INCIDENT_SEVERITIES = {
  S1: { label: 'Critical', description: 'Full production outage; all clients affected', scoreImpact: -3 },
  S2: { label: 'Major', description: 'Partial outage or multiple clients impacted', scoreImpact: -2 },
  S3: { label: 'Minor', description: 'Single client affected; significant rework or back-and-forths needed', scoreImpact: -1.5 },
  S4: { label: 'Low', description: 'Wrong info shared but easily corrected; minimal client impact', scoreImpact: -1 },
};

const INCIDENT_ROLES = ['Doer', 'Validator'];

/**
 * The people who actually perform peer review. Anyone else appearing as the assignee on a
 * "For Peer Review" transition is NOT recorded as the validator - the field is left blank instead.
 *
 * Why an allowlist rather than trusting the changelog outright: the assignee at that moment is
 * usually the reviewer, but not always. A ticket can be moved into review while still assigned to
 * the doer, or passed through by someone covering a queue, and those cases would otherwise credit
 * a review to somebody who never did one - which then feeds their evaluation. Constraining the
 * output to the designated reviewers turns a plausible guess into a verifiable one, and a blank is
 * a far better answer than a confidently wrong name.
 *
 * Override with an INCIDENT_VALIDATORS script property (comma-separated) to add or remove
 * reviewers without a redeploy. After changing either this default or that property, run a forced
 * sync so stored rows are re-derived - and bump INCIDENT_VALIDATOR_ATTRIBUTION if the change should
 * revisit rows that already carry the current marker.
 */
const INCIDENT_VALIDATOR_NAMES_DEFAULT = ['Angelo Fajardo', 'Jasper Razo', 'Mark Jayson Manosca'];

function incidentValidatorNames_() {
  const override = PropertiesService.getScriptProperties().getProperty('INCIDENT_VALIDATORS');
  if (override && String(override).trim()) {
    return String(override).split(',').map((s) => s.trim()).filter(String);
  }
  return INCIDENT_VALIDATOR_NAMES_DEFAULT;
}

/** Case-insensitive membership, returning the canonically-cased name so display stays consistent. */
function canonicalIncidentValidator_(name) {
  const candidate = String(name || '').trim().toLowerCase();
  if (!candidate) return '';
  const names = incidentValidatorNames_();
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === candidate) return names[i];
  }
  return '';
}

/**
 * Issue-type groups the incident view segregates by. Matched case-insensitively on the ticket's
 * Jira issue type; anything unlisted lands in 'Others' rather than being dropped or forced into a
 * group it doesn't belong to — a new Jira issue type should show up as uncategorised and obvious,
 * not silently inflate one of the two real groups.
 *
 * NOTE: this is NOT the same split as CYCLE_TIME_INVESTIGATION_ISSUE_TYPES in JiraSync.gs, which
 * also counts 'External Support Request' and 'Team Viewer' as investigations. That list decides
 * which status ends cycle time; this one is the reporting grouping the manager asked for. They are
 * deliberately independent — do not "unify" them without confirming both meanings should move.
 */
const INCIDENT_ISSUE_GROUPS = [
  {
    group: 'Backend Changes',
    issueTypes: ['backend changes', 'account creation', 'task', 'company policy', 'data deletion', 'technical story'],
  },
  {
    group: 'Investigation',
    issueTypes: ['data generation', 'investigation'],
  },
];

const INCIDENT_ISSUE_GROUP_OTHER = 'Others';

/**
 * Teams whose incidents are segregated by issue type at all. ST only: DBA and DevOps file
 * essentially everything as Task (a few Technical Task), so a grouping column there would be one
 * populated bucket and two empty ones - noise dressed up as analysis. Their tickets get a blank
 * issue_group and are left out of the per-group rollup entirely, rather than being swept into
 * 'Others', where they would read as uncategorised rather than not-applicable.
 */
const INCIDENT_ISSUE_GROUP_TEAM_KEYS = ['ST'];

function incidentTeamSegregatesIssueTypes_(teamKey) {
  return INCIDENT_ISSUE_GROUP_TEAM_KEYS.indexOf(String(teamKey)) !== -1;
}

/** All group names in display order, with Others last. */
const INCIDENT_ISSUE_GROUP_NAMES = INCIDENT_ISSUE_GROUPS.map(function (g) { return g.group; })
  .concat([INCIDENT_ISSUE_GROUP_OTHER]);

function incidentIssueGroup_(issueType) {
  const type = String(issueType || '').trim().toLowerCase();
  for (let i = 0; i < INCIDENT_ISSUE_GROUPS.length; i++) {
    if (INCIDENT_ISSUE_GROUPS[i].issueTypes.indexOf(type) !== -1) return INCIDENT_ISSUE_GROUPS[i].group;
  }
  return INCIDENT_ISSUE_GROUP_OTHER;
}

/**
 * The earliest incident the list carries, as a plain 'yyyy-MM-dd' Manila date. A FIXED FLOOR, not a
 * rolling window: incidents feed evaluations, and a rolling window would silently drop the earliest
 * month of history every time it moved — so "2026 onwards" has to keep meaning 2026 onwards next
 * year, not "the last two years".
 *
 * Override with an INCIDENT_SYNC_START_DATE script property to move the floor without a redeploy.
 */
const INCIDENT_SYNC_START_DATE_DEFAULT = '2026-01-01';

function incidentSyncStartDate_() {
  const override = PropertiesService.getScriptProperties().getProperty('INCIDENT_SYNC_START_DATE');
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(String(override).trim())) return String(override).trim();
  return INCIDENT_SYNC_START_DATE_DEFAULT;
}

/**
 * Apps Script kills an execution at 6 minutes. A tagged-ticket set is manually curated so it's
 * small in practice, but an unbounded loop that also fetches a changelog per SE ticket is exactly
 * the shape that dies halfway through and leaves a partial sync. Cap it, report the cap, and let
 * a second run pick up the rest.
 */
const INCIDENT_SYNC_MAX_ISSUES = 250;

/**
 * Wall-clock budget for one sync run. The issue cap above bounds how many tickets are considered;
 * this bounds how long that actually takes, which is the limit that matters to the caller — the
 * Next.js route invoking this runs as a serverless function, and those cap out well under Apps
 * Script's own 6-minute ceiling (Vercel: 10-15s by default, 60s max on Hobby, 300s on Pro).
 * Overrunning it means the client gets a 504 while Apps Script keeps working, so the sync's result
 * is never reported even though it happened — which reads as "the button did nothing".
 *
 * 40s leaves headroom inside a 60s function limit for the round-trip either side of this call.
 * A run that hits it returns capped:true and the caller runs the sync again.
 */
const INCIDENT_SYNC_TIME_BUDGET_MS = 40000;

/**
 * How many stored issue keys the untagged sweep asks Jira about per request. 100 is the search
 * endpoint's page size, so a batch is one round-trip; the whole sweep costs
 * ceil(stored tickets / 100) searches regardless of how many turn out to be untagged.
 */
const INCIDENT_SWEEP_BATCH_SIZE = 100;

/**
 * The sweep's OWN wall-clock budget, on top of INCIDENT_SYNC_TIME_BUDGET_MS rather than carved out
 * of it. The forward pass routinely spends its entire budget and reports `capped`, and if the sweep
 * shared that clock it would get zero time on exactly those runs — untagged tickets would then only
 * ever disappear on a quiet day. Kept small so sync + sweep still fits inside the calling route's
 * 60s maxDuration (see api/gas/incidents/sync/route.ts).
 */
const INCIDENT_SWEEP_TIME_BUDGET_MS = 10000;

var IncidentsApi = {
  /**
   * params: team (team_key), year ("2026"), month ("2026-08"), startDate/endDate (yyyy-MM-dd).
   * month wins over year when both are present; startDate/endDate override both.
   *
   * Returns tickets AND logs for the window rather than a joined shape — the page needs tickets
   * that have no log yet (that's the manager's to-do list) just as much as it needs the logged
   * ones, and a join would have to fabricate empty rows to express that.
   */
  list: function (params) {
    const range = resolveIncidentDateRange_(params);
    const ss = getManagerDataSpreadsheet_();

    let tickets = sheetToObjects_(getOrCreateIncidentTicketsSheet_(ss)).map(stripRowMeta_).map((t) => {
      t.created = toDisplayDate_(t.created);
      t.resolved_datetime = toDisplayDate_(t.resolved_datetime);
      t.incident_date = toDisplayDate_(t.incident_date);
      // Derived on read, not stored: the grouping is a reporting decision, so changing it should
      // take effect immediately rather than requiring every ticket row to be re-synced. Blank for
      // teams that do not segregate by issue type at all (DBA/DevOps).
      t.issue_group = incidentTeamSegregatesIssueTypes_(t.team_key)
        ? incidentIssueGroup_(t.issue_type)
        : '';
      // `validator` in the sheet is the DERIVED value; the manual override layers over it here, so
      // clearing an override simply reveals the derivation again with no re-sync needed.
      t.validator_derived = String(t.validator || '');
      t.validator_override = String(t.validator_override || '');
      t.validator = t.validator_override || t.validator_derived;
      // Surfaced so the page can badge a ticket whose Jira tag has been cleared but which the
      // sweep refused to delete because it already carries logs. Through toDisplayDate_ like every
      // other date here: it was written as an ISO timestamp, but Sheets may have coerced the cell
      // to a Date, and the page only ever shows the day.
      t.untagged_at = toDisplayDate_(t.untagged_at);
      return t;
    });
    let logs = sheetToObjects_(getOrCreateIncidentLogsSheet_(ss)).map(stripRowMeta_).map((l) => {
      l.incident_date = toDisplayDate_(l.incident_date);
      l.score_impact = Number(l.score_impact) || 0;
      l.categories = parseJsonArray_(l.categories_json);
      delete l.categories_json;
      return l;
    });

    if (params.team) {
      tickets = tickets.filter((t) => t.team_key === params.team);
      logs = logs.filter((l) => l.team_key === params.team);
    }

    // The date window is applied HERE, before anything is derived from these lists. It used to run
    // last, which silently broke both derivations that came after it: the member dropdown offered
    // people with no logs in the window, and the team score was computed over every date on record
    // regardless of the selected period (Q1 with zero logs still reported the full-year score).
    if (range) {
      tickets = tickets.filter((t) => withinIncidentRange_(t.incident_date, range));
      logs = logs.filter((l) => withinIncidentRange_(l.incident_date, range));
    }

    // A log has no issue type of its own — it inherits its ticket's. Resolved via this map so the
    // group filter and the per-group stats treat a log and its ticket identically.
    const groupByKey = {};
    tickets.forEach((t) => { groupByKey[t.issue_key] = t.issue_group; });
    logs = logs.map((l) => {
      l.issue_group = groupByKey[l.issue_key] || '';
      return l;
    });

    if (params.group) {
      tickets = tickets.filter((t) => t.issue_group === params.group);
      logs = logs.filter((l) => l.issue_group === params.group);
    }

    // Who has a log in this window, collected BEFORE the member filter is applied - otherwise
    // picking a member would collapse the dropdown to only that member and strand the user there.
    const availableMembers = Object.keys(logs.reduce((acc, l) => {
      if (l.employee_name) acc[l.employee_name] = true;
      return acc;
    }, {})).sort();

    // Snapshots before the member filter, for the team scores - see computeIncidentStats_.
    const allLogsForScope = logs.slice();
    const allTicketsForScope = tickets.slice();

    if (params.member) {
      // Filters on the LOG's person, not the ticket's doer/validator: the question is "which
      // incidents is this person accountable for", and on a ticket where they were the validator
      // only, the doer named on the ticket is irrelevant to that.
      logs = logs.filter((l) => l.employee_name === params.member);
      // Restrict tickets to the ones those logs belong to. A tagged ticket with no log for this
      // person is not part of their record, so it also drops out of the awaiting-feedback queue.
      const keep = logs.reduce((acc, l) => { acc[l.issue_key] = true; return acc; }, {});
      tickets = tickets.filter((t) => keep[t.issue_key]);
    }

    tickets.sort((a, b) => String(b.incident_date).localeCompare(String(a.incident_date)));
    logs.sort((a, b) => String(b.incident_date).localeCompare(String(a.incident_date)));

    // Team scores cover the WHOLE team even when a member filter is active - the team's score does
    // not change because you happen to be looking at one person's incidents. Note this uses the
    // member-filtered `logs`; see computeIncidentTeamScores_ for why that is passed separately.
    const scoredTeamKeys = params.team
      ? [params.team]
      : getActiveTeamsConfig_().map((t) => t.team_key);

    return {
      range: range,
      // The sync's fixed floor, echoed so the page can state the tracked window instead of
      // keeping a second copy of it that could drift.
      startDate: incidentSyncStartDate_(),
      tickets: tickets,
      logs: logs,
      stats: computeIncidentStats_(tickets, logs, scoredTeamKeys, allLogsForScope, allTicketsForScope),
      issueGroups: INCIDENT_ISSUE_GROUP_NAMES,
      issueGroupTeamKeys: INCIDENT_ISSUE_GROUP_TEAM_KEYS,
      availableMembers: availableMembers,
      validatorNames: incidentValidatorNames_(),
      // Every distinct year present in the sheet, so the year filter offers real options
      // instead of a hardcoded span that goes stale.
      availableYears: availableIncidentYears_(),
    };
  },

  create: function (payload) {
    return withLock_(function () {
      const sheet = getOrCreateIncidentLogsSheet_(getManagerDataSpreadsheet_());
      const rows = sheetToObjects_(sheet);
      const normalized = normalizeIncidentLog_(payload);

      const duplicate = rows.find((r) =>
        r.issue_key === normalized.issue_key && r.role === normalized.role);
      if (duplicate) {
        throw new Error(
          `${normalized.issue_key} already has a ${normalized.role} log — edit that one instead of adding a second.`
        );
      }

      const now = nowIso_();
      const record = Object.assign({}, normalized, {
        incident_id: uuid_(),
        created_by: payload.created_by || '',
        created_at: now,
        updated_at: now,
      });
      appendObjectToSheet_(sheet, record);
      return toIncidentLogResponse_(record);
    });
  },

  update: function (id, payload) {
    return withLock_(function () {
      const sheet = getOrCreateIncidentLogsSheet_(getManagerDataSpreadsheet_());
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.incident_id === id);
      if (!existing) throw new Error(`Incident log not found: ${id}`);

      // Merge first, then normalize: a PATCH may carry only the fields that changed, and severity
      // -> score_impact has to be recomputed from whatever severity ends up winning.
      const merged = Object.assign({}, stripRowMeta_(existing), payload);
      const record = Object.assign({}, existing, normalizeIncidentLog_(merged), { updated_at: nowIso_() });
      updateSheetRow_(sheet, existing._row, record);
      return toIncidentLogResponse_(record);
    });
  },

  remove: function (id) {
    return withLock_(function () {
      const sheet = getOrCreateIncidentLogsSheet_(getManagerDataSpreadsheet_());
      const rows = sheetToObjects_(sheet);
      const existing = rows.find((r) => r.incident_id === id);
      if (!existing) throw new Error(`Incident log not found: ${id}`);
      deleteSheetRow_(sheet, existing._row);
      return { incident_id: id, deleted: true };
    });
  },

  /**
   * Manually sets (or clears) a ticket's validator, overriding whatever the changelog derivation
   * produced. Stored in its own column so a re-sync can't clobber it and so the derived value stays
   * visible underneath for comparison.
   *
   * payload: { issue_key, validator }. An empty validator clears the override and hands the field
   * back to the automatic derivation on the next sync. A name outside the designated reviewers is
   * rejected rather than silently accepted - the allowlist is the point, and a typo'd name would
   * quietly attribute reviews to somebody who doesn't exist.
   */
  setValidator: function (payload) {
    return withLock_(function () {
      const sheet = getOrCreateIncidentTicketsSheet_(getManagerDataSpreadsheet_());
      const rows = sheetToObjects_(sheet);
      const issueKey = String(payload.issue_key || '').trim();
      const existing = rows.find((r) => r.issue_key === issueKey);
      if (!existing) throw new Error(`Incident ticket not found: ${issueKey}`);

      const requested = String(payload.validator || '').trim();
      let override = '';
      if (requested) {
        override = canonicalIncidentValidator_(requested);
        if (!override) {
          throw new Error(
            `"${requested}" is not a designated validator. Allowed: ${incidentValidatorNames_().join(', ')}.`
          );
        }
      }

      // ONLY the override column is written. `validator` remains whatever the changelog derivation
      // produced, and the effective value is composed at read time (see list()). Overwriting
      // `validator` here instead would destroy the derived value, so clearing the override later
      // would "fall back" to the override that was just cleared rather than to the real derivation.
      const record = Object.assign({}, stripRowMeta_(existing), { validator_override: override });
      updateSheetRow_(sheet, existing._row, record);
      return {
        issue_key: issueKey,
        validator: override || String(existing.validator || ''),
        validator_derived: String(existing.validator || ''),
        validator_override: override,
      };
    });
  },

  /**
   * Takes a ticket out of the incident list AND clears its Report Tagging field in Jira, for a
   * ticket that on a second look was not a valid incident.
   *
   * The Jira write is what makes this meaningful rather than cosmetic. Report Tagging is the sole
   * membership condition, so deleting only the local row would hand the ticket straight back on the
   * next sync — the JQL still matches it. Clearing the field is therefore the operation, and the
   * row deletion is the follow-through.
   *
   * ORDER IS DELIBERATE: Jira first, sheet second. Both partial failures then converge on the right
   * end state — a failed Jira write leaves everything untouched and reports the reason (no edit
   * permission, field not on the screen), and a failed row delete after a successful untag is
   * cleaned up by the next sync's sweep. The reverse order has a partial failure that never heals.
   *
   * Any incident logs on the ticket go with it. That destroys manager-written feedback and the
   * evaluation deductions attached to it, so this is only ever reached from an explicit confirm in
   * the UI that states how many logs it will take — never from the daily trigger, which can only
   * flag (see sweepUntaggedIncidentTickets_).
   *
   * payload: { issue_key }.
   */
  removeTicket: function (payload) {
    const issueKey = String((payload && payload.issue_key) || '').trim();
    if (!issueKey) throw new Error('issue_key is required');

    const ss = getManagerDataSpreadsheet_();
    const ticketSheet = getOrCreateIncidentTicketsSheet_(ss);
    // Checked before the Jira call so a typo'd key doesn't clear a field on a ticket this dashboard
    // doesn't even track.
    if (!sheetToObjects_(ticketSheet).some((r) => r.issue_key === issueKey)) {
      throw new Error(`Incident ticket not found: ${issueKey}`);
    }

    // Outside withLock_ on purpose: this is a network round-trip, and holding the document lock
    // across it would block every other write on the spreadsheet for its duration.
    const fields = {};
    fields[INCIDENT_REPORT_TAGGING_FIELD] = null;
    jiraUpdateIssueFields_(issueKey, fields);

    return withLock_(function () {
      const logSheet = getOrCreateIncidentLogsSheet_(ss);
      const doomedLogs = sheetToObjects_(logSheet)
        .filter((l) => l.issue_key === issueKey)
        .map((l) => l._row);
      // Bottom-up: deleteRow shifts every row below it up by one.
      doomedLogs.sort((a, b) => b - a).forEach((rowIndex) => logSheet.deleteRow(rowIndex));

      // Re-read rather than reusing the index from the existence check above — that was taken
      // before the Jira round-trip, and another write could have moved the row since.
      const row = sheetToObjects_(ticketSheet).find((r) => r.issue_key === issueKey);
      if (row) deleteSheetRow_(ticketSheet, row._row);

      return {
        issue_key: issueKey,
        deleted: true,
        logsDeleted: doomedLogs.length,
        untaggedInJira: true,
      };
    });
  },

  /**
   * Pulls every Jira ticket carrying the Report Tagging field into INCIDENT_TICKETS, then sweeps
   * out the ones whose tag has since been REMOVED (see sweepUntaggedIncidentTickets_) — the tag is
   * the whole membership condition, so it has to be honoured in both directions or a retracted
   * incident stays on the page forever.
   *
   * params.team optionally limits the run to one team_key. Per-team failures are collected and
   * returned rather than thrown: `cf[10262] IS NOT EMPTY` is a hard JQL error on a project where
   * the field isn't available, and one such team must not block the others from syncing.
   */
  sync: function (params) {
    const startedAt = Date.now();
    const deadline = startedAt + INCIDENT_SYNC_TIME_BUDGET_MS;
    const floor = incidentSyncStartDate_();
    // Query params arrive as strings, so compare against 'true' rather than trusting truthiness
    // ('false' is a truthy string and would silently force every run).
    const force = !!(params && String(params.force) === 'true');
    const teams = getActiveTeamsConfig_().filter((t) => !params || !params.team || t.team_key === params.team);
    const sheet = getOrCreateIncidentTicketsSheet_(getManagerDataSpreadsheet_());

    // Clear out anything already stored from before the floor — otherwise narrowing the window
    // only stops NEW rows arriving and leaves the old ones sitting in the list forever. Runs
    // before existingByKey is built so the index reflects the post-prune sheet.
    const prune = pruneIncidentTicketsBefore_(sheet, floor);

    const existingByKey = {};
    sheetToObjects_(sheet).forEach((r) => { existingByKey[r.issue_key] = r; });

    const byTeam = [];
    const errors = [];
    const counters = { changelogFetches: 0 };
    let capped = false;
    let scanned = 0;
    let outOfWindow = 0;

    teams.forEach((team) => {
      try {
        const result = syncIncidentTicketsForTeam_(
          team, sheet, existingByKey, INCIDENT_SYNC_MAX_ISSUES - scanned, deadline, counters, floor, force);
        scanned += result.scanned;
        outOfWindow += result.outOfWindow;
        if (result.capped) capped = true;
        byTeam.push({ team_key: team.team_key, found: result.scanned, upserted: result.upserted, skipped: result.skipped });
      } catch (err) {
        errors.push({ team_key: team.team_key, error: String(err && err.message ? err.message : err) });
      }
    });

    // Only teams whose forward pass SUCCEEDED are swept. A team whose `cf[…] IS NOT EMPTY` JQL is
    // rejected (the field isn't available on that project) has already failed above, and sweeping
    // it would ask Jira the same rejected question — then read the failure as "none of these are
    // tagged any more" and delete the team's whole list. This gate is the primary guard against
    // that; fetchStillTaggedKeys_ carries a second one.
    const failedTeams = {};
    errors.forEach((e) => { failedTeams[e.team_key] = true; });
    const sweep = sweepUntaggedIncidentTickets_(
      sheet,
      teams.filter((t) => !failedTeams[t.team_key]),
      Date.now() + INCIDENT_SWEEP_TIME_BUDGET_MS
    );
    sweep.errors.forEach((e) => errors.push(e));
    if (sweep.capped) capped = true;

    return {
      syncedAt: nowIso_(),
      scanned: scanned,
      byTeam: byTeam,
      errors: errors,
      capped: capped,
      forced: force,
      startDate: floor,
      // Tickets Jira returned that fall before the floor once their real incident date is known.
      outOfWindow: outOfWindow,
      prunedBefore: prune.deleted,
      prunedKeptBecauseLogged: prune.keptBecauseLogged,
      // Tickets whose Report Tagging field has since been cleared in Jira: deleted outright when
      // they had no log, flagged for the manager to confirm when they did, and un-flagged when a
      // previously-untagged ticket has been tagged again.
      untaggedChecked: sweep.checked,
      untaggedRemoved: sweep.removed,
      untaggedFlagged: sweep.flagged,
      untaggedRestored: sweep.restored,
      elapsedMs: Date.now() - startedAt,
      // Surfaced because it's the one thing that makes a run slow — a spike here means the RAW
      // tabs are behind (see buildIncidentValidatorIndex_), not that Jira got slower.
      changelogFetches: counters.changelogFetches,
      note: capped
        ? 'Stopped early to stay inside the per-run time budget. Run the sync again to pick up the rest.'
        : '',
    };
  },
};

/**
 * One team's slice of the sync. Skips a ticket whose Jira `updated` timestamp matches what's
 * already stored — that's the expensive path avoided, because deriving the SE validator means
 * pulling the full (paginated) changelog for the issue, and a re-sync would otherwise redo that
 * for every historical incident on every run.
 */
function syncIncidentTicketsForTeam_(team, sheet, existingByKey, remainingBudget, deadline, counters, floor, force) {
  if (remainingBudget <= 0) return { scanned: 0, upserted: 0, skipped: 0, outOfWindow: 0, capped: true };

  const jql = buildIncidentJql_(team);
  const fields = buildIncidentJiraFieldList_(team);
  // Lazy, and memoised for the whole team: built at most once per run, and not at all on a run
  // where every ticket is skipped as unchanged — which is the common case for a re-sync, and
  // there is no reason for a no-op run to pay for a full RAW-tab scan.
  const loadValidatorIndex = makeValidatorIndexLoader_(team);

  let pageToken;
  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  let outOfWindow = 0;
  let capped = false;

  while (true) {
    const page = jiraSearchIssues_(jql, pageToken, 100, fields);

    for (let i = 0; i < page.issues.length; i++) {
      if (scanned >= remainingBudget || Date.now() > deadline) { capped = true; break; }
      const issue = page.issues[i];
      scanned++;

      // The authoritative window check. Deliberately BEFORE mapIssueToIncidentTicketRow_, because
      // that call is what may reach for a changelog to attribute the validator — no reason to pay
      // for a ticket that is about to be discarded.
      const incidentDate = incidentDateForIssue_(team, issue);
      if (floor && incidentDate && incidentDate < floor) {
        outOfWindow++;
        continue;
      }

      const existing = existingByKey[issue.key];
      // Under force, "already done" means "already carries the CURRENT attribution" rather than
      // "unchanged in Jira" — that's what makes a forced run advance instead of looping.
      const alreadyReattributed = existing
        && String(existing.validator_source || '') === INCIDENT_VALIDATOR_ATTRIBUTION;
      const unchanged = existing && String(existing.updated) === String(issue.fields.updated);
      if ((force && alreadyReattributed) || (!force && unchanged)) {
        skipped++;
        continue;
      }

      const row = mapIssueToIncidentTicketRow_(
        team, issue, existing, loadValidatorIndex, counters, incidentDate, force);
      if (existing) {
        updateSheetRow_(sheet, existing._row, row);
        // Keep the in-memory index in step so a later team's page can't re-append the same key.
        existingByKey[issue.key] = Object.assign({}, existing, row);
      } else {
        appendObjectToSheet_(sheet, row);
        existingByKey[issue.key] = Object.assign({ _row: sheet.getLastRow() }, row);
      }
      upserted++;
    }

    if (capped) break;
    if (!page.nextPageToken || page.issues.length === 0 || page.nextPageToken === pageToken) break;
    pageToken = page.nextPageToken;
  }

  return {
    scanned: scanned, upserted: upserted, skipped: skipped,
    outOfWindow: outOfWindow, capped: capped,
  };
}

/**
 * The `updated >= floor` clause is a cheap PREFILTER, not the real cut — the authoritative filter is
 * on incident_date (see the out-of-window skip in syncIncidentTicketsForTeam_). It is a safe
 * superset: incident_date is either the resolved date or the created date, and a ticket cannot be
 * resolved or created on a date later than its own last-updated timestamp. So every in-window
 * incident necessarily has `updated >= floor`, while tickets this clause lets through with an
 * earlier incident_date get dropped on the precise check.
 *
 * Filtering JQL on incident_date directly isn't an option: for DE/DEV it lives in a custom text
 * field, and for ST the fallback-to-created behaviour has no single Jira field to point at.
 */
function buildIncidentJql_(team) {
  const fieldId = INCIDENT_REPORT_TAGGING_FIELD.replace('customfield_', '');
  const floor = incidentSyncStartDate_().replace(/-/g, '/');
  return `project = ${team.jira_project_key} AND cf[${fieldId}] IS NOT EMPTY`
    + ` AND updated >= "${floor} 00:00" ORDER BY updated DESC`;
}

/**
 * Deliberately narrower than JiraSync.gs's buildJiraFieldList_ — the incident list needs the
 * ticket's identity, its owner, and the dates, not the FCR/escalation/holding metric fields.
 * `summary` is included here but is NOT part of the metrics sync's RAW tabs, which is why the
 * incident list can show a ticket title where the other reports only show a key.
 */
function buildIncidentJiraFieldList_(team) {
  return [
    'summary', 'created', 'updated', 'status', 'issuetype', 'assignee', 'resolutiondate',
    team.assignee_field_id,
    team.resolved_date_field_id,
  ].filter(Boolean);
}

function mapIssueToIncidentTicketRow_(team, issue, existing, loadValidatorIndex, counters, incidentDate, force) {
  const fields = issue.fields;
  const resolvedIso = resolveIncidentResolvedAt_(team, fields, issue.key);
  const validator = resolveIncidentValidator_(team, issue, existing, loadValidatorIndex, counters, force);

  return {
    issue_key: issue.key,
    team_key: team.team_key,
    project_key: team.jira_project_key,
    summary: fields.summary || '',
    issue_type: fields.issuetype ? fields.issuetype.name : '',
    status: fields.status ? fields.status.name : '',
    doer: resolveIncidentDoer_(team, fields),
    validator: validator.value,
    validator_source: validator.source,
    // Preserved explicitly: objectToSheetRow_ writes every header it finds a key for, so omitting
    // this would blank a manual override on the next sync.
    validator_override: (existing && existing.validator_override) || '',
    created: fields.created,
    updated: fields.updated,
    resolved_datetime: resolvedIso,
    // Computed by incidentDateForIssue_ and passed in, so the window check the caller already ran
    // and the value stored here cannot disagree.
    incident_date: incidentDate || incidentDateForIssue_(team, issue),
    last_synced_at: nowIso_(),
  };
}

/**
 * When the incident is treated as having happened — the date that decides which month/year it is
 * filed under, and the default for the log's own editable incident_date.
 *
 * Uses the team's configured resolved-date field first, so an incident files under the same date
 * every other report on this dashboard would attribute it to. Falls back to Jira's native
 * `resolutiondate`, then to nothing.
 *
 * Known caveat, accepted deliberately: on DE/DEV that configured field (customfield_11153) is
 * written by an automation and JiraSync.gs documents that some tickets carry a stale/earlier value
 * there — which is why the RAW sync ignores it for those teams and re-derives the date from the
 * changelog instead. Doing the same here would cost a full paginated changelog fetch per DE/DEV
 * incident, and this date is neither a metric nor final: it only picks a filing month, and the
 * manager can correct it on the log itself. The native `resolutiondate` fallback (already in the
 * field list, set by Jira rather than by an automation) covers the common case where the
 * automation never wrote a value at all.
 */
function resolveIncidentResolvedAt_(team, fields, issueKey) {
  const configured = parseResolvedDateField_(team, fields, issueKey);
  if (configured.value && !isNaN(configured.value.getTime())) {
    return configured.value.toISOString();
  }
  if (fields.resolutiondate) {
    const native = new Date(fields.resolutiondate);
    if (!isNaN(native.getTime())) return native.toISOString();
  }
  return '';
}

/**
 * The date an incident is counted under — for the year/month filter, for the evaluation period it
 * lands in, and for the sync's window check: when the work actually finished, falling back to
 * creation for a ticket still open. A plain Manila 'yyyy-MM-dd' string, so every comparison against
 * the floor and the filter range is a string compare.
 */
function incidentDateForIssue_(team, issue) {
  const resolvedIso = resolveIncidentResolvedAt_(team, issue.fields, issue.key);
  return toIsoDate_(new Date(resolvedIso || issue.fields.created));
}

/**
 * Deletes INCIDENT_TICKETS rows whose incident_date falls before `floor`.
 *
 * A ticket that already has an incident log is KEPT regardless: the log is manager-written feedback
 * that feeds someone's evaluation, and silently orphaning it to tidy up a date window would be
 * destroying the most valuable data on the page to remove the least valuable. Those are counted and
 * reported instead. (IncidentLogsTable already renders a log whose ticket row is missing, so an
 * orphan wouldn't even be visible as a problem — which is exactly why it must not happen quietly.)
 *
 * Rows are deleted bottom-up: deleteRow shifts every row below it up by one, so descending order is
 * what keeps the remaining row indices valid mid-loop.
 */
function pruneIncidentTicketsBefore_(sheet, floor) {
  if (!floor) return { deleted: 0, keptBecauseLogged: 0 };

  const loggedKeys = {};
  sheetToObjects_(getOrCreateIncidentLogsSheet_(getManagerDataSpreadsheet_()))
    .forEach((l) => { loggedKeys[l.issue_key] = true; });

  const rows = sheetToObjects_(sheet);
  const doomed = [];
  let keptBecauseLogged = 0;

  rows.forEach((r) => {
    const d = toDisplayDate_(r.incident_date);
    if (!d || d >= floor) return;
    if (loggedKeys[r.issue_key]) { keptBecauseLogged++; return; }
    doomed.push(r._row);
  });

  doomed.sort((a, b) => b - a).forEach((rowIndex) => sheet.deleteRow(rowIndex));
  return { deleted: doomed.length, keptBecauseLogged: keptBecauseLogged };
}

/**
 * Takes out of INCIDENT_TICKETS the rows whose Report Tagging field has been CLEARED in Jira.
 *
 * Untagging is how the manager retracts an incident after a closer look, and without this the row
 * lives forever: the forward sync's JQL is `cf[10262] IS NOT EMPTY`, so an untagged ticket simply
 * stops being returned, and an upsert-only pass cannot tell "no longer tagged" apart from "not in
 * this page of results".
 *
 * Deliberately a REVERSE check - it asks Jira about the keys already stored - rather than a "delete
 * anything this run didn't see" sweep over the forward pass's results. The forward pass is capped
 * (INCIDENT_SYNC_MAX_ISSUES, plus a wall-clock budget) and legitimately stops early, so a seen-set
 * sweep would delete most of the list on any capped run, and all of a team's list whenever
 * params.team narrowed the run. Asking by key is independent of how far the scan got, costs one
 * keys-only search per 100 stored tickets, and is safe to interrupt part-way: every row it has
 * already resolved stays resolved.
 *
 * A ticket that already has an incident log is NOT deleted - the same rule as
 * pruneIncidentTicketsBefore_ and for the same reason: the log is manager-written feedback carrying
 * an evaluation deduction, and a 7am trigger must not be able to destroy it. It is stamped with
 * untagged_at instead, which the page badges with a Remove action, so that deletion stays a
 * decision somebody makes.
 *
 * Re-tagging is handled in the same pass: a key Jira confirms as still tagged has any previous
 * untagged_at cleared, so an untag done by mistake is fully reversible by re-tagging in Jira.
 */
function sweepUntaggedIncidentTickets_(sheet, teams, deadline) {
  const fieldId = INCIDENT_REPORT_TAGGING_FIELD.replace('customfield_', '');

  const loggedKeys = {};
  sheetToObjects_(getOrCreateIncidentLogsSheet_(getManagerDataSpreadsheet_()))
    .forEach((l) => { loggedKeys[l.issue_key] = true; });

  const rowsByTeam = {};
  sheetToObjects_(sheet).forEach((r) => {
    const key = String(r.team_key || '');
    if (!rowsByTeam[key]) rowsByTeam[key] = [];
    rowsByTeam[key].push(r);
  });

  const doomed = [];
  const errors = [];
  let checked = 0;
  let flagged = 0;
  let restored = 0;
  let capped = false;

  teams.forEach((team) => {
    const rows = rowsByTeam[team.team_key] || [];

    for (let i = 0; i < rows.length; i += INCIDENT_SWEEP_BATCH_SIZE) {
      if (Date.now() > deadline) { capped = true; return; }
      const batch = rows.slice(i, i + INCIDENT_SWEEP_BATCH_SIZE);

      let stillTagged;
      try {
        stillTagged = fetchStillTaggedKeys_(team, batch.map((r) => r.issue_key), fieldId);
      } catch (err) {
        // A failed batch must NOT be read as "none of these are tagged" - that conclusion deletes
        // the batch. Report it and leave every row in it exactly as it is; the next run retries.
        errors.push({
          team_key: team.team_key,
          error: `untagged sweep: ${String(err && err.message ? err.message : err)}`,
        });
        return;
      }
      checked += batch.length;

      batch.forEach((row) => {
        const wasFlagged = !!String(row.untagged_at || '');

        if (stillTagged[row.issue_key]) {
          if (wasFlagged) {
            updateSheetRow_(sheet, row._row, Object.assign(stripRowMeta_(row), { untagged_at: '' }));
            restored++;
          }
          return;
        }

        if (loggedKeys[row.issue_key]) {
          // Already flagged: leave the original timestamp alone, so "untagged since" doesn't reset
          // on every sync and the row can't look newly retracted every morning.
          if (!wasFlagged) {
            updateSheetRow_(sheet, row._row, Object.assign(stripRowMeta_(row), { untagged_at: nowIso_() }));
            flagged++;
          }
          return;
        }

        doomed.push(row._row);
      });
    }
  });

  // Bottom-up, same as pruneIncidentTicketsBefore_: deleteRow shifts every row below it up by one,
  // so descending order is what keeps the collected indices valid mid-loop. Collected across all
  // teams and deleted once at the end, since the in-loop updateSheetRow_ calls don't move rows.
  doomed.sort((a, b) => b - a).forEach((rowIndex) => sheet.deleteRow(rowIndex));

  return {
    checked: checked,
    removed: doomed.length,
    flagged: flagged,
    restored: restored,
    errors: errors,
    capped: capped,
  };
}

/**
 * {issue_key -> true} for the subset of `keys` that STILL carry the Report Tagging field. Keys the
 * result omits are the untagged ones - that inversion is the whole point of the call.
 *
 * `fields: ['summary']` rather than no field list: jiraSearchIssues_ defaults to `*all` when given
 * none, which would pull every field of every ticket for a check that reads nothing but issue.key.
 *
 * `key in (...)` is a hard HTTP 400 if ANY key in the list no longer exists in Jira (a deleted or
 * moved issue), which would strand the whole batch - the same error every run, and the other 99
 * keys in it never resolved. So that specific error is answered by splitting the batch and retrying
 * each half, down to a single key, at which point the key itself is the problem: the issue is gone
 * from Jira, and "not tagged" is the correct conclusion for it.
 *
 * Every OTHER failure is rethrown, deliberately. Absorbing a 401, or a 5xx that survived
 * jiraFetchWithRetry_'s backoff, would turn an outage into a mass deletion. In particular a project
 * where customfield_10262 isn't available answers 400 too, and its message names the FIELD rather
 * than a key - hence isMissingIssueKeyError_ rather than a bare status check. (sync() also refuses
 * to sweep a team whose forward pass errored, which catches that case before it ever reaches here;
 * this is the second of those two guards.)
 */
function fetchStillTaggedKeys_(team, keys, fieldId) {
  if (!keys.length) return {};

  const found = {};
  const jql = `project = ${team.jira_project_key} AND key in (${keys.join(',')})`
    + ` AND cf[${fieldId}] IS NOT EMPTY`;

  try {
    let pageToken;
    while (true) {
      const page = jiraSearchIssues_(jql, pageToken, INCIDENT_SWEEP_BATCH_SIZE, ['summary']);
      page.issues.forEach((issue) => { found[issue.key] = true; });
      if (!page.nextPageToken || page.issues.length === 0 || page.nextPageToken === pageToken) break;
      pageToken = page.nextPageToken;
    }
    return found;
  } catch (err) {
    if (!isMissingIssueKeyError_(err)) throw err;
    if (keys.length === 1) return {};
    const mid = Math.ceil(keys.length / 2);
    return Object.assign(
      fetchStillTaggedKeys_(team, keys.slice(0, mid), fieldId),
      fetchStillTaggedKeys_(team, keys.slice(mid), fieldId)
    );
  }
}

/**
 * True if `err` is Jira rejecting a JQL `key in (...)` list because one of the keys doesn't exist -
 * "An issue with key 'ABC-123' does not exist for field 'key'." Matched on the field name as well
 * as the status so it cannot swallow the OTHER 400 this JQL can produce, which is the custom field
 * being unavailable on the project ("Field 'cf[10262]' does not exist or you do not have permission
 * to view it") and which must never be read as "these tickets are untagged".
 */
function isMissingIssueKeyError_(err) {
  const message = String(err && err.message ? err.message : err);
  return /HTTP 400\b/.test(message)
    && /does not exist/i.test(message)
    && /for field ['"]?key/i.test(message);
}

/** The team's configured owner field (Assigned SE / Assigned COD), falling back to Jira's own assignee. */
function resolveIncidentDoer_(team, fields) {
  const configured = extractJiraFieldValue_(fields[team.assignee_field_id]);
  if (configured) return String(configured);
  return fields.assignee ? fields.assignee.displayName : '';
}

/**
 * {issue_key -> validator} for a peer-review team, read from the RAW_<team>_<year> tabs.
 *
 * This exists because deriving the validator from Jira means pulling a ticket's full (paginated)
 * changelog, and the first sync of a couple of hundred tagged tickets is then a couple of hundred
 * sequential Jira round-trips — measured at ~180s for 155 ST tickets, which blows past the
 * serverless timeout on the calling side and makes the sync look like it silently did nothing.
 *
 * The metrics sync has already done that work: JiraSync.gs runs
 * extractPeerReviewCyclesWithReviewer_ on every ST ticket and stores the result in
 * peer_review_cycles_json. Reading it back is one cached sheet read for the whole team instead of
 * one HTTP call per ticket, and it's the exact same attribution the peer-review-wait report uses,
 * so the two can't disagree.
 *
 * Returns {} for a team with no peer-review step, which short-circuits the whole lookup.
 */
function makeValidatorIndexLoader_(team) {
  let cached = null;
  return function () {
    if (cached === null) cached = buildIncidentValidatorIndex_(team);
    return cached;
  };
}

function buildIncidentValidatorIndex_(team) {
  if (!team.has_peer_review_tracking) return {};

  const index = {};
  getAllRawRowsForTeam_(team.team_key).forEach((row) => {
    const cycles = parseJsonArray_(row.peer_review_cycles_json);
    // Last cycle with a reviewer wins — a ticket that bounced through review more than once is
    // attributed to whoever reviewed it most recently, matching resolveIncidentValidator_'s
    // changelog fallback so the two paths agree.
    //
    // reviewerAtEntry ONLY, never `reviewer`: `reviewer` is the assignee when the cycle CLOSED,
    // which is frequently whoever picked the ticket up at the NEXT stage rather than the person
    // who reviewed it (see extractPeerReviewCyclesWithReviewer_). A row synced before that field
    // existed simply yields nothing here and falls through to a live changelog fetch, so this
    // self-heals as syncAllTeams re-syncs rather than needing a coordinated backfill.
    for (let i = cycles.length - 1; i >= 0; i--) {
      if (cycles[i] && cycles[i].reviewerAtEntry) {
        index[row.issue_key] = String(cycles[i].reviewerAtEntry);
        break;
      }
    }
  });
  return index;
}

/**
 * The validator is whoever held the ticket when it last left "For Peer Review" — the same
 * reviewer attribution the peer-review-wait report uses. Only teams with a peer-review step have
 * one at all.
 *
 * Resolution order, cheapest first:
 *   1. an already-stored validator (a re-sync of a ticket updated for unrelated reasons);
 *   2. the RAW-tab index (no Jira call — see buildIncidentValidatorIndex_);
 *   3. a live changelog fetch, for a tagged ticket the RAW tabs don't cover yet.
 *
 * Step 3 is the expensive one and is counted, so a slow run is attributable rather than mysterious.
 * A ticket genuinely absent from the index because it never went through review resolves to '' at
 * step 3 too — correct, just via the slow path. That's the accepted cost of not being able to tell
 * "no reviewer" apart from "not synced yet" without asking Jira.
 */
function resolveIncidentValidator_(team, issue, existing, loadValidatorIndex, counters, force) {
  if (!team.has_peer_review_tracking) return { value: '', source: 'n/a' };

  // NOTE: the manual override is deliberately NOT short-circuited here. This function's job is to
  // produce the DERIVED value, which is stored on its own; the override is layered on top at read
  // time (list()). Keeping the two separate is what lets an override be cleared and reveal the real
  // derivation underneath, instead of stranding the value that was just removed.

  // `force` exists because this short-circuit is a correctness trap on a logic change: once a
  // validator is stored, no amount of re-syncing will ever revisit it, so a fix to the derivation
  // silently never reaches tickets already in the sheet.
  if (!force && existing && existing.validator) {
    return { value: String(existing.validator), source: String(existing.validator_source || '') };
  }

  // Only now is the index actually needed, so only now is it built.
  const index = loadValidatorIndex ? loadValidatorIndex() : {};
  const indexed = canonicalIncidentValidator_(index[issue.key]);
  if (indexed) return { value: indexed, source: INCIDENT_VALIDATOR_ATTRIBUTION };

  // An index hit that isn't a designated validator still answers the question - the reviewer field
  // held someone who doesn't review - so don't spend a changelog fetch re-deriving the same name.
  if (index[issue.key]) return { value: '', source: INCIDENT_VALIDATOR_ATTRIBUTION };

  if (counters) counters.changelogFetches += 1;
  const cycles = extractPeerReviewCyclesWithReviewer_(jiraGetChangelog_(issue.key));
  for (let i = cycles.length - 1; i >= 0; i--) {
    const candidate = canonicalIncidentValidator_(cycles[i].reviewerAtEntry);
    if (candidate) return { value: candidate, source: INCIDENT_VALIDATOR_ATTRIBUTION };
  }
  // Derived, and the answer is genuinely "nobody a designated reviewer" - still stamped, so a
  // forced re-run doesn't keep paying for a changelog fetch to rediscover the same blank.
  return { value: '', source: INCIDENT_VALIDATOR_ATTRIBUTION };
}

/**
 * Coerces a log payload into its stored shape and enforces every invariant that must not depend
 * on the client: a known severity code, the score impact that code carries, a valid role, and a
 * categories array serialized to JSON.
 */
function normalizeIncidentLog_(payload) {
  const severity = String(payload.severity || '').trim().toUpperCase();
  const rubric = INCIDENT_SEVERITIES[severity];
  if (!rubric) {
    throw new Error(`Unknown severity "${payload.severity}" — expected one of ${Object.keys(INCIDENT_SEVERITIES).join(', ')}.`);
  }

  const role = String(payload.role || '').trim();
  if (INCIDENT_ROLES.indexOf(role) === -1) {
    throw new Error(`Unknown role "${payload.role}" — expected one of ${INCIDENT_ROLES.join(', ')}.`);
  }

  const issueKey = String(payload.issue_key || '').trim();
  if (!issueKey) throw new Error('issue_key is required.');

  const employee = String(payload.employee_name || '').trim();
  if (!employee) throw new Error('employee_name is required.');

  const categories = Array.isArray(payload.categories)
    ? payload.categories
    : parseJsonArray_(payload.categories_json);

  return {
    issue_key: issueKey,
    team_key: String(payload.team_key || '').trim(),
    role: role,
    employee_name: employee,
    severity: severity,
    score_impact: rubric.scoreImpact,
    incident_date: toDisplayDate_(payload.incident_date) || toIsoDate_(new Date()),
    feedback_raw: String(payload.feedback_raw || ''),
    feedback_polished: String(payload.feedback_polished || ''),
    improvements: String(payload.improvements || ''),
    categories_json: JSON.stringify(categories),
    ai_model: String(payload.ai_model || ''),
    ai_generated_at: String(payload.ai_generated_at || ''),
    notes: String(payload.notes || ''),
  };
}

/** Stored shape -> API shape: categories back to an array, score as a number. */
function toIncidentLogResponse_(record) {
  const out = stripRowMeta_(record);
  out.categories = parseJsonArray_(out.categories_json);
  delete out.categories_json;
  out.score_impact = Number(out.score_impact) || 0;
  out.incident_date = toDisplayDate_(out.incident_date);
  return out;
}

function parseJsonArray_(value) {
  if (Array.isArray(value)) return value;
  if (value === '' || value === null || value === undefined) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

/**
 * Resolves the reporting window. Precedence: an explicit startDate/endDate pair, then
 * year + period, then year alone (the whole year).
 *
 * `period` is ONE dropdown covering both grains the evaluation cycle uses: 'Q1'-'Q4' for a
 * quarter, '01'-'12' for a month, blank for the full year. One control rather than separate
 * quarter and month selects, because they are mutually exclusive choices - two selects would let
 * someone ask for "Q1 and also August" and then need arbitrating.
 *
 * Returns null only when there is no year at all, which the list treats as every incident ever.
 */
function resolveIncidentDateRange_(params) {
  if (params.startDate && params.endDate) {
    return { startDate: params.startDate, endDate: params.endDate };
  }

  if (!params.year || !/^\d{4}$/.test(String(params.year))) return null;
  const year = Number(params.year);
  const period = String(params.period || '').trim().toUpperCase();

  const quarter = period.match(/^Q([1-4])$/);
  if (quarter) {
    const startMonth = (Number(quarter[1]) - 1) * 3;
    return {
      startDate: toIsoDate_(new Date(year, startMonth, 1)),
      // Day 0 of the month after the quarter's last is that last month's final day.
      endDate: toIsoDate_(new Date(year, startMonth + 3, 0)),
    };
  }

  if (/^(0[1-9]|1[0-2])$/.test(period)) {
    const month = Number(period);
    return {
      startDate: toIsoDate_(new Date(year, month - 1, 1)),
      endDate: toIsoDate_(new Date(year, month, 0)),
    };
  }

  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function withinIncidentRange_(dateStr, range) {
  const d = String(dateStr || '');
  if (!d) return false;
  return d >= range.startDate && d <= range.endDate;
}

function availableIncidentYears_() {
  const sheet = getOrCreateIncidentTicketsSheet_(getManagerDataSpreadsheet_());
  const years = {};
  sheetToObjects_(sheet).forEach((r) => {
    const d = toDisplayDate_(r.incident_date);
    if (d) years[d.slice(0, 4)] = true;
  });
  const list = Object.keys(years).sort().reverse();
  // A brand-new install has no rows yet; offering the current year keeps the filter usable.
  return list.length ? list : [String(new Date().getFullYear())];
}

/**
 * Rollups the Incident Logs page shows above the table. `unloggedTickets` is the manager's
 * actual to-do count — tickets tagged in Jira that nobody has written feedback for yet — which
 * is why tickets and logs are counted separately rather than as one joined total.
 */
/**
 * The 100-based scores.
 *
 *   individual = 100 - (sum of that person's severity deductions in the window)
 *   team       = 100 - (team's total deductions / number of ACTIVE ROSTER MEMBERS on that team)
 *
 * Severity impacts are stored negative (S1 = -3); the scores subtract their MAGNITUDE, so
 * incidents always push a score down.
 *
 * The team denominator is the full active roster, not just the people who happened to have an
 * incident. That makes the team score the true mean of its members' individual scores (since
 * avg(100 - d_i) == 100 - avg(d_i), and a member with no incidents contributes 100), and it keeps
 * the number stable: dividing by "people with logs" would score a team where one person slipped
 * once the same as a team where everyone did.
 *
 * Deliberately NOT clamped at 0 - it would take 34 S1 incidents by one person to go negative, and
 * a negative score showing up is more useful as a signal that something is wrong with the data
 * than a floor silently hiding it.
 *
 * `scoreReady` is the important field. A team with no logs scores 100 arithmetically, but that is
 * only MEANINGFUL if there is also nothing left to write up: with tagged tickets still awaiting
 * feedback, a flat 100 is indistinguishable from a genuinely clean period, and it would present an
 * unfinished review as a perfect result. So the score is reported as not-yet-determined whenever
 * `unloggedTickets > 0`, and the frontend shows the pending count instead of a number. Once the
 * queue is clear, 100 means what it says: nothing was flagged.
 */
function computeIncidentTeamScores_(logs, teamKeys, tickets) {
  const loggedKeys = {};
  (logs || []).forEach((l) => { loggedKeys[l.issue_key] = true; });

  return (teamKeys || []).map((teamKey) => {
    const rosterCount = getActiveRosterNames_(teamKey).length;
    const teamLogs = logs.filter((l) => l.team_key === teamKey);
    const teamTickets = (tickets || []).filter((t) => t.team_key === teamKey);
    const unlogged = teamTickets.filter((t) => !loggedKeys[t.issue_key]).length;

    const deduction = round2_(teamLogs.reduce((sum, l) => sum + Math.abs(l.score_impact), 0));
    const avg = rosterCount > 0 ? deduction / rosterCount : 0;

    return {
      team_key: teamKey,
      rosterCount: rosterCount,
      logCount: teamLogs.length,
      ticketCount: teamTickets.length,
      unloggedTickets: unlogged,
      deductionTotal: deduction,
      avgDeductionPerMember: round2_(avg),
      teamScore: round2_(100 - avg),
      scoreReady: unlogged === 0,
    };
  });
}

/**
 * `scoreLogs` is the UNFILTERED-by-member log set: team scores must reflect the whole team even
 * while the page is showing one person's incidents. Everything else keys off `logs`, which is what
 * the user is actually looking at.
 */
function computeIncidentStats_(tickets, logs, scoredTeamKeys, scoreLogs, scoreTickets) {
  const loggedKeys = {};
  logs.forEach((l) => { loggedKeys[l.issue_key] = true; });

  const bySeverity = Object.keys(INCIDENT_SEVERITIES).map((code) => ({
    severity: code,
    label: INCIDENT_SEVERITIES[code].label,
    scoreImpact: INCIDENT_SEVERITIES[code].scoreImpact,
    count: logs.filter((l) => l.severity === code).length,
  }));

  const byEmployee = {};
  const byCategory = {};
  const byRole = {};

  logs.forEach((l) => {
    const name = l.employee_name || '(unassigned)';
    if (!byEmployee[name]) {
      byEmployee[name] = {
        employee: name, team_key: l.team_key, count: 0, scoreImpact: 0,
        deduction: 0, score: 100, asDoer: 0, asValidator: 0,
      };
    }
    byEmployee[name].count += 1;
    byEmployee[name].scoreImpact = round2_(byEmployee[name].scoreImpact + l.score_impact);
    byEmployee[name].deduction = round2_(byEmployee[name].deduction + Math.abs(l.score_impact));
    byEmployee[name].score = round2_(100 - byEmployee[name].deduction);
    if (l.role === 'Validator') byEmployee[name].asValidator += 1;
    else byEmployee[name].asDoer += 1;

    byRole[l.role] = (byRole[l.role] || 0) + 1;
    (l.categories || []).forEach((c) => { byCategory[c] = (byCategory[c] || 0) + 1; });
  });

  const teamScores = computeIncidentTeamScores_(scoreLogs || logs, scoredTeamKeys, scoreTickets || tickets);

  const byIssueGroup = INCIDENT_ISSUE_GROUP_NAMES.map((group) => {
    const groupTickets = tickets.filter((t) => t.issue_group === group);
    const groupLogs = logs.filter((l) => l.issue_group === group);
    return {
      group: group,
      tickets: groupTickets.length,
      logs: groupLogs.length,
      scoreImpact: round2_(groupLogs.reduce((sum, l) => sum + l.score_impact, 0)),
    };
  });

  return {
    totalTickets: tickets.length,
    totalLogs: logs.length,
    teamScores: teamScores,
    byIssueGroup: byIssueGroup,
    unloggedTickets: tickets.filter((t) => !loggedKeys[t.issue_key]).length,
    totalScoreImpact: round2_(logs.reduce((sum, l) => sum + l.score_impact, 0)),
    bySeverity: bySeverity,
    byRole: INCIDENT_ROLES.map((r) => ({ role: r, count: byRole[r] || 0 })),
    byEmployee: Object.keys(byEmployee)
      .map((k) => byEmployee[k])
      .sort((a, b) => a.scoreImpact - b.scoreImpact),
    byCategory: Object.keys(byCategory)
      .map((k) => ({ category: k, count: byCategory[k] }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Self-healing tab access, matching the pattern JiraSync.gs uses for RAW tabs: an install that
 * predates this feature won't have these tabs, and a route that 500s until someone remembers to
 * re-run setupAll is a worse failure than just creating them on first touch.
 */
function getOrCreateIncidentTicketsSheet_(ss) {
  const sheet = ensureTab_(ss, 'INCIDENT_TICKETS', INCIDENT_TICKET_HEADERS);
  // ensureTab_ only sets headers on a BRAND-NEW tab, so a column added after the tab already
  // existed has to be appended explicitly — otherwise objectToSheetRow_ maps by header name,
  // finds no column, and drops the value silently on every write.
  appendColumnIfMissing_(sheet, 'validator_source');
  appendColumnIfMissing_(sheet, 'validator_override');
  appendColumnIfMissing_(sheet, 'untagged_at');
  return sheet;
}

function getOrCreateIncidentLogsSheet_(ss) {
  return ensureTab_(ss, 'INCIDENT_LOGS', INCIDENT_LOG_HEADERS);
}

/** Trigger entry point — see Triggers.gs. Wrapped so a failure emails instead of dying silently. */
function syncIncidentTickets() {
  try {
    const result = IncidentsApi.sync({});
    Logger.log(`syncIncidentTickets: ${JSON.stringify(result)}`);
    if (result.errors.length) {
      notifyFailure_('syncIncidentTickets completed with per-team errors', JSON.stringify(result.errors));
    }
  } catch (err) {
    notifyFailure_('syncIncidentTickets failed', err);
    throw err;
  }
}
