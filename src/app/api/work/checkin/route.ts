import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { saveCheckin } from "@/lib/work-store";
import { DAY_FACTORS, MOODS } from "@/lib/work";

/** POST /api/work/checkin — body { mood, factors?, note? }. Upserts today's single check-in. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const mood = String(body.mood ?? "");
    if (!MOODS.some((m) => m.code === mood)) throw new Error(`Invalid mood: ${mood}`);

    // Unknown factor codes are dropped rather than rejected: the vocabulary will grow, and a
    // stale client sending one retired code shouldn't lose the whole check-in.
    const allowed = new Set(DAY_FACTORS.map((f) => f.code as string));
    const factors = Array.isArray(body.factors)
      ? (body.factors as unknown[]).map(String).filter((f) => allowed.has(f))
      : [];

    const checkin = await saveCheckin(email, {
      mood,
      factors,
      note: String(body.note ?? "").trim() || undefined,
    });
    revalidatePath("/my-work");
    return checkin;
  });
}
