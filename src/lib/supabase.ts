import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export class SupabaseConfigError extends Error {}

/**
 * Server-only client using the service_role key, which bypasses RLS. Every table in
 * supabase/schema.sql has RLS enabled with no policies, so this is deliberately the only
 * way in — never expose SUPABASE_SERVICE_ROLE_KEY to the browser or create an anon-key client.
 */
function buildClient() {
  if (!SUPABASE_URL) throw new SupabaseConfigError("SUPABASE_URL is not configured");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new SupabaseConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Typed off buildClient rather than annotated as ReturnType<typeof createClient>: spelling that
 * annotation out drops createClient's generic defaults, and every caller's row types collapse to
 * `never` — which type-checks as a cascade of unrelated errors in the report libs.
 */
let client: ReturnType<typeof buildClient> | null = null;

export function getSupabaseClient() {
  // Built once per process rather than per call. It is stateless here — persistSession is off and
  // there is no per-user auth on it — so nothing leaks between requests, and one Overview render
  // alone was constructing dozens of these.
  if (!client) client = buildClient();
  return client;
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

/**
 * Same contract as fetchAllRows, but requests every page CONCURRENTLY instead of walking them
 * sequentially — for N pages that's one round trip's latency instead of N. Worth it once a query
 * is likely to span more than a page or two (a ticket-level query over a quarter/year easily hits
 * several thousand rows); ported from lib/lead-cycle-time.ts's fetchSpanRowsParallel, which measured
 * the sequential walk at 9-12s of pure latency on the overview's year range before this existed.
 *
 * `build` returns the base filtered query with `head` toggling between a `count: "exact", head:
 * true` request (to learn the total row count up front — one extra round trip, cheap next to
 * saving N-1 sequential ones once N is more than 2 or so) and the real row-fetching request each
 * page is built from.
 *
 * `orderColumns` MUST make the result set uniquely ordered — a single-column primary key
 * (`"issue_key"`), or, for a table with no such column (e.g. metrics_daily's composite
 * team_key/issue_type/date key), every column of a composite key that is unique together
 * (`["team_key", "issue_type", "date"]`). PostgREST .range() offsets are only stable under a
 * deterministic sort, and without one, concurrent page requests can overlap or skip rows outright
 * (the same hazard fetchAllRows' docstring warns about for the sequential walk; concurrent
 * requests make it worse, not better).
 */
export async function fetchAllRowsParallel<T>(
  // `any` rather than a typed PostgrestFilterBuilder: callers build this via conditional re-chaining
  // (.eq()/.not()/.or() based on optional filters), which widens supabase-js's builder generics
  // until TS reports "type instantiation is excessively deep" — same reasoning as the `any` casts
  // in lib/lead-cycle-time.ts and lib/automated-tickets.ts. Rows are cast to T by every caller.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (head: boolean) => any,
  orderColumns: string | string[]
): Promise<T[]> {
  const { count, error: countError } = await build(true);
  if (countError) throw new Error(`Supabase count failed: ${countError.message}`);
  const total = count ?? 0;
  if (total === 0) return [];

  const columns = Array.isArray(orderColumns) ? orderColumns : [orderColumns];
  const pageCount = Math.ceil(total / SUPABASE_MAX_ROWS_PER_REQUEST);
  const pages: { data: T[] | null; error: { message: string } | null }[] = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * SUPABASE_MAX_ROWS_PER_REQUEST;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = build(false);
      for (const col of columns) q = q.order(col);
      return q.range(from, from + SUPABASE_MAX_ROWS_PER_REQUEST - 1);
    })
  );
  const all: T[] = [];
  for (const { data, error } of pages) {
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    all.push(...(data ?? []));
  }
  return all;
}
