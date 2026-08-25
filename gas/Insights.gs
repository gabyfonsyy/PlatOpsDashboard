/**
 * Narrative insights and improvement recommendations, written by the open-weight model behind
 * AiClient.gs (Groq-hosted). Button-triggered, never on a schedule (see Triggers.gs): one call per
 * team, and one team's narrative and its recommendations come back from that SAME call, so adding
 * the recommendations cost zero extra requests. Scopes are per-team only — there is no org rollup.
 *
 * BOTH analyses are rule-based and run before the model sees anything: detectOutliers_ finds the
 * people worth flagging, detectOpportunities_ finds the problems worth fixing. The model only
 * writes prose around numbers this script already computed and verified.
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
  'TASK: summarise how a team\' month is going AND propose concrete ways to improve it, for the',
  'manager who owns that team.',
  '',
  'RESPOND WITH A JSON OBJECT ONLY, in exactly this shape:',
  '{"narrative": "...", "recommendations": [{"signal": "SIGNAL_CODE", "title": "...",',
  ' "category": "automation|process|systems|documentation", "evidence": "...", "action": "..."}]}',
  '',
  'NARRATIVE:',
  '- Every number you need is in the data. Never invent, estimate or round one that is not there.',
  '- Compare this month to last month and say what actually changed - a shift in the mix matters',
  '  more than a headline total that held steady.',
  '- If flaggedIndividuals is non-empty, name each person with the specific metric and number that',
  '  flagged them. If it is empty, do not mention individuals at all.',
  '- Plain prose, 2-4 sentences. No markdown headers, no bullet lists, no preamble. This is a card,',
  '  not a report.',
  '',
  'RECOMMENDATIONS - read these rules literally:',
  '- Write ONE recommendation per entry in `opportunities`, in the order given, up to 4. If',
  '  `opportunities` is empty, return an empty array. NEVER raise a problem that has no signal',
  '  behind it, however plausible it looks.',
  '- `signal`: copy that opportunity\' `code` verbatim.',
  '- `evidence`: restate that opportunity\' own numbers in one sentence. Only its numbers.',
  '- `action`: ONE specific thing the team can build or change - a Jira automation rule, an',
  '  assignment/routing rule, a field or validation on the intake form, a runbook or KB article, a',
  '  saved filter with an alert, a recurring check. Name the mechanism and say where it lives.',
  '  "Investigate further", "monitor closely", "improve communication", "provide training" and',
  '  anything else that is not a thing somebody can go and build are FORBIDDEN.',
  '- `title`: imperative, under 60 characters, e.g. "Auto-assign L3 escalations on transition".',
  '- `category`: use the opportunity\' `hint` unless it is plainly wrong for the action you wrote.',
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
  const results = [];

  teams.forEach((team) => {
    try {
      const outcome = generateInsightForScope_(team, force, voice);
      results.push({ scope: `TEAM:${team.team_key}`, status: outcome.skipped ? 'CACHED' : 'GENERATED' });
    } catch (err) {
      writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), '', [], [], 'FAILED', String(err), '');
      results.push({ scope: `TEAM:${team.team_key}`, status: 'FAILED', error: String(err) });
      notifyFailure_(`generateInsights failed for ${team.team_key}`, err);
    }
  });

  return { results: results, aiCalls: countGenerated_(results) };
}

function countGenerated_(results) {
  return results.filter(function (r) { return r.status === 'GENERATED'; }).length;
}

/**
 * Generates ONE scope on request. `scope` is 'TEAM:<key>', or 'ALL'/'ROLLUP:ALL' for every team.
 * Returns { scope, status: 'GENERATED' | 'CACHED' | 'FAILED', aiCalls } so the caller can show
 * honestly whether an AI request was actually spent.
 */
function generateInsightForScopeKey(scope, force, voice) {
  if (!scope || scope === 'ALL') return generateInsightsAllTeams(force, voice);

  // 'ROLLUP:ALL' used to be its own AI call: one blended paragraph over SE + DBA + DevOps. It was
  // dropped because a sentence true of all three teams at once is a sentence with nothing in it —
  // and it cost a request per generation to say it. The Overview now stacks the per-team cards, so
  // the key is kept only so an old bookmark or a cached client still generates something sensible.
  if (scope === 'ROLLUP:ALL') return generateInsightsAllTeams(force, voice);

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
    writeInsightCache_(`TEAM:${team.team_key}`, currentMonthLabel_(), '', [], [], 'FAILED', String(err), '');
    throw err;
  }
}

