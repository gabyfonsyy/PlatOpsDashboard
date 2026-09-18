import { getSupabaseClient } from "@/lib/supabase";

/**
 * Business Review Prep's own persisted state: the Review Prep checklist and Talking Points.
 * Everything else on the page (metrics, driver breakdowns, AI narrative) is computed/cached
 * elsewhere (lib/business-review.ts, lib/work-store.ts's generic ai_insight_cache pair) — this
 * file is only what Gaby herself authors during prep, mirroring lib/work-store.ts's shape and
 * error-handling posture (throw on write failure, scope every mutation to `user_email`).
 */

export type ChecklistState = Record<string, boolean>;

export type TalkingPoint = {
  id: string;
  content: string;
  position: number;
};

/** Missing table (migration not yet run) degrades to "nothing checked" rather than throwing —
 * mirrors my-work/page.tsx's own `needsSetup` guard for the same situation. */
export async function getChecklistState(email: string, periodKey: string): Promise<ChecklistState> {
  const { data, error } = await getSupabaseClient()
    .from("business_review_checklist_state")
    .select("item_key,checked")
    .eq("user_email", email)
    .eq("period_key", periodKey);
  if (error || !data) return {};
  const state: ChecklistState = {};
  for (const row of data as { item_key: string; checked: boolean }[]) state[row.item_key] = row.checked;
  return state;
}

export async function setChecklistItem(email: string, periodKey: string, itemKey: string, checked: boolean): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("business_review_checklist_state")
    .upsert(
      { user_email: email, period_key: periodKey, item_key: itemKey, checked, updated_at: new Date().toISOString() },
      { onConflict: "user_email,period_key,item_key" }
    );
  if (error) throw new Error(`Could not update checklist item: ${error.message}`);
}

export async function getTalkingPoints(email: string, periodKey: string): Promise<TalkingPoint[]> {
  const { data, error } = await getSupabaseClient()
    .from("business_review_talking_points")
    .select("id,content,position")
    .eq("user_email", email)
    .eq("period_key", periodKey)
    .order("position", { ascending: true });
  if (error || !data) return [];
  return data as TalkingPoint[];
}

export async function addTalkingPoint(email: string, periodKey: string, content: string, position: number): Promise<TalkingPoint> {
  const { data, error } = await getSupabaseClient()
    .from("business_review_talking_points")
    .insert({ user_email: email, period_key: periodKey, content, position })
    .select("id,content,position")
    .single();
  if (error || !data) throw new Error(`Could not add talking point: ${error?.message ?? "unknown error"}`);
  return data as TalkingPoint;
}

export async function updateTalkingPoint(email: string, id: string, content: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("business_review_talking_points")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_email", email);
  if (error) throw new Error(`Could not update talking point: ${error.message}`);
}

export async function deleteTalkingPoint(email: string, id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("business_review_talking_points")
    .delete()
    .eq("id", id)
    .eq("user_email", email);
  if (error) throw new Error(`Could not delete talking point: ${error.message}`);
}

/**
 * Seeds default talking points (one per top-ranked metric's insight sentence) ONLY when this
 * period has none yet — never overwrites what she's already edited. Called once per period by
 * lib/business-review.ts, after the metric comparisons and their insights are computed.
 */
export async function seedTalkingPointsIfEmpty(email: string, periodKey: string, seeds: string[]): Promise<void> {
  const existing = await getTalkingPoints(email, periodKey);
  if (existing.length > 0) return;
  for (let i = 0; i < seeds.length; i++) {
    await addTalkingPoint(email, periodKey, seeds[i], i);
  }
}
