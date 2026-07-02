/**
 * Gemini free-tier narrative insights. Runs once daily (see Triggers.gs) — 3 teams +
 * 1 rollup = 4 calls/day, trivially inside free-tier limits, so no batching tricks needed.
 * Outlier detection is rule-based (detectOutliers_), not left to the LLM to notice —
 * the model only writes prose around numbers this script already computed and verified.
 */

const GEMINI_MODEL = 'gemini-2.0-flash'; // confirm this is still the current free-tier model id before relying on it

function generateInsightsAllTeams() {
  const teams = getActiveTeamsConfig_();
  const teamSummaries = [];

  teams.forEach((team) => {
    try {
      const summary = generateInsightForScope_(team);
      teamSummaries.push({ team: team.team_name, metrics: summary });
    } catch (err) {
      writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), '', [], 'FAILED', String(err));
      notifyFailure_(`generateInsightsAllTeams failed for ${team.team_key}`, err);
    }
  });

  if (!teamSummaries.length) return;

  try {
    const result = callGemini_(buildRollupPrompt_(teamSummaries));
    writeInsightCache_('ROLLUP:ALL', currentMonthLabel_(), result.narrative, [], 'SUCCESS', '');
  } catch (err) {
    writeInsightCache_('ROLLUP:ALL', currentMonthLabel_(), '', [], 'FAILED', String(err));
    notifyFailure_('generateInsightsAllTeams rollup failed', err);
  }
}

function generateInsightForScope_(team) {
  const current = getTicketMetrics_({ team: team.team_key, range: 'month', period: currentMonthLabel_() });
  const previous = getTicketMetrics_({ team: team.team_key, range: 'month', period: previousMonthLabel_() });
  const currentAssignees = getAssigneeMetrics_({ team: team.team_key, range: 'month', period: currentMonthLabel_() }).assignees;
  const previousAssignees = getAssigneeMetrics_({ team: team.team_key, range: 'month', period: previousMonthLabel_() }).assignees;

  const outliers = detectOutliers_(team, currentAssignees, previousAssignees);
  const result = callGemini_(buildGeminiPrompt_(team, current, previous, outliers));

  writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), result.narrative, outliers, 'SUCCESS', '');
  return current;
}

/**
 * Deterministic outlier flags — feeds both the Gemini prompt and flags_json, and is
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
function buildGeminiPrompt_(team, current, previous, outliers) {
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

/** Same retry-with-backoff pattern as JiraClient.gs's fetchWithRetry_, applied to the Gemini REST endpoint. */
function callGemini_(prompt) {
  const apiKey = getScriptProperty_('GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true,
  };

  const retryableCodes = [429, 500, 502, 503, 504];
  let lastErrorMessage;

  for (let attempt = 0; attempt <= 3; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code >= 200 && code < 300) {
      const json = JSON.parse(response.getContentText());
      const candidate = json.candidates && json.candidates[0];
      const text = candidate && candidate.content && candidate.content.parts
        ? candidate.content.parts.map((p) => p.text).join('')
        : '';
      return { narrative: text.trim() };
    }

    lastErrorMessage = `Gemini request failed (HTTP ${code}): ${response.getContentText().slice(0, 300)}`;
    if (retryableCodes.indexOf(code) !== -1 && attempt < 3) {
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  throw new Error(lastErrorMessage);
}

function writeInsightCache_(scopeKey, periodLabel, narrative, flags, status, errorMessage) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  const rows = sheetToObjects_(sheet);
  const existing = rows.find((r) => r.scope_key === scopeKey && r.period_label === periodLabel);
  const record = {
    scope_key: scopeKey,
    period_label: periodLabel,
    narrative_text: narrative || '',
    flags_json: JSON.stringify(flags || []),
    generated_at: nowIso_(),
    model_used: GEMINI_MODEL,
    prompt_tokens_est: '',
    generation_status: status,
    error_message: errorMessage || '',
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