function generateInsightForScope_(team, force, voice) {
  const current = getTicketMetrics_({ team: team.team_key, range: 'month', period: currentMonthLabel_() });
  const previous = getTicketMetrics_({ team: team.team_key, range: 'month', period: previousMonthLabel_() });
  const currentAssignees = getAssigneeMetrics_({ team: team.team_key, range: 'month', period: currentMonthLabel_() }).assignees;
  const previousAssignees = getAssigneeMetrics_({ team: team.team_key, range: 'month', period: previousMonthLabel_() }).assignees;

  const outliers = detectOutliers_(team, currentAssignees, previousAssignees);
  const opportunities = detectOpportunities_(team, current, previous, currentAssignees);

  // The fingerprint covers exactly what the prompt will contain — nothing more. So one extra
  // ticket that doesn't move any of these rolled-up figures does NOT invalidate the insight, which
  // is the whole point: regenerating for every trivial data change is how a free tier evaporates.
  // `opportunities` is in here because a signal crossing its threshold changes the answer even
  // when the rounded headline metrics do not.
  const version = sourceVersion_({
    thisMonth: pickMetricsForPrompt_(current, team),
    lastMonth: pickMetricsForPrompt_(previous, team),
    flags: outliers,
    opportunities: opportunities,
    // See the rollup note: register is part of what makes an answer distinct.
    voice: normalizeVoiceMode_(voice),
  });

  if (!force && isInsightCurrent_(`TEAM:${team.team_key}`, currentMonthLabel_(), version)) {
    return { metrics: current, skipped: true };
  }

  // 'fast' tier: this is prose written around problems that detectOpportunities_ already found and
  // numbers Aggregation.gs already computed. It needs fluency and specificity, not analysis, so the
  // small model is still the right tool — the reasoning that would need 'deep' has been done in
  // JavaScript above, deliberately.
  const answer = callInsightModel_(
    buildInsightPrompt_(team, current, previous, outliers, opportunities),
    voicedSystemPrompt_(INSIGHT_FEATURE_INSTRUCTIONS, voice)
  );

  writeInsightCache_(
    `TEAM:${team.team_key}`, currentMonthLabel_(), answer.narrative, outliers,
    sanitizeRecommendations_(answer.recommendations, opportunities), 'SUCCESS', '', version
  );
  return { metrics: current, skipped: false };
}

/**
 * One AI request that returns both halves of an insight.
 *
 * Asking for JSON buys the structure the recommendations need, but it also adds a way to fail that
 * plain text did not have: a model that writes a perfectly good paragraph and then fumbles a brace
 * would take the whole insight down with it. So an unparseable response degrades to narrative-only
 * rather than throwing — the manager gets the summary they used to get, minus the new section,
 * which is strictly better than an error card. A genuinely failed request still throws from
 * callAiModel_ and is recorded as FAILED by the caller.
 */
function callInsightModel_(prompt, systemPrompt) {
  const raw = callAiModel_(prompt, { systemPrompt: systemPrompt, tier: 'fast', json: true, maxTokens: 1600 });
  const unfenced = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(unfenced);
  } catch (err) {
    return { narrative: unfenced, recommendations: [] };
  }
  return {
    narrative: String(parsed.narrative || '').trim() || unfenced,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
  };
}

/**
 * Drops any recommendation whose `signal` is not one of the codes we actually handed the model.
 *
 * This is the enforcement half of "never raise a problem that has no signal behind it" — the
 * prompt asks, this checks. Small models do sometimes add a fifth well-meaning suggestion drawn
 * from nothing, and an invented bottleneck presented next to four real ones is worse than a short
 * list: it spends a manager's credibility on work that fixes nothing.
 *
 * Also re-attaches the detector's own evidence string. The model is asked to restate the numbers
 * and usually does it well, but `evidence` is the line a reader trusts, so it comes from the code
 * that measured it, not from the model that read it.
 */
