import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import {
  createReference,
  deleteReference,
  moveReference,
  updateReference,
  REFERENCE_TYPES,
} from "@/lib/references-store";

/** A url worth calling "not a link" — the field is free text on the server, but the form asks. */
function invalidUrl(value: string): boolean {
  return !/^https?:\/\/\S+/i.test(value);
}

function invalidReferenceType(value: unknown): boolean {
  return !(REFERENCE_TYPES as readonly string[]).includes(String(value));
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const title = String(body.title ?? "").trim();
    const url = String(body.url ?? "").trim();
    if (!title) throw new Error("A reference needs a title.");
    if (!url || invalidUrl(url)) throw new Error("A reference needs a valid http(s) URL.");
    if (body.reference_type !== undefined && invalidReferenceType(body.reference_type)) {
      throw new Error(`reference_type must be one of: ${REFERENCE_TYPES.join(", ")}`);
    }
    const reference = await createReference(email, {
      title,
      url,
      description: body.description !== undefined ? String(body.description) : null,
      reference_type: body.reference_type !== undefined ? String(body.reference_type) : undefined,
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
    if (body.reference_type !== undefined && invalidReferenceType(body.reference_type)) {
      throw new Error(`reference_type must be one of: ${REFERENCE_TYPES.join(", ")}`);
    }
    const patch: { title?: string; url?: string; description?: string | null; reference_type?: string } = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.url !== undefined) patch.url = String(body.url);
    if (body.description !== undefined) patch.description = body.description === null ? null : String(body.description);
    if (body.reference_type !== undefined) patch.reference_type = String(body.reference_type);
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
