import { getSupabaseClient } from "@/lib/supabase";

/**
 * Server-only data access for References' Category + Type taxonomy — see
 * supabase/references-taxonomy.sql for the schema. Same posture as references-store.ts: every
 * function takes the caller's email from the session, never the client, and every table is
 * per-user (personal, not team, data — confirmed with her 2026-09-11).
 *
 * Category = how she organizes references ("People Management", "SE Stuff", ...), fully
 * user-managed, starts empty except for one seeded "Uncategorized" fallback.
 * Type = what kind of resource it is. Starts seeded with the four values References already had
 * (Google Sheet/Google Doc/Website/Other) so migration preserves them exactly, then is fully
 * user-managed from there.
 */

export type ReferenceCategory = {
  category_id: string;
  user_email: string;
  name: string;
  sort_order: number;
  is_fallback: boolean;
  created_at: string;
  updated_at: string;
};

export type ReferenceTypeRow = {
  type_id: string;
  user_email: string;
  name: string;
  sort_order: number;
  is_fallback: boolean;
  created_at: string;
  updated_at: string;
};

export const FALLBACK_CATEGORY_NAME = "Uncategorized";
export const FALLBACK_TYPE_NAME = "Other";
/** The exact four values References already had — preserved by construction on first seed. */
const DEFAULT_TYPE_NAMES = ["Google Sheet", "Google Doc", "Website", "Other"] as const;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = error.message ?? "";
  return /relation .* does not exist/i.test(message) || /could not find the table/i.test(message);
}

// =====================================================================================
// Categories
// =====================================================================================

export async function getReferenceCategories(email: string): Promise<ReferenceCategory[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reference_categories")
    .select("*")
    .eq("user_email", email)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (isMissingTable(error)) throw new Error("needs-setup");
  if (error) throw new Error(`Could not load categories: ${error.message}`);

  const categories = (data ?? []) as ReferenceCategory[];
  if (categories.length > 0) return categories;

  // First visit for this user: seed the one protected fallback category.
  const { data: seeded, error: seedError } = await supabase
    .from("reference_categories")
    .insert({ user_email: email, name: FALLBACK_CATEGORY_NAME, sort_order: 0, is_fallback: true })
    .select("*")
    .single();
  if (seedError) throw new Error(`Could not set up categories: ${seedError.message}`);
  return [seeded as ReferenceCategory];
}

export async function createCategory(email: string, name: string): Promise<ReferenceCategory> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A category needs a name.");
  const supabase = getSupabaseClient();
  const { data: last } = await supabase
    .from("reference_categories")
    .select("sort_order")
    .eq("user_email", email)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("reference_categories")
    .insert({ user_email: email, name: trimmed, sort_order: nextOrder, is_fallback: false })
    .select("*")
    .single();
  if (isMissingTable(error)) throw new Error("needs-setup");
  if (error) {
    if (error.code === "23505") throw new Error(`A category named “${trimmed}” already exists.`);
    throw new Error(`Could not add category: ${error.message}`);
  }
  return data as ReferenceCategory;
}

export async function renameCategory(email: string, categoryId: string, name: string): Promise<ReferenceCategory> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A category needs a name.");
  const { data, error } = await getSupabaseClient()
    .from("reference_categories")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("category_id", categoryId)
    .eq("user_email", email)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`A category named “${trimmed}” already exists.`);
    throw new Error(`Could not rename category: ${error.message}`);
  }
  return data as ReferenceCategory;
}

/**
 * Refuses on the protected fallback row. Otherwise reassigns every reference currently pointing
 * at this category to the user's Uncategorized category first, then deletes it — a category is
 * never removed while references still point at it.
 */
export async function deleteCategory(email: string, categoryId: string): Promise<{ reassignedCount: number }> {
  const supabase = getSupabaseClient();
  const { data: target, error: fetchError } = await supabase
    .from("reference_categories")
    .select("category_id, is_fallback")
    .eq("category_id", categoryId)
    .eq("user_email", email)
    .maybeSingle();
  if (fetchError) throw new Error(`Could not delete category: ${fetchError.message}`);
  if (!target) throw new Error("Category not found.");
  if ((target as { is_fallback: boolean }).is_fallback) {
    throw new Error(`“${FALLBACK_CATEGORY_NAME}” is the fallback category and can't be deleted.`);
  }

  const categories = await getReferenceCategories(email);
  const fallback = categories.find((c) => c.is_fallback);
  if (!fallback) throw new Error("Could not find the Uncategorized fallback — try reloading.");

  const { data: affected, error: reassignError } = await supabase
    .from("work_references")
    .update({ category_id: fallback.category_id, updated_at: new Date().toISOString() })
    .eq("category_id", categoryId)
    .eq("user_email", email)
    .select("reference_id");
  if (reassignError) throw new Error(`Could not reassign references: ${reassignError.message}`);

  const { error: deleteError } = await supabase
    .from("reference_categories")
    .delete()
    .eq("category_id", categoryId)
    .eq("user_email", email);
  if (deleteError) throw new Error(`Could not delete category: ${deleteError.message}`);

  return { reassignedCount: (affected ?? []).length };
}