function sanitizeRecommendations_(recommendations, opportunities) {
  const byCode = {};
  (opportunities || []).forEach(function (o) { byCode[o.code] = o; });
  const seen = {};

  return (recommendations || [])
    .filter(function (r) {
      if (!r || !byCode[r.signal] || seen[r.signal]) return false;
      seen[r.signal] = true;
      return true;
    })
    .slice(0, 4)
    .map(function (r) {
      const source = byCode[r.signal];
      return {
        signal: r.signal,
        title: String(r.title || source.summary).trim().slice(0, 90),
        category: RECOMMENDATION_CATEGORIES.indexOf(String(r.category)) !== -1 ? String(r.category) : source.hint,
        evidence: source.evidence,
        action: String(r.action || '').trim(),
      };
    })
    .filter(function (r) { return r.action; });
}

const RECOMMENDATION_CATEGORIES = ['automation', 'process', 'systems', 'documentation'];

/**
 * Thresholds for detectOpportunities_, gathered here so the bar for "this is worth a manager's
 * attention" is one readable list rather than a dozen magic numbers buried in conditionals.
 *
 * They are deliberately not tight. A signal that fires every month for every team is noise, and
 * four noisy recommendations crowd out the one real one — the cap in the prompt means a spurious
 * signal does not just add a bad row, it evicts a good one.
 */
const OPPORTUNITY_THRESHOLDS = {
  intakeToResolvedRatio: 1.1,   // created / resolved-in-period
  queueShareOfLeadTime: 0.5,    // (lead - cycle) / lead
  escalationRate: 0.3,
  fcrRate: 0.6,                 // fires when BELOW this
  backlogAgingRate: 0.25,
  reasonConcentration: 0.3,     // top reason / all reasons
  onHoldPickupMinutes: 2880,    // 2 days sitting on hold before anyone picks it back up
  peerReviewWaitMinutes: 480,   // 8h — a review that waits longer than a working day
  loadImbalanceRatio: 2,        // busiest assignee / team median
  cycleTimeRegression: 0.15,    // month-on-month increase
  minRatedTickets: 20,          // below this a rate is noise, not a signal
  minReasonSample: 10,          // ditto for a breakdown concentration
};

/**
 * Deterministic detection of what this team should FIX — the input to the recommendations half of
 * an insight, and the exact counterpart to detectOutliers_ (who to look at) above.
 *
 * The model never gets to decide what the problems are. Handed a metrics blob and asked for
 * advice, a small model reliably produces plausible, well-written recommendations for problems the
 * team does not have; a manager cannot tell those apart from the real ones, and acting on one
 * costs a sprint. So every recommendation must trace back to an entry here, each of which is a
 * threshold crossed by a number Aggregation.gs already computed — and sanitizeRecommendations_
 * throws away anything that does not.
 *
 * `hint` names the CLASS of fix the signal implies, not the fix itself. Writing the actual
 * mechanism is the one part of this the model is genuinely better at than a lookup table would be,
 * so it stays the model's job and `hint` is overridable.
 *
 * ORDER IS LOAD-BEARING: the prompt caps the model at the first four, so this list runs roughly
 * from "costs the team the most time" down to "worth knowing". Team capability flags are honoured
 * throughout — only ST tracks peer review, FCR/escalation and holding reasons, so those signals
 * simply cannot fire for DBA or DevOps.
 */
