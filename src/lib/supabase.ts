import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export class SupabaseConfigError extends Error {}

/**
 * Server-only client using the service_role key, which bypasses RLS. Every table in
 * supabase/schema.sql has RLS enabled with no policies, so this is deliberately the only
 * way in — never expose SUPABASE_SERVICE_ROLE_KEY to the browser or create an anon-key client.
 */
export function getSupabaseClient() {
  if (!SUPABASE_URL) throw new SupabaseConfigError("SUPABASE_URL is not configured");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new SupabaseConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

const SUPABASE_MAX_ROWS_PER_REQUEST = 1000;

/**
 * PostgREST caps every response at 1000 rows by default, silently — a plain .select() with no
 * .range() just returns the first 1000 matches with no error, even if far more rows match.
 * Confirmed live: a query for ST's ~7,557 tickets created in 2026 returned exactly 1000. Every
 * lib/*.ts report that queries `tickets` for a real team/period combination needs this instead
 * of trusting a single request to return everything, or high-volume teams/periods silently get
 * truncated (and non-deterministically so — Postgres has no guaranteed row order without an
 * explicit ORDER BY, so which 1000 rows come back can vary request to request).
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildPage(from, from + SUPABASE_MAX_ROWS_PER_REQUEST - 1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < SUPABASE_MAX_ROWS_PER_REQUEST) break;
    from += SUPABASE_MAX_ROWS_PER_REQUEST;
  }
  return all;
}
