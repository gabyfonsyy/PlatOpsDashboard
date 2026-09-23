/**
 * Web App entry points. Apps Script Web Apps cannot read custom HTTP request headers
 * (doGet/doPost only expose query params + POST body) — so unlike a normal REST API,
 * the shared secret travels as an `apiKey` query param, not an `X-Api-Key` header.
 * The Next.js gas-client.ts appends it to every request URL server-side; it never
 * reaches the browser.
 *
 * Every response is HTTP 200 with a { ok, data } / { ok: false, error } envelope —
 * Apps Script Web Apps cannot reliably set arbitrary status codes.
 */

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

/**
 * Hashes both sides before comparing, so a timing difference can't leak how many of the raw
 * secret's leading bytes an attacker's guess matched — a plain `!==` short-circuits on the first
 * mismatched character, which is exactly what a timing side-channel attack measures. This is the
 * one gate the whole GAS backend relies on (found via a full-codebase security audit), so it gets
 * the constant-time treatment even though Apps Script's own network jitter already makes the
 * attack impractical in practice — defense-in-depth, not a response to a live exploit.
 */
function timingSafeEqual_(a, b) {
  const digestA = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(a));
  const digestB = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(b));
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) {
    diff |= digestA[i] ^ digestB[i];
  }
  return diff === 0;
}

function handleRequest_(e, method) {
  try {
    assertConfigured_();
    const params = (e && e.parameter) || {};

    if (!timingSafeEqual_(params.apiKey, getScriptProperty_('API_SHARED_SECRET'))) {
      return jsonResponse_({ ok: false, error: 'Unauthorized' });
    }

    const route = params.route;
    const body = parsePostBody_(e);

    switch (route) {
      case 'teams':
        return jsonResponse_({ ok: true, data: getActiveTeamsConfig_() });

      case 'roster':
        return jsonResponse_({ ok: true, data: RosterApi.list(params) });

      case 'leave':
        return jsonResponse_({ ok: true, data: dispatchCrud_(method, params, body, LeaveApi) });

      case 'rto':
        if (params.action === 'bulkUpsert') return jsonResponse_({ ok: true, data: RtoApi.bulkUpsert(body) });
        return jsonResponse_({ ok: true, data: dispatchCrud_(method, params, body, RtoApi) });

      // 'projects', 'project-progress', 'project-tasks', and 'ticket-projects' (list side) were
      // removed here 2026-09-22 — Records -> Project Tracking moved onto Supabase (see
      // src/lib/project-tracking-store.ts, gas/SupabaseMigration.gs's migrateProjectsToSupabase
      // et al.), so nothing in the Next.js app reads/writes these GAS routes anymore.
      // ProjectsApi.gs/ProgressApi.gs/TasksApi.gs/TicketProjectApi.gs were deleted outright.
      // 'initiatives' keeps only its sync action below — GAS is still the only thing that can
      // talk to Jira, so the live ticket pull stays here, now writing straight to Supabase.

      case 'initiatives':
        if (params.action === 'sync') return jsonResponse_({ ok: true, data: InitiativesApi.sync() });
        return jsonResponse_({ ok: false, error: `Unknown action for initiatives: ${params.action}` });

      case 'incidents':
        // Non-CRUD actions are checked before dispatchCrud_ (which only knows create/update/delete)
        // — same shape as 'rto' + bulkUpsert above.
        if (params.action === 'sync') return jsonResponse_({ ok: true, data: IncidentsApi.sync(params) });
        if (params.action === 'setValidator') return jsonResponse_({ ok: true, data: IncidentsApi.setValidator(body) });
        // Deletes an incident TICKET (and its logs), and clears Report Tagging in Jira so the sync
        // cannot hand it back. Not dispatchCrud_'s 'delete', which targets an incident LOG by id.
        if (params.action === 'removeTicket') return jsonResponse_({ ok: true, data: IncidentsApi.removeTicket(body) });
        return jsonResponse_({ ok: true, data: dispatchCrud_(method, params, body, IncidentsApi) });

      case 'insight':
        // READ ONLY — never generates. Every page that shows an insight uses this, so a page view
        // costs zero AI requests no matter how often it's loaded.
        return jsonResponse_({ ok: true, data: getCachedInsight_(params.scope) });

      case 'generate-insight':
        // The ONLY path that can spend an AI request on a narrative insight, and it exists solely
        // to be called from an explicit button press. force=true bypasses the source-version check.
        return jsonResponse_({
          ok: true,
          data: generateInsightForScopeKey(params.scope, String(params.force) === 'true', params.voice),
        });

      case 'refresh-cache':
        return jsonResponse_({ ok: true, data: invalidateAllCaches_() });

      case 'site-monitoring':
        return jsonResponse_({ ok: true, data: SiteMonitoringApi.list() });

      // Phase 5 of the Sheets -> Supabase migration: 'metrics', 'assignee-metrics',
      // 'backlog-aging-report', 'lead-cycle-time-report', 'late-pickup-report',
      // 'peer-review-wait-report', and 'tool-assisted-cycle-time' were removed here — Phase 4
      // moved every one of those reads to query Supabase directly (src/lib/*.ts), so nothing in
      // the Next.js app calls them anymore. MetricsApi.gs is still live (Insights.gs calls it for
      // AI narrative generation); the other five implementations (BacklogAgingApi.gs,
      // LeadCycleTimeApi.gs, LatePickupApi.gs, PeerReviewApi.gs, ToolAssistedApi.gs) were verified
      // fully unreachable end-to-end via a full-codebase audit and deleted outright rather than
      // left as dead weight.

      default:
        return jsonResponse_({ ok: false, error: `Unknown route: ${route}` });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** GET -> list (via .list(params)); POST -> action=create|update|delete (via matching method). */
function dispatchCrud_(method, params, body, api) {
  if (method === 'GET') return api.list(params);
  if (params.action === 'create') return api.create(body);
  if (params.action === 'update') return api.update(params.id, body);
  if (params.action === 'delete') return api.remove(params.id);
  throw new Error(`Unknown action for POST: ${params.action}`);
}

function parsePostBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('Invalid JSON body');
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
