/**
 * The backend's single AI provider: open-weight models hosted on Groq, reached over the
 * OpenAI-compatible /chat/completions endpoint. Replaces the inline Gemini REST calls that
 * used to live in Insights.gs — one provider, one key (AI_API_KEY), one retry policy.
 *
 * Why a separate file rather than a helper inside Insights.gs: the narrative insights job is
 * no longer the only AI caller (see IncidentsApi.gs's category/severity assist), and the
 * Next.js side calls the same provider through src/lib/ai.ts. Keeping the prompt-building in
 * the feature files and the transport here means a model or provider swap is a one-file change.
 *
 * Model is read from the optional AI_MODEL script property so it can be re-pointed without a
 * redeploy; AI_DEFAULT_MODEL is the fallback. Both are open-weight models — nothing here is
 * Gemini/GPT-specific beyond the request shape, which Groq, OpenRouter, and vLLM all speak.
 */

const AI_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Two tiers, because most of what this backend asks for is easy.
 *
 *   fast — gpt-oss 20B. Writing prose around numbers that are already computed, rewriting a
 *          sentence, picking labels from a fixed list. Cheaper and quicker, and on a free tier
 *          that difference is the difference between having the feature and rationing it.
 *   deep — gpt-oss 120B. Reserved for genuine multi-variable reasoning. Measured 2026-08-25: on a
 *          bare prompt the 120B invented an escalation percentage that was not in the data and the
 *          20B did not, so 'deep' buys reasoning, not obedience — keep the no-invented-numbers rule
 *          in the prompt regardless of tier.
 *
 * Reaching for the big model by default is the expensive habit; pick the tier per task instead.
 * Confirm both ids are still served before relying on them — Groq retires model ids periodically,
 * and a retired id fails with a non-retryable HTTP 404 rather than silently falling back. *
 * RETIRED 2026-08-25: Groq dropped both Llama ids (`llama-3.1-8b-instant`, `llama-3.3-70b-versatile`)
 * and they now 404 as model_not_found, which is non-retryable — every AI feature was dead until this
 * was repointed. Replaced with OpenAI's open-weight gpt-oss pair, verified served to this key on
 * 2026-08-25 and verified to honour response_format json_object. Note gpt-oss returns its chain of
 * thought in a separate `reasoning` field and the answer in `content`, so reading `message.content`
 * stays correct — do not start concatenating `reasoning` into the result.
 */
const AI_MODELS = {
  fast: 'openai/gpt-oss-20b',
  deep: 'openai/gpt-oss-120b',
};

const AI_DEFAULT_MODEL = AI_MODELS.fast;

const AI_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const AI_MAX_RETRIES = 3;

/** An explicit AI_MODEL script property overrides every tier — an escape hatch for a retired id. */
function getAiModel_(tier) {
  const override = PropertiesService.getScriptProperties().getProperty('AI_MODEL');
  if (override) return override;
  return AI_MODELS[tier] || AI_DEFAULT_MODEL;
}

/**
 * Sends one chat completion and returns the assistant's text, trimmed.
 *
 * options:
 *   systemPrompt   — optional system role message (defaults to none)
 *   temperature    — defaults to 0.3: these are reporting/eval surfaces, so repeatable
 *                    phrasing matters more than variety
 *   maxTokens      — defaults to 1024
 *   json           — true to request a JSON object back (response_format json_object). The
 *                    prompt must still say "respond with JSON" or the provider rejects it.
 *   tier           — 'fast' (default) or 'deep'. See AI_MODELS.
 *
 * Throws on a non-retryable error or after AI_MAX_RETRIES, same as jiraFetchWithRetry_ —
 * callers (generateInsightsAllTeams) are expected to catch and record the failure rather
 * than let a bad AI run take down the whole trigger.
 */
function callAiModel_(prompt, options) {
  const opts = options || {};
  const messages = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const payload = {
    model: getAiModel_(opts.tier),
    messages: messages,
    temperature: opts.temperature === undefined ? 0.3 : opts.temperature,
    max_tokens: opts.maxTokens || 1024,
  };
  if (opts.json) payload.response_format = { type: 'json_object' };

  const requestOptions = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${getScriptProperty_('AI_API_KEY')}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  let lastErrorMessage;

  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(AI_API_URL, requestOptions);
    const code = response.getResponseCode();

    if (code >= 200 && code < 300) {
      const json = JSON.parse(response.getContentText());
      const choice = json.choices && json.choices[0];
      const text = choice && choice.message ? choice.message.content : '';
      return String(text || '').trim();
    }

    lastErrorMessage = `AI request failed (HTTP ${code}): ${response.getContentText().slice(0, 300)}`;
    if (AI_RETRYABLE_STATUS_CODES.indexOf(code) !== -1 && attempt < AI_MAX_RETRIES) {
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    break;
  }

  throw new Error(lastErrorMessage);
}

/**
 * callAiModel_ with json:true, parsed. Models occasionally wrap JSON in a ```json fence even
 * with response_format set, so the fence is stripped before parsing rather than letting a
 * cosmetic wrapper surface as a hard failure.
 */
function callAiModelJson_(prompt, options) {
  const raw = callAiModel_(prompt, Object.assign({}, options, { json: true }));
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch (err) {
    throw new Error(`AI returned unparseable JSON: ${unfenced.slice(0, 300)}`);
  }
}
