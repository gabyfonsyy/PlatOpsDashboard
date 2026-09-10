import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createReference, deleteReference, moveReference, updateReference } from "@/lib/references-store";
import { getReferenceCategories, getReferenceTypes } from "@/lib/references-taxonomy-store";

/** A url worth calling "not a link" — the field is free text on the server, but the form asks. */
function invalidUrl(value: string): boolean {
  return !/^https?:\/\/\S+/i.test(value);
}

/** Confirms a category_id/type_id the client sent actually belongs to this user, rather than
 * trusting an arbitrary uuid (which — since these tables have no RLS policies, service_role only
 * — would otherwise let one user's reference silently point at another user's category row). */
async function ownedCategoryId(email: string, categoryId: unknown): Promise<string> {
  const id = String(categoryId ?? "").trim();
  const categories = await getReferenceCategories(email);
  if (!categories.some((c) => c.category_id === id)) throw new Error("That category doesn't exist.");
  return id;
}

async function ownedTypeId(email: string, typeId: unknown): Promise<string> {
  const id = String(typeId ?? "").trim();
  const types = await getReferenceTypes(email);
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

    const categoryId = body.category_id !== undefined ? await ownedCategoryId(email, body.category_id) : undefined;
    const typeId = body.type_id !== undefined ? await ownedTypeId(email, body.type_id) : undefined;

    const reference = await createReference(email, {
      title,
      url,
      description: body.description !== undefined ? String(body.description) : null,
      category_id: categoryId,
      type_id: typeId,
    });
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
    if (body.category_id !== undefined) patch.category_id = await ownedCategoryId(email, body.category_id);
    if (body.type_id !== undefined) patch.type_id = await ownedTypeId(email, body.type_id);
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
    const reference = await updateReference(email, id, patch);
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