export async function moveCategory(email: string, categoryId: string, direction: "up" | "down"): Promise<ReferenceCategory[]> {
  const ordered = await getReferenceCategories(email);
  const index = ordered.findIndex((c) => c.category_id === categoryId);
  if (index === -1) throw new Error("Category not found.");
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) return ordered;

  const current = ordered[index];
  const neighbor = ordered[neighborIndex];
  const supabase = getSupabaseClient();
  const [a, b] = await Promise.all([
    supabase.from("reference_categories").update({ sort_order: neighbor.sort_order }).eq("category_id", current.category_id).eq("user_email", email),
    supabase.from("reference_categories").update({ sort_order: current.sort_order }).eq("category_id", neighbor.category_id).eq("user_email", email),
  ]);
  if (a.error) throw new Error(`Could not reorder: ${a.error.message}`);
  if (b.error) throw new Error(`Could not reorder: ${b.error.message}`);
  return getReferenceCategories(email);
}

// =====================================================================================
// Types
// =====================================================================================

export async function getReferenceTypes(email: string): Promise<ReferenceTypeRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reference_types")
    .select("*")
    .eq("user_email", email)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (isMissingTable(error)) throw new Error("needs-setup");
  if (error) throw new Error(`Could not load types: ${error.message}`);

  const types = (data ?? []) as ReferenceTypeRow[];
  if (types.length > 0) return types;

  // First visit for this user: seed the exact four values References already had.
  const rows = DEFAULT_TYPE_NAMES.map((name, i) => ({
    user_email: email,
    name,
    sort_order: i,
    is_fallback: name === FALLBACK_TYPE_NAME,
  }));
  const { data: seeded, error: seedError } = await supabase.from("reference_types").insert(rows).select("*");
  if (seedError) throw new Error(`Could not set up types: ${seedError.message}`);
  return (seeded ?? []) as ReferenceTypeRow[];
}

export async function createType(email: string, name: string): Promise<ReferenceTypeRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A type needs a name.");
  const supabase = getSupabaseClient();
  const { data: last } = await supabase
    .from("reference_types")
    .select("sort_order")
    .eq("user_email", email)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("reference_types")
    .insert({ user_email: email, name: trimmed, sort_order: nextOrder, is_fallback: false })
    .select("*")
    .single();
  if (isMissingTable(error)) throw new Error("needs-setup");
  if (error) {
    if (error.code === "23505") throw new Error(`A type named “${trimmed}” already exists.`);
    throw new Error(`Could not add type: ${error.message}`);
  }
  return data as ReferenceTypeRow;
}

export async function renameType(email: string, typeId: string, name: string): Promise<ReferenceTypeRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A type needs a name.");
  const { data, error } = await getSupabaseClient()
    .from("reference_types")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("type_id", typeId)
    .eq("user_email", email)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`A type named “${trimmed}” already exists.`);
    throw new Error(`Could not rename type: ${error.message}`);
  }
  return data as ReferenceTypeRow;
}

/** Same shape as deleteCategory, against the "Other" fallback instead of "Uncategorized". */
export async function deleteType(email: string, typeId: string): Promise<{ reassignedCount: number }> {
  const supabase = getSupabaseClient();
  const { data: target, error: fetchError } = await supabase
    .from("reference_types")
    .select("type_id, is_fallback")
    .eq("type_id", typeId)
    .eq("user_email", email)
    .maybeSingle();
  if (fetchError) throw new Error(`Could not delete type: ${fetchError.message}`);
  if (!target) throw new Error("Type not found.");
  if ((target as { is_fallback: boolean }).is_fallback) {
    throw new Error(`“${FALLBACK_TYPE_NAME}” is the fallback type and can't be deleted.`);
  }

  const types = await getReferenceTypes(email);
  const fallback = types.find((t) => t.is_fallback);
  if (!fallback) throw new Error("Could not find the Other fallback — try reloading.");

  const { data: affected, error: reassignError } = await supabase
    .from("work_references")
    .update({ type_id: fallback.type_id, updated_at: new Date().toISOString() })
    .eq("type_id", typeId)
    .eq("user_email", email)
    .select("reference_id");
  if (reassignError) throw new Error(`Could not reassign references: ${reassignError.message}`);

  const { error: deleteError } = await supabase
    .from("reference_types")
    .delete()
    .eq("type_id", typeId)
    .eq("user_email", email);
  if (deleteError) throw new Error(`Could not delete type: ${deleteError.message}`);

  return { reassignedCount: (affected ?? []).length };
}

export async function moveType(email: string, typeId: string, direction: "up" | "down"): Promise<ReferenceTypeRow[]> {
  const ordered = await getReferenceTypes(email);
  const index = ordered.findIndex((t) => t.type_id === typeId);
  if (index === -1) throw new Error("Type not found.");
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) return ordered;

  const current = ordered[index];
  const neighbor = ordered[neighborIndex];
  const supabase = getSupabaseClient();
  const [a, b] = await Promise.all([
    supabase.from("reference_types").update({ sort_order: neighbor.sort_order }).eq("type_id", current.type_id).eq("user_email", email),
    supabase.from("reference_types").update({ sort_order: current.sort_order }).eq("type_id", neighbor.type_id).eq("user_email", email),
  ]);
  if (a.error) throw new Error(`Could not reorder: ${a.error.message}`);
  if (b.error) throw new Error(`Could not reorder: ${b.error.message}`);
  return getReferenceTypes(email);
}