function detectOpportunities_(team, current, previous, currentAssignees) {
  const found = [];
  const add = function (code, hint, summary, evidence) {
    found.push({ code: code, hint: hint, summary: summary, evidence: evidence });
  };

  const resolved = Number(current.ticketsResolvedInPeriod) || 0;
  const created = Number(current.ticketsCreated) || 0;
  const rated = resolved >= OPPORTUNITY_THRESHOLDS.minRatedTickets;

  // Intake outrunning throughput is first because it is the only signal that compounds: every
  // month it holds, the backlog it describes is bigger than the month before.
  if (created >= OPPORTUNITY_THRESHOLDS.minRatedTickets && resolved > 0 &&
      created / resolved > OPPORTUNITY_THRESHOLDS.intakeToResolvedRatio) {
    add('INTAKE_OUTPACES_RESOLUTION', 'process',
      'Intake is outrunning throughput',
      `${created} tickets created vs ${resolved} resolved this month — a net ${created - resolved} added to the queue.`);
  }

  if (team.has_peer_review_tracking && current.peerReviewWaitAvgMinutes !== null &&
      current.peerReviewWaitAvgMinutes > OPPORTUNITY_THRESHOLDS.peerReviewWaitMinutes) {
    add('PEER_REVIEW_WAIT_SLOW', 'automation',
      'Work is queueing in peer review',
      `Tickets wait an average of ${insightDuration_(current.peerReviewWaitAvgMinutes)} for a peer review to start.`);
  }

  if (current.onHoldAvgPickupMinutes !== null &&
      current.onHoldAvgPickupMinutes > OPPORTUNITY_THRESHOLDS.onHoldPickupMinutes) {
    add('ON_HOLD_PICKUP_SLOW', 'automation',
      'On-hold tickets are not being picked back up',
      `A ticket put on hold sits an average of ${insightDuration_(current.onHoldAvgPickupMinutes)} before anyone returns to it.`);
  }

  // A dominant hold reason is the strongest automation signal this dashboard produces: it names
  // one recurring dependency, and one dependency is something you can actually build around.
  if (team.has_holding_reason) {
    const hold = topShare_(current.holdingReasonBreakdown, 'reason');
    if (hold && hold.total >= OPPORTUNITY_THRESHOLDS.minReasonSample &&
        hold.share > OPPORTUNITY_THRESHOLDS.reasonConcentration) {
      add('HOLD_REASON_CONCENTRATION', 'systems',
        `Most holds are for one reason: ${hold.key}`,
        `"${hold.key}" accounts for ${hold.count} of ${hold.total} holds this month (${pct_(hold.share)}).`);
    }
  }

  if (team.has_fcr_escalation && rated && current.escalationRate !== null &&
      current.escalationRate > OPPORTUNITY_THRESHOLDS.escalationRate) {
    add('HIGH_ESCALATION', 'process',
      'Too much work is leaving the team',
      `${current.escalationCount} of ${resolved} resolved tickets escalated (${pct_(current.escalationRate)})${deltaClause_(previous.escalationRate, current.escalationRate)}.`);
  }

  if (team.has_fcr_escalation && rated && current.fcrRate !== null &&
      current.fcrRate < OPPORTUNITY_THRESHOLDS.fcrRate) {
    add('LOW_FCR', 'documentation',
      'First-contact resolution is low',
      `${current.fcrYesCount} of ${resolved} resolved tickets were first-contact resolutions (${pct_(current.fcrRate)})${deltaClause_(previous.fcrRate, current.fcrRate)}.`);
  }

  if (rated && current.backlogAgingRate !== null &&
      current.backlogAgingRate > OPPORTUNITY_THRESHOLDS.backlogAgingRate) {
    add('BACKLOG_AGING_HIGH', 'automation',
      'Due dates are being missed at scale',
      `${current.overdueCount} of ${resolved} tickets resolved this month closed after their due date (${pct_(current.backlogAgingRate)}).`);
  }

  // Lead minus cycle is only clean where the cycle ENDS at resolution. On ST the cycle ends at
  // peer review (see extractReviewCycleTimeRange_), so the remainder mixes pre-start queue with
  // everything after review and means nothing — hence the capability gate rather than a maths fix.
  if (!team.has_peer_review_tracking && current.leadTimeAvgMinutes && current.cycleTimeAvgMinutes) {
    const queueShare = (current.leadTimeAvgMinutes - current.cycleTimeAvgMinutes) / current.leadTimeAvgMinutes;
    if (queueShare > OPPORTUNITY_THRESHOLDS.queueShareOfLeadTime) {
      add('QUEUE_WAIT_DOMINATES', 'automation',
        'Tickets wait longer than they take',
        `${pct_(queueShare)} of the average ${insightDuration_(current.leadTimeAvgMinutes)} lead time is spent before work starts, not doing the work.`);
    }
  }

  if (current.cycleTimeAvgMinutes && previous.cycleTimeAvgMinutes) {
    const change = (current.cycleTimeAvgMinutes - previous.cycleTimeAvgMinutes) / previous.cycleTimeAvgMinutes;
    if (change > OPPORTUNITY_THRESHOLDS.cycleTimeRegression) {
      add('CYCLE_TIME_REGRESSION', 'process',
        'Cycle time got worse this month',
        `Average cycle time rose ${pct_(change)}, from ${insightDuration_(previous.cycleTimeAvgMinutes)} to ${insightDuration_(current.cycleTimeAvgMinutes)}.`);
    }
  }

  const volumes = (currentAssignees || []).map(function (a) { return a.ticketsAssigned; });
  if (volumes.length >= 3) {
    const busiest = Math.max.apply(null, volumes);
    const middle = median_(volumes);
    if (middle > 0 && busiest / middle >= OPPORTUNITY_THRESHOLDS.loadImbalanceRatio) {
      const top = (currentAssignees || []).find(function (a) { return a.ticketsAssigned === busiest; });
      add('LOAD_IMBALANCE', 'automation',
        'Work is landing unevenly across the team',
        `${top ? top.name : 'The busiest engineer'} holds ${busiest} tickets against a team median of ${middle}.`);
    }
  }

  // Rejections and cancellations are last not because they matter least, but because they are the
  // clearest evidence of a fixable intake problem and are usually a small enough count to wait a
  // month — they resurface as soon as something above them stops firing.
  const rejected = topShare_(current.rejectionCategoryBreakdown, 'category');
  if (rejected && rejected.total >= OPPORTUNITY_THRESHOLDS.minReasonSample &&
      rejected.share > OPPORTUNITY_THRESHOLDS.reasonConcentration) {
    add('REJECTION_CONCENTRATION', 'systems',
      `Most rejections share one cause: ${rejected.key}`,
      `"${rejected.key}" is ${rejected.count} of ${rejected.total} rejections this month (${pct_(rejected.share)}).`);
  }

  const cancelled = topShare_(current.cancellationReasonBreakdown, 'reason');
  if (cancelled && cancelled.total >= OPPORTUNITY_THRESHOLDS.minReasonSample &&
      cancelled.share > OPPORTUNITY_THRESHOLDS.reasonConcentration) {
    add('CANCELLATION_CONCENTRATION', 'systems',
      `Most cancellations share one cause: ${cancelled.key}`,
      `"${cancelled.key}" is ${cancelled.count} of ${cancelled.total} cancellations this month (${pct_(cancelled.share)}).`);
  }

  return found;
}

