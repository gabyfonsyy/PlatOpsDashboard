import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createType, renameType, deleteType, moveType } from "@/lib/references-taxonomy-store";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("A type needs a name.");
    const type = await createType(email, name);
    revalidatePath("/references");
    return type;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.type_id ?? "").trim();
    if (!id) throw new Error("type_id is required.");

    if (body.move !== undefined) {
      if (body.move !== "up" && body.move !== "down") throw new Error('move must be "up" or "down".');
      const types = await moveType(email, id, body.move);
      revalidatePath("/references");
      return types;
    }

    if (body.name === undefined || !String(body.name).trim()) throw new Error("A type needs a name.");
    const type = await renameType(email, id, String(body.name));
    revalidatePath("/references");
    return type;
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.type_id ?? "").trim();
    if (!id) throw new Error("type_id is required.");
    const result = await deleteType(email, id);
    revalidatePath("/references");
    return { type_id: id, deleted: true, ...result };
  });
}
