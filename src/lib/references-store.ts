import { getSupabaseClient } from "@/lib/supabase";
import { getReferenceCategories, getReferenceTypes, type ReferenceCategory, type ReferenceTypeRow } from "@/lib/references-taxonomy-store";

/**
 * Server-only data access for References — a personal dumping ground for links (Sheets, Docs,
 * random websites) with a title and a quick description. Same posture as work-store.ts: every
 * function takes the caller's email from the session, never from the client, so one person's
 * list can't be read or written by passing someone else's address.
 *
 * 2026-09-11: gained an independent Category + Type taxonomy (references-taxonomy-store.ts).
 * `reference_type` (the old 4-value free-text enum) is now legacy — still stored, still has its
 * DB default, but no longer written by createReference/updateReference and no longer the display
 * source; `type_id`/`category` below replaced it. Kept only as the one-time migration source (see
 * attachTaxonomy) so pre-existing rows land on the matching new Type by name instead of "Other".
 */

export const REFERENCE_TYPES = ["Google Sheet", "Google Doc", "Website", "Other"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export type WorkReference = {
  reference_id: string;
  user_email: string;
  title: string;
  url: string;
  description: string | null;
  /** Legacy — see file doc comment. Not shown in the UI anymore. */
  reference_type: ReferenceType;
  category_id: string | null;
  type_id: string | null;
  /** Denormalized for display — null only when the taxonomy tables aren't set up yet. */
  category: { category_id: string; name: string } | null;
  type: { type_id: string; name: string } | null;
  display_order: number;
  created_at: string;
  updated_at: string;
};

type RawReferenceRow = Omit<WorkReference, "category_id" | "type_id" | "category" | "type"> & {
  category_id?: string | null;
  type_id?: string | null;
};

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = error.message ?? "";
  return /relation .* does not exist/i.test(message) || /could not find the table/i.test(message);
}

/** Shared by every write path so a pre-migration click gets the instruction, not a cache error. */
function assertSetup(error: { code?: string; message?: string } | null): void {
  if (isMissingTable(error)) {
    throw new Error("References isn't set up yet — run supabase/references.sql in the Supabase SQL editor.");
  }
}

/**
 * Attaches category/type display objects to raw rows, and — on a user's first load after she
 * runs references-taxonomy.sql — backfills any row missing a valid category_id/type_id: category
 * falls back to Uncategorized, type resolves by matching the row's legacy `reference_type` name
 * (so existing Google Sheet/Google Doc/etc. references land on the SAME type, not "Other") with
 * "Other" as the last resort. If the taxonomy tables don't exist yet at all, references are
 * returned exactly as before this feature — no category/type, no errors, no backfill attempted.
 */
async function attachTaxonomy(email: string, rows: RawReferenceRow[]): Promise<WorkReference[]> {
  const [categories, types] = await Promise.all([
    getReferenceCategories(email).catch(() => null as ReferenceCategory[] | null),
    getReferenceTypes(email).catch(() => null as ReferenceTypeRow[] | null),
  ]);

  if (!categories || !types) {
    return rows.map((r) => ({ ...r, category_id: null, type_id: null, category: null, type: null }));
  }

  const categoryById = new Map(categories.map((c) => [c.category_id, c]));
  const typeById = new Map(types.map((t) => [t.type_id, t]));
  const typeByName = new Map(types.map((t) => [t.name, t]));
  const fallbackCategory = categories.find((c) => c.is_fallback) ?? categories[0];
  const fallbackType = types.find((t) => t.is_fallback) ?? types[0];

  const supabase = getSupabaseClient();
  const backfills: PromiseLike<unknown>[] = [];

  const resolved: WorkReference[] = rows.map((r) => {
    let categoryId = r.category_id ?? null;
    if (!categoryId || !categoryById.has(categoryId)) {
      categoryId = fallbackCategory.category_id;
      backfills.push(
        supabase.from("work_references").update({ category_id: categoryId }).eq("reference_id", r.reference_id).eq("user_email", email)
      );
    }

    let typeId = r.type_id ?? null;
    if (!typeId || !typeById.has(typeId)) {
      typeId = (typeByName.get(r.reference_type) ?? fallbackType).type_id;
      backfills.push(
        supabase.from("work_references").update({ type_id: typeId }).eq("reference_id", r.reference_id).eq("user_email", email)
      );
    }

    const category = categoryById.get(categoryId);
    const type = typeById.get(typeId);
    return {
      ...r,
      category_id: categoryId,
      type_id: typeId,
      category: category ? { category_id: category.category_id, name: category.name } : null,
      type: type ? { type_id: type.type_id, name: type.name } : null,
    };
  });

  if (backfills.length > 0) await Promise.all(backfills);
  return resolved;
}

