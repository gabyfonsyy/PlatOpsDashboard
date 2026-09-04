import { getSupabaseClient } from "@/lib/supabase";

/**
 * Server-only data access for References — a personal dumping ground for links (Sheets, Docs,
 * random websites) with a title and a quick description. Same posture as work-store.ts: every
 * function takes the caller's email from the session, never from the client, so one person's
 * list can't be read or written by passing someone else's address.
 */

export const REFERENCE_TYPES = ["Google Sheet", "Google Doc", "Website", "Other"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export type WorkReference = {
  reference_id: string;
  user_email: string;
  title: string;
  url: string;
  description: string | null;
  reference_type: ReferenceType;
  display_order: number;
  created_at: string;
  updated_at: string;
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

export async function getReferences(email: string): Promise<WorkReference[]> {
  const { data, error } = await getSupabaseClient()
    .from("work_references")
    .select("*")
    .eq("user_email", email)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (isMissingTable(error)) throw new Error("needs-setup");
  if (error) throw new Error(`Could not load references: ${error.message}`);
  return (data ?? []) as WorkReference[];
}

export async function createReference(
  email: string,
  input: { title: string; url: string; description?: string | null; reference_type?: string }
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

  const { data, error } = await supabase
    .from("work_references")
    .insert({
      user_email: email,
      title: input.title.trim(),
      url: input.url.trim(),
      description: input.description?.trim() || null,
      reference_type: input.reference_type ?? "Other",
      display_order: nextOrder,
    })
    .select("*")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not add reference: ${error.message}`);
  return data as WorkReference;
}

export async function updateReference(
  email: string,
  referenceId: string,
  patch: { title?: string; url?: string; description?: string | null; reference_type?: string }
): Promise<WorkReference> {
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.url !== undefined) next.url = patch.url.trim();
  if (patch.description !== undefined) next.description = patch.description?.trim() || null;
  if (patch.reference_type !== undefined) next.reference_type = patch.reference_type;

  const { data, error } = await getSupabaseClient()
    .from("work_references")
    .update(next)
    .eq("reference_id", referenceId)
    .eq("user_email", email)
    .select("*")
    .single();
  assertSetup(error);
  if (error) throw new Error(`Could not update reference: ${error.message}`);
  return data as WorkReference;
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
 * Swaps a reference's display_order with its neighbor in the given direction. Two updates rather
 * than a single query — the list is small per user, and this keeps the write as plain as every
 * other one here rather than reaching for a stored procedure for a rare, single-user action.
 */
export async function moveReference(
  email: string,
  referenceId: string,
  direction: "up" | "down"
): Promise<WorkReference[]> {
  const ordered = await getReferences(email);
  const index = ordered.findIndex((r) => r.reference_id === referenceId);
  if (index === -1) throw new Error("Reference not found.");
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) return ordered;

  const current = ordered[index];
  const neighbor = ordered[neighborIndex];
  const supabase = getSupabaseClient();
  const [a, b] = await Promise.all([
    supabase.from("work_references").update({ display_order: neighbor.display_order }).eq("reference_id", current.reference_id).eq("user_email", email),
    supabase.from("work_references").update({ display_order: current.display_order }).eq("reference_id", neighbor.reference_id).eq("user_email", email),
  ]);
  if (a.error) throw new Error(`Could not reorder: ${a.error.message}`);
  if (b.error) throw new Error(`Could not reorder: ${b.error.message}`);

  return getReferences(email);
}
