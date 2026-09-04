const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
const GAS_API_KEY = process.env.GAS_API_KEY;

type GasEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export class GasApiError extends Error {}

function buildGasUrl(route: string, params: Record<string, string | undefined> = {}) {
  if (!GAS_WEB_APP_URL) throw new GasApiError("GAS_WEB_APP_URL is not configured");
  if (!GAS_API_KEY) throw new GasApiError("GAS_API_KEY is not configured");
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("route", route);
  // Apps Script Web Apps cannot read custom request headers (doGet/doPost only see
  // query params + POST body), so the shared secret travels as a query param instead
  // of an X-Api-Key header. This call is always server-side, so it never reaches the browser.
  url.searchParams.set("apiKey", GAS_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  // Google's edge has been observed caching a GET Web App response keyed on the exact request
  // URL — confirmed live on `site-monitoring` (no other params, so every call was byte-identical):
  // a redeployed code fix kept returning the pre-fix response until a differing URL broke the
  // cache. `cache: "no-store"` on the fetch() call only controls Next.js's own cache, not this.
  // A route with naturally-varying params (team, date range, ...) mostly dodges it by accident;
  // this closes it for every route, varying or not.
  url.searchParams.set("_", Date.now().toString());
  return url.toString();
}

export async function fetchGas<T>(
  route: string,
  params: Record<string, string | undefined> = {},
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(buildGasUrl(route, params), init);
  if (!res.ok) throw new GasApiError(`GAS request failed with HTTP ${res.status}`);
  const body = (await res.json()) as GasEnvelope<T>;
  if (!body.ok) throw new GasApiError(body.error);
  return body.data;
}

/** Server-only: for writes (create/update/delete) proxied from /api/gas/* route handlers. */
export async function postGas<T>(
  route: string,
  action: "create" | "update" | "delete",
  payload: Record<string, unknown>,
  id?: string
): Promise<T> {
  return fetchGas<T>(route, { action, id }, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}
