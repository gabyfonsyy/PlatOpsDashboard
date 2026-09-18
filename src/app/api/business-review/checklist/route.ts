import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle, ValidationError } from "@/lib/work-route";
import { setChecklistItem } from "@/lib/business-review-store";

/** PATCH /api/business-review/checklist — toggle one Review Prep checklist item for one period. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const periodKey = String(body.period_key ?? "").trim();
    const itemKey = String(body.item_key ?? "").trim();
    if (!periodKey || !itemKey) throw new ValidationError("period_key and item_key are required.");
    const checked = Boolean(body.checked);
    await setChecklistItem(email, periodKey, itemKey, checked);
    revalidatePath("/my-work/business-review-prep");
    return { period_key: periodKey, item_key: itemKey, checked };
  });
}
