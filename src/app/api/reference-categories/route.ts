import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createCategory, renameCategory, deleteCategory, moveCategory } from "@/lib/references-taxonomy-store";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("A category needs a name.");
    const category = await createCategory(email, name);
    revalidatePath("/references");
    return category;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.category_id ?? "").trim();
    if (!id) throw new Error("category_id is required.");

    if (body.move !== undefined) {
      if (body.move !== "up" && body.move !== "down") throw new Error('move must be "up" or "down".');
      const categories = await moveCategory(email, id, body.move);
      revalidatePath("/references");
      return categories;
    }

    if (body.name === undefined || !String(body.name).trim()) throw new Error("A category needs a name.");
    const category = await renameCategory(email, id, String(body.name));
    revalidatePath("/references");
    return category;
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.category_id ?? "").trim();
    if (!id) throw new Error("category_id is required.");
    const result = await deleteCategory(email, id);
    revalidatePath("/references");
    return { category_id: id, deleted: true, ...result };
  });
}
