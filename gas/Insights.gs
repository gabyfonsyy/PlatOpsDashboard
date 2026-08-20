/**
 * Narrative insights, written by the open-weight model behind AiClient.gs (Groq-hosted).
 * Runs once daily (see Triggers.gs) — 3 teams + 1 rollup = 4 calls/day, so no batching
 * tricks are needed on any provider tier. Outlier detection is rule-based (detectOutliers_),
 * not left to the LLM to notice — the model only writes prose around numbers this script
 * already computed and verified.
 *
 * Previously called Gemini directly from this file; the transport now lives in AiClient.gs so
 * the incident-log assist and the Next.js side share one provider and one key (AI_API_KEY).
 */

/**
 * What this feature does. The TONE comes from AiVoice.gs and is composed on top at call time —
 * nothing about personality belongs in here, and nothing about ticket metrics belongs in there.
 *
 * The model is a writer, not an analyst: every figure it sees was computed and verified by
 * Aggregation.gs first. Open-weight models will otherwise 'helpfully' round or restate a number
 * they half-remember, so the no-invented-numbers rule is repeated here on top of the shared rules.
 */
const INSIGHT_FEATURE_INSTRUCTIONS = [
  'TASK: summarise how a team\'s month is going, for the manager who owns it.',
  '',
  'SPECIFIC TO THIS FEATURE:',
  '- Every number you need is in the data. Never invent, estimate or round one that is not there.',
  '- Compare this month to last month and say what actually changed — a shift in the mix matters',
  '  more than a headline total that held steady.',
  '- If flaggedIndividuals is non-empty, name each person with the specific metric and number that',
  '  flagged them. If it is empty, do not mention individuals at all.',
  '- Plain prose. No markdown headers, no bullet lists, no "Here is the summary" preamble.',
  '- 2-4 sentences. This is a card, not a report.',
].join('\n');

/**
 * Generates every scope. NOT on a trigger (see Triggers.gs) — reachable from the
 * 'generate-insight' route with scope=ALL, or by running it by hand from the editor.
 *
 * `force` bypasses the source-version check. Without it, a scope whose underlying metrics haven't
 * moved since its last successful generation is skipped entirely: no model call, cached row left
 * as-is. That's what makes an accidental double-click, or a second person asking the same
 * question, cost nothing.
 */
function generateInsightsAllTeams(force, voice) {
  const teams = getActiveTeamsConfig_();
  const teamSummaries = [];
  const results = [];

  teams.forEach((team) => {
    try {
      const outcome = generateInsightForScope_(team, force, voice);
      teamSummaries.push({ team: team.team_name, metrics: outcome.metrics });
      results.push({ scope: `TEAM:${team.team_key}`, status: outcome.skipped ? 'CACHED' : 'GENERATED' });
    } catch (err) {
      writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), '', [], 'FAILED', String(err), '');
      results.push({ scope: `TEAM:${team.team_key}`, status: 'FAILED', error: String(err) });
      notifyFailure_(`generateInsights failed for ${team.team_key}`, err);
    }
  });

  if (!teamSummaries.length) return { results: results, aiCalls: countGenerated_(results) };

  try {
    const rollupData = teamSummaries.map((s) => Object.assign({ team: s.team }, pickMetricsForPrompt_(s.metrics)));
    // Voice is part of the key: the same numbers in a different register are a different answer,
    // so switching theme and regenerating must not be answered from the other register's cache.
    const version = sourceVersion_({ rollup: rollupData, voice: normalizeVoiceMode_(voice) });
    if (!force && isInsightCurrent_('ROLLUP:ALL', currentMonthLabel_(), version)) {
      results.push({ scope: 'ROLLUP:ALL', status: 'CACHED' });
    } else {
      const narrative = callAiModel_(buildRollupPrompt_(teamSummaries), {
        systemPrompt: voicedSystemPrompt_(INSIGHT_FEATURE_INSTRUCTIONS, voice),
        tier: 'fast',
      });
      writeInsightCache_('ROLLUP:ALL', currentMonthLabel_(), narrative, [], 'SUCCESS', '', version);
      results.push({ scope: 'ROLLUP:ALL', status: 'GENERATED' });
    }
  } catch (err) {
    writeInsightCache_('ROLLUP:ALL', currentMonthLabel_(), '', [], 'FAILED', String(err), '');
    results.push({ scope: 'ROLLUP:ALL', status: 'FAILED', error: String(err) });
    notifyFailure_('generateInsights rollup failed', err);
  }

  return { results: results, aiCalls: countGenerated_(results) };
}

