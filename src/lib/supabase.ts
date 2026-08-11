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