export async function getReferences(email: string): Promise<WorkReference[]> {
  const { data, error } = await getSupabaseClient()
    .from("work_references")
    .select("*")
    .eq("user_email", email)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (isMissingTable(error)) throw new Error("needs-setup");
  if (error) throw new Error(`Could not load references: ${error.message}`);
  return attachTaxonomy(email, (data ?? []) as RawReferenceRow[]);
}

export async function createReference(
  email: string,
  input: { title: string; url: string; description?: string | null; category_id?: string | null; type_id?: string | null }
): Promise<WorkReference> {
  const supabase = getSupabaseClient();
  // New references land at the end of the list — max + 1, not count(), so a gap left by a
  // deleted reference never gets reused and collide with an existing order.
  const { data: last, error: maxError } = await supabase
    .from("work_references")
    .select("display_order")
    .eq("user_email", email)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertSetup(maxError);
  if (maxError) throw new Error(`Could not add reference: ${maxError.message}`);
  const nextOrder = ((last as { display_order: number } | null)?.display_order ?? -1) + 1;

  let categoryId = input.category_id ?? null;
  let typeId = input.type_id ?? null;
  if (!categoryId || !typeId) {
    const [categories, types] = await Promise.all([getReferenceCategories(email), getReferenceTypes(email)]);
    if (!categoryId) categoryId = (categories.find((c) => c.is_fallback) ?? categories[0]).category_id;
    if (!typeId) typeId = (types.find((t) => t.is_fallback) ?? types[0]).type_id;
  }

  const { data, error } = await supabase
    .from("work_references")
    .insert({
      user_email: email,
      title: input.title.trim(),
      url: input.url.trim(),
      description: input.description?.trim() || null,
      category_id: categoryId,
      type_id: typeId,
      display_order: nextOrder,
    })
    .select("*")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not add reference: ${error.message}`);
  return (await attachTaxonomy(email, [data as RawReferenceRow]))[0];
}

export async function updateReference(
  email: string,
  referenceId: string,
  patch: { title?: string; url?: string; description?: string | null; category_id?: string | null; type_id?: string | null }
): Promise<WorkReference> {
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.url !== undefined) next.url = patch.url.trim();
  if (patch.description !== undefined) next.description = patch.description?.trim() || null;
  if (patch.category_id !== undefined) next.category_id = patch.category_id;
  if (patch.type_id !== undefined) next.type_id = patch.type_id;

  const { data, error } = await getSupabaseClient()
    .from("work_references")
    .update(next)
    .eq("reference_id", referenceId)
    .eq("user_email", email)
    .select("*")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not update reference: ${error.message}`);
  return (await attachTaxonomy(email, [data as RawReferenceRow]))[0];
}

export async function deleteReference(email: string, referenceId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("work_references")
    .delete()
    .eq("reference_id", referenceId)
    .eq("user_email", email);
  if (error) throw new Error(`Could not delete reference: ${error.message}`);
}

/**
 * Swaps a reference's display_order with its neighbor in the given direction, SCOPED TO ITS OWN
 * CATEGORY — the page now renders one section per category, so "move up" has to mean "within
 * this section," not the nearest reference in global display_order regardless of which category
 * section it actually renders in (display_order is one global per-user sequence; two references
 * from different categories can be numerically adjacent without being visually adjacent at all).
 * Two updates rather than a single query — the list is small per user, and this keeps the write
 * as plain as every other one here rather than reaching for a stored procedure for a rare,
 * single-user action.
 */
export async function moveReference(
  email: string,
  referenceId: string,
  direction: "up" | "down"
): Promise<WorkReference[]> {
  const ordered = await getReferences(email);
  const current = ordered.find((r) => r.reference_id === referenceId);
  if (!current) throw new Error("Reference not found.");
  const sameCategory = ordered.filter((r) => r.category_id === current.category_id);
  const index = sameCategory.findIndex((r) => r.reference_id === referenceId);
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sameCategory.length) return ordered;

  const neighbor = sameCategory[neighborIndex];
  const supabase = getSupabaseClient();
  const [a, b] = await Promise.all([
    supabase.from("work_references").update({ display_order: neighbor.display_order }).eq("reference_id", current.reference_id).eq("user_email", email),
    supabase.from("work_references").update({ display_order: current.display_order }).eq("reference_id", neighbor.reference_id).eq("user_email", email),
  ]);
  if (a.error) throw new Error(`Could not reorder: ${a.error.message}`);
  if (b.error) throw new Error(`Could not reorder: ${b.error.message}`);

  return getReferences(email);
}