function countGenerated_(results) {
  return results.filter(function (r) { return r.status === 'GENERATED'; }).length;
}

/**
 * Generates ONE scope on request. `scope` is 'ROLLUP:ALL' or 'TEAM:<key>'.
 * Returns { scope, status: 'GENERATED' | 'CACHED' | 'FAILED', aiCalls } so the caller can show
 * honestly whether an AI request was actually spent.
 */
function generateInsightForScopeKey(scope, force, voice) {
  if (!scope || scope === 'ALL') return generateInsightsAllTeams(force, voice);

  if (scope === 'ROLLUP:ALL') {
    // The rollup is a function of every team's metrics, so it can't be produced in isolation
    // without recomputing them all anyway.
    return generateInsightsAllTeams(force, voice);
  }

  const key = String(scope).indexOf('TEAM:') === 0 ? String(scope).slice(5) : String(scope);
  const team = getActiveTeamsConfig_().find(function (t) { return t.team_key === key; });
  if (!team) throw new Error(`Unknown insight scope: ${scope}`);

  try {
    const outcome = generateInsightForScope_(team, force, voice);
    return {
      results: [{ scope: `TEAM:${team.team_key}`, status: outcome.skipped ? 'CACHED' : 'GENERATED' }],
      aiCalls: outcome.skipped ? 0 : 1,
    };
  } catch (err) {
    writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), '', [], 'FAILED', String(err), '');
    throw err;
  }
}

function generateInsightForScope_(team, force, voice) {
  const current = getTicketMetrics_({ team: team.team_key, range: 'month', period: currentMonthLabel_() });
  const previous = getTicketMetrics_({ team: team.team_key, range: 'month', period: previousMonthLabel_() });
  const currentAssignees = getAssigneeMetrics_({ team: team.team_key, range: 'month', period: currentMonthLabel_() }).assignees;
  const previousAssignees = getAssigneeMetrics_({ team: team.team_key, range: 'month', period: previousMonthLabel_() }).assignees;

  const outliers = detectOutliers_(team, currentAssignees, previousAssignees);

  // The fingerprint covers exactly what the prompt will contain — nothing more. So one extra
  // ticket that doesn't move any of these rolled-up figures does NOT invalidate the insight, which
  // is the whole point: regenerating for every trivial data change is how a free tier evaporates.
  const version = sourceVersion_({
    thisMonth: pickMetricsForPrompt_(current),
    lastMonth: pickMetricsForPrompt_(previous),
    flags: outliers,
    // See the rollup note: register is part of what makes an answer distinct.
    voice: normalizeVoiceMode_(voice),
  });

  if (!force && isInsightCurrent_(`TEAM:${team.team_key}`, currentMonthLabel_(), version)) {
    return { metrics: current, skipped: true };
  }

  // 'fast' tier: this is prose written around numbers that are already computed and verified.
  // It needs fluency, not reasoning, so the small model is the right tool.
  const narrative = callAiModel_(buildInsightPrompt_(team, current, previous, outliers), {
    systemPrompt: voicedSystemPrompt_(INSIGHT_FEATURE_INSTRUCTIONS, voice),
    tier: 'fast',
  });

  writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), narrative, outliers, 'SUCCESS', '', version);
  return { metrics: current, skipped: false };
}