/** Largest entry of a countsToBreakdown_ list, with its share of the total. Null when empty. */
function topShare_(breakdown, keyName) {
  if (!breakdown || !breakdown.length) return null;
  const total = breakdown.reduce(function (sum, row) { return sum + (Number(row.count) || 0); }, 0);
  if (!total) return null;
  // countsToBreakdown_ already sorts descending, so the first row is the top one.
  const top = breakdown[0];
  return { key: String(top[keyName]), count: Number(top.count) || 0, total: total, share: (Number(top.count) || 0) / total };
}

/**
 * ", up from 24.1% last month" — or nothing at all when there is no comparable previous figure.
 * Kept out of the model's hands: a month-on-month direction is the single easiest thing for a
 * small model to state backwards, and it is stated inside evidence a reader is meant to trust.
 */
function deltaClause_(previousValue, currentValue) {
  if (previousValue === null || previousValue === undefined || currentValue === null) return '';
  if (Math.abs(currentValue - previousValue) < 0.005) return ', flat on last month';
  return `, ${currentValue > previousValue ? 'up from' : 'down from'} ${pct_(previousValue)} last month`;
}

/** Minutes as something a person reads at a glance. Coarse on purpose — these are averages. */
function insightDuration_(minutes) {
  const mins = Number(minutes);
  if (!isFinite(mins)) return 'n/a';
  if (mins < 90) return `${Math.round(mins)} minutes`;
  const hours = mins / 60;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
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

/**
 * True when a SUCCESSFUL insight already exists for this scope/period at this exact source version.
 *
 * period_label goes in as the string '2026-08' and comes back as a DATE: Sheets silently coerces
 * anything month-shaped on write. A raw String() of that is "Sat Aug 01 2026 00:00:00 GMT+0800..",
 * which never equals '2026-08' — so this check missed every single time and the source_version
 * mechanism, whose entire job is to keep a free tier alive, skipped nothing. Verified broken
 * 2026-08-25: two generations of identical data in a row both reported aiCalls: 3.
 * formatMonthCell_ (MetricsApi.gs) normalises both sides; do not compare these raw.
 */
function isInsightCurrent_(scopeKey, periodLabel, version) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  if (!sheet) return false;
  const row = sheetToObjects_(sheet).find(function (r) {
    return r.scope_key === scopeKey && formatMonthCell_(r.period_label) === String(periodLabel);
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
function buildInsightPrompt_(team, current, previous, outliers, opportunities) {
  const data = {
    team: team.team_name,
    period: current.period,
    thisMonth: pickMetricsForPrompt_(current, team),
    lastMonth: pickMetricsForPrompt_(previous, team),
    flaggedIndividuals: outliers,
    opportunities: opportunities,
  };

  return [
    'You are writing a monthly operations summary for an engineering manager preparing an MBR/QBR deck and performance evaluations.',
    'Use ONLY the numbers in the JSON data below - do not invent or estimate any number not present.',
    'Respond with a JSON object containing "narrative" and "recommendations", as specified above.',
    '',
    'The `opportunities` array is the complete list of problems this team has that are worth acting on.',
    'It was computed from the data, not guessed. Write one recommendation per entry, up to 4, and none for anything else.',
    '',
    'DATA:',
    JSON.stringify(data),
  ].join('\n');
}

/**
 * The metrics the model is allowed to see, filtered to the ones this team actually MEASURES.
 *
 * Untracked metrics arrive as null, and a model handed `"fcrRate": null` narrates it as zero:
 * observed 2026-08-25, where the DBA insight read "Escalation and backlog aging rates dropped to
 * zero" and "keeping FCR at 0" for a team that has never tracked either. Absent and zero are very
 * different claims to put in front of a manager, and the model cannot tell them apart — so an
 * absent metric is omitted from the payload entirely rather than sent as null.
 *
 * Dropping keys also shortens the prompt, and because this function's output IS the source_version
 * payload, a team's fingerprint no longer churns on fields it does not use.
 */
function pickMetricsForPrompt_(m, team) {
  const picked = {
    ticketVolume: m.ticketVolume,
    ticketsCreated: m.ticketsCreated,
    ticketsResolved: m.ticketsResolved,
    leadTimeAvgMinutes: m.leadTimeAvgMinutes,
    cycleTimeAvgMinutes: m.cycleTimeAvgMinutes,
    backlogAgingRate: m.backlogAgingRate,
  };
  // FCR and escalation are ST-only capabilities (see TEAMS_CONFIG.has_fcr_escalation).
  if (team && team.has_fcr_escalation) {
    picked.fcrRate = m.fcrRate;
    picked.escalationRate = m.escalationRate;
  }
  if (team && team.has_peer_review_tracking) {
    picked.peerReviewWaitAvgMinutes = m.peerReviewWaitAvgMinutes;
  }
  Object.keys(picked).forEach(function (k) {
    if (picked[k] === null || picked[k] === undefined) delete picked[k];
  });
  return picked;
}

function writeInsightCache_(scopeKey, periodLabel, narrative, flags, recommendations, status, errorMessage, sourceVersion) {
  const sheet = getManagerDataSpreadsheet_().getSheetByName('INSIGHTS_CACHE');
  // Self-heal: both columns arrived after this tab was first provisioned, and objectToSheetRow_
  // maps by header name — without the column the value would be silently dropped. For
  // source_version that quietly restores the regenerate-every-time behaviour it exists to prevent;
  // for recommendations_json it means the section renders empty on a card that generated fine.
  appendColumnIfMissing_(sheet, 'source_version');
  appendColumnIfMissing_(sheet, 'recommendations_json');
  const rows = sheetToObjects_(sheet);
  // Same Sheets date-coercion trap as isInsightCurrent_ — a raw === here never matched either, so
  // every generation APPENDED a row instead of updating one. getCachedInsight_ sorts by
  // generated_at and takes the newest, which is why the duplication stayed invisible.
  const existing = rows.find((r) => r.scope_key === scopeKey && formatMonthCell_(r.period_label) === periodLabel);
  const record = {
    scope_key: scopeKey,
    period_label: periodLabel,
    narrative_text: narrative || '',
    flags_json: JSON.stringify(flags || []),
    recommendations_json: JSON.stringify(recommendations || []),
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
