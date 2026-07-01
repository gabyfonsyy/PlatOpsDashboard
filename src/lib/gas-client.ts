const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
const GAS_API_KEY = process.env.GAS_API_KEY;

type GasEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export class GasApiError extends Error {}

function buildGasUrl(route: string, params: Record<string, string | undefined> = {}) {
  if (!GAS_WEB_APP_URL) throw new GasApiError("GAS_WEB_APP_URL is not configured");
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set("route", route);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Server-only: reads never expose GAS_API_KEY to the browser. */
export async function fetchGas<T>(
  route: string,
  params: Record<string, string | undefined> = {},
  init: RequestInit = {}
): Promise<T> {
  if (!GAS_API_KEY) throw new GasApiError("GAS_API_KEY is not configured");
  const res = await fetch(buildGasUrl(route, params), {
    ...init,
    headers: { "X-Api-Key": GAS_API_KEY, ...(init.headers ?? {}) },
  });
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