/**
 * Short, stable hash of whatever will be sent to the model. Compared against the stored
 * source_version to decide whether a regeneration would actually produce anything new.
 *
 * MD5 is used purely as a change detector here (not for security) — cheap, built in, and the
 * collision risk on "did these numbers change" is irrelevant.
 */
function sourceVersion_(payload) {
  const json = JSON.stringify(payload);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); })
    .join('')
    .slice(0, 16);
}

/** True when a SUCCESSFUL insight already exists for this scope/period at this exact source version. */
function isInsightCurrent_(scopeKey, periodLabel, version) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  if (!sheet) return false;
  const row = sheetToObjects_(sheet).find(function (r) {
    return r.scope_key === scopeKey && String(r.period_label) === String(periodLabel);
  });
  if (!row) return false;
  return String(row.generation_status) === 'SUCCESS' && String(row.source_version || '') === String(version);
}

/**
 * Deterministic outlier flags — feeds both the model prompt and flags_json, and is
 * what the Performance page (Next.js) merges onto assignee rows for review badges.
 */
function detectOutliers_(team, currentAssignees, previousAssignees) {
  if (!currentAssignees.length) return [];

  const activeRoster = getActiveRosterNames_(team.team_key);
  const prevByName = {};
  previousAssignees.forEach((a) => { prevByName[a.name] = a; });

  const escalationRates = currentAssignees.map((a) => a.escalationRate).filter((v) => v !== null);
  const agingRates = currentAssignees.map((a) => a.backlogAgingRate).filter((v) => v !== null);
  const fcrRates = currentAssignees.map((a) => a.fcrRate).filter((v) => v !== null);
  const volumes = currentAssignees.map((a) => a.ticketsAssigned);

  const escMean = mean_(escalationRates), escStdev = stdev_(escalationRates);
  const agingMean = mean_(agingRates), agingStdev = stdev_(agingRates);
  const fcrMean = mean_(fcrRates);
  const volumeMedian = median_(volumes);

  const flags = [];

  currentAssignees.forEach((a) => {
    if (team.has_fcr_escalation && a.escalationRate !== null) {
      const threshold = escalationRates.length >= 4 ? escMean + escStdev : 0.25;
      if (a.escalationRate > threshold) {
        flags.push({
          employee: a.name, metric: 'escalationRate', severity: 'warning', code: 'HIGH_ESCALATION',
          detail: `Escalation rate ${pct_(a.escalationRate)} vs team avg ${pct_(escMean)}`,
        });
      }
    }

    if (a.backlogAgingRate !== null) {
      const threshold = agingRates.length >= 4 ? agingMean + agingStdev : 0.3;
      const prev = prevByName[a.name];
      if (a.backlogAgingRate > threshold && prev && prev.backlogAgingRate !== null && prev.backlogAgingRate > threshold) {
        flags.push({
          employee: a.name, metric: 'backlogAgingRate', severity: 'warning', code: 'CHRONIC_BACKLOG_AGING',
          detail: `Backlog aging ${pct_(a.backlogAgingRate)} for 2 consecutive months`,
        });
      }
    }

    if (activeRoster.indexOf(a.name) !== -1 && volumeMedian > 0 && a.ticketsAssigned < volumeMedian * 0.5) {
      flags.push({
        employee: a.name, metric: 'ticketsAssigned', severity: 'info', code: 'LOW_TICKET_VOLUME',
        detail: `Ticket volume ${a.ticketsAssigned} is below 50% of team median (${volumeMedian})`,
      });
    }

    if (team.has_fcr_escalation && a.fcrRate !== null && a.fcrRate < fcrMean - 0.15) {
      flags.push({
        employee: a.name, metric: 'fcrRate', severity: 'info', code: 'LOW_FCR',
        detail: `FCR rate ${pct_(a.fcrRate)} below team avg ${pct_(fcrMean)}`,
      });
    }
  });

  return flags;
}

