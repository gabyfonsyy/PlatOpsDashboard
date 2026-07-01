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

function handleRequest_(e, method) {
  try {
    assertConfigured_();
    const params = (e && e.parameter) || {};

    if (params.apiKey !== getScriptProperty_('API_SHARED_SECRET')) {
      return jsonResponse_({ ok: false, error: 'Unauthorized' });
    }

    const route = params.route;
    const body = parsePostBody_(e);

    switch (route) {
      case 'teams':
        return jsonResponse_({ ok: true, data: getActiveTeamsConfig_() });

      case 'leave':
        return jsonResponse_({ ok: true, data: dispatchCrud_(method, params, body, LeaveApi) });

      case 'rto':
        return jsonResponse_({ ok: true, data: dispatchCrud_(method, params, body, RtoApi) });

      case 'projects':
        return jsonResponse_({ ok: true, data: dispatchCrud_(method, params, body, ProjectsApi) });

      case 'metrics':
        return jsonResponse_({ ok: true, data: getTicketMetrics_(params) });

      case 'assignee-metrics':
        return jsonResponse_({ ok: true, data: getAssigneeMetrics_(params) });

      case 'insight':
        return jsonResponse_({ ok: true, data: getCachedInsight_(params.scope) });

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
