import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createReference, deleteReference, moveReference, updateReference } from "@/lib/references-store";
import {
  getReferenceCategories,
  getReferenceTypes,
  type ReferenceCategory,
  type ReferenceTypeRow,
} from "@/lib/references-taxonomy-store";

/** A url worth calling "not a link" — the field is free text on the server, but the form asks. */
function invalidUrl(value: string): boolean {
  return !/^https?:\/\/\S+/i.test(value);
}

/** Confirms a category_id/type_id the client sent actually belongs to this user, rather than
 * trusting an arbitrary uuid (which — since these tables have no RLS policies, service_role only
 * — would otherwise let one user's reference silently point at another user's category row).
 * Takes the already-fetched list rather than fetching its own, so callers that need both the
 * ownership check AND the full list (to hand to createReference/updateReference, skipping a
 * second redundant fetch inside attachTaxonomy) only pay for one round trip each. */
function ownedCategoryId(categories: ReferenceCategory[], categoryId: unknown): string {
  const id = String(categoryId ?? "").trim();
  if (!categories.some((c) => c.category_id === id)) throw new Error("That category doesn't exist.");
  return id;
}

function ownedTypeId(types: ReferenceTypeRow[], typeId: unknown): string {
  const id = String(typeId ?? "").trim();
  if (!types.some((t) => t.type_id === id)) throw new Error("That type doesn't exist.");
  return id;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const title = String(body.title ?? "").trim();
    const url = String(body.url ?? "").trim();
    if (!title) throw new Error("A reference needs a title.");
    if (!url || invalidUrl(url)) throw new Error("A reference needs a valid http(s) URL.");

    let taxonomy: { categories: ReferenceCategory[]; types: ReferenceTypeRow[] } | undefined;
    let categoryId: string | undefined;
    let typeId: string | undefined;
    if (body.category_id !== undefined || body.type_id !== undefined) {
      const [categories, types] = await Promise.all([getReferenceCategories(email), getReferenceTypes(email)]);
      taxonomy = { categories, types };
      if (body.category_id !== undefined) categoryId = ownedCategoryId(categories, body.category_id);
      if (body.type_id !== undefined) typeId = ownedTypeId(types, body.type_id);
    }

    const reference = await createReference(
      email,
      {
        title,
        url,
        description: body.description !== undefined ? String(body.description) : null,
        category_id: categoryId,
        type_id: typeId,
      },
      taxonomy
    );
    revalidatePath("/references");
    return reference;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.reference_id ?? "").trim();
    if (!id) throw new Error("reference_id is required.");

    // Reordering is a separate, narrower action from editing fields — see moveReference.
    if (body.move !== undefined) {
      if (body.move !== "up" && body.move !== "down") throw new Error('move must be "up" or "down".');
      const references = await moveReference(email, id, body.move);
      revalidatePath("/references");
      return references;
    }

    if (body.title !== undefined && !String(body.title).trim()) throw new Error("A reference needs a title.");
    if (body.url !== undefined && invalidUrl(String(body.url).trim())) {
      throw new Error("A reference needs a valid http(s) URL.");
    }

    const patch: { title?: string; url?: string; description?: string | null; category_id?: string; type_id?: string } = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.url !== undefined) patch.url = String(body.url);
    if (body.description !== undefined) patch.description = body.description === null ? null : String(body.description);

    let taxonomy: { categories: ReferenceCategory[]; types: ReferenceTypeRow[] } | undefined;
    if (body.category_id !== undefined || body.type_id !== undefined) {
      const [categories, types] = await Promise.all([getReferenceCategories(email), getReferenceTypes(email)]);
      taxonomy = { categories, types };
      if (body.category_id !== undefined) patch.category_id = ownedCategoryId(categories, body.category_id);
      if (body.type_id !== undefined) patch.type_id = ownedTypeId(types, body.type_id);
    }
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
    const reference = await updateReference(email, id, patch, taxonomy);
    revalidatePath("/references");
    return reference;
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.reference_id ?? "").trim();
    if (!id) throw new Error("reference_id is required.");
    await deleteReference(email, id);
    revalidatePath("/references");
    return { reference_id: id, deleted: true };
  });
}