function getActiveRosterNames_(teamKey) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('ROSTER');
  return sheetToObjects_(sheet)
    .filter((r) => r.team_key === teamKey && String(r.status).trim() === 'Active')
    .map((r) => r.employee_name);
}

function mean_(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stdev_(arr) {
  if (arr.length < 2) return 0;
  const m = mean_(arr);
  return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length);
}

function median_(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct_(n) { return `${(n * 100).toFixed(1)}%`; }

/**
 * Structured, not free-form: only aggregated numbers go in the prompt (never raw ticket
 * dumps), both for free-tier token budget and to structurally prevent hallucinated
 * ticket-level detail.
 */
function buildInsightPrompt_(team, current, previous, outliers) {
  const data = {
    team: team.team_name,
    period: current.period,
    thisMonth: pickMetricsForPrompt_(current),
    lastMonth: pickMetricsForPrompt_(previous),
    flaggedIndividuals: outliers,
  };

  return [
    'You are writing a monthly operations summary for an engineering manager preparing an MBR/QBR deck and performance evaluations.',
    'Use ONLY the numbers in the JSON data below — do not invent or estimate any number not present.',
    'Write a 3-5 sentence narrative summary comparing this month to last month, in plain prose (no markdown headers).',
    'If flaggedIndividuals is non-empty, call out each person by name with the specific metric and number that triggered the flag.',
    'If flaggedIndividuals is empty, do not mention individuals.',
    '',
    'DATA:',
    JSON.stringify(data),
  ].join('\n');
}

function buildRollupPrompt_(teamSummaries) {
  const data = teamSummaries.map((s) => Object.assign({ team: s.team }, pickMetricsForPrompt_(s.metrics)));
  return [
    'You are writing a monthly cross-team operations summary for an engineering manager overseeing SE, DBA, and DevOps, preparing an MBR/QBR deck.',
    'Use ONLY the numbers in the JSON data below — do not invent or estimate any number not present.',
    'Write a 3-5 sentence narrative comparing the teams and highlighting the most notable trend across the org this month.',
    '',
    'DATA:',
    JSON.stringify(data),
  ].join('\n');
}

function pickMetricsForPrompt_(m) {
  return {
    ticketVolume: m.ticketVolume,
    ticketsCreated: m.ticketsCreated,
    ticketsResolved: m.ticketsResolved,
    leadTimeAvgMinutes: m.leadTimeAvgMinutes,
    cycleTimeAvgMinutes: m.cycleTimeAvgMinutes,
    fcrRate: m.fcrRate,
    escalationRate: m.escalationRate,
    backlogAgingRate: m.backlogAgingRate,
  };
}

function writeInsightCache_(scopeKey, periodLabel, narrative, flags, status, errorMessage, sourceVersion) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  // Self-heal: the column arrived after this tab was first provisioned, and objectToSheetRow_ maps
  // by header name — without the column the version would be silently dropped and every check
  // would miss, quietly restoring the regenerate-every-time behaviour this exists to prevent.
  appendColumnIfMissing_(sheet, 'source_version');
  const rows = sheetToObjects_(sheet);
  const existing = rows.find((r) => r.scope_key === scopeKey && r.period_label === periodLabel);
  const record = {
    scope_key: scopeKey,
    period_label: periodLabel,
    narrative_text: narrative || '',
    flags_json: JSON.stringify(flags || []),
    generated_at: nowIso_(),
    model_used: getAiModel_('fast'),
    prompt_tokens_est: '',
    generation_status: status,
    error_message: errorMessage || '',
    source_version: sourceVersion || '',
  };
  if (existing) {
    updateSheetRow_(sheet, existing._row, record);
  } else {
    appendObjectToSheet_(sheet, record);
  }
}

function currentMonthLabel_() {
  return monthLabel_(new Date());
}

function previousMonthLabel_() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthLabel_(d);
}
