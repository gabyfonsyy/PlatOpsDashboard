import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle, ValidationError } from "@/lib/work-route";
import { addTalkingPoint, updateTalkingPoint, deleteTalkingPoint, getTalkingPoints } from "@/lib/business-review-store";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const periodKey = String(body.period_key ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!periodKey) throw new ValidationError("period_key is required.");
    if (!content) throw new ValidationError("A talking point needs some text.");
    const existing = await getTalkingPoints(email, periodKey);
    const point = await addTalkingPoint(email, periodKey, content, existing.length);
    revalidatePath("/my-work/business-review-prep");
    return point;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.id ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!id) throw new ValidationError("id is required.");
    if (!content) throw new ValidationError("A talking point needs some text.");
    await updateTalkingPoint(email, id, content);
    revalidatePath("/my-work/business-review-prep");
    return { id, content };
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.id ?? "").trim();
    if (!id) throw new ValidationError("id is required.");
    await deleteTalkingPoint(email, id);
    revalidatePath("/my-work/business-review-prep");
    return { id, deleted: true };
  });
}
