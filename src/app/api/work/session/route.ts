import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { endWorkday, startWorkday } from "@/lib/work-store";

/** POST /api/work/session — body { action: "start" | "end" }. One click, no form. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = body.action === "end" ? "end" : "start";
  return handle(async (email) => {
    const session = action === "end" ? await endWorkday(email) : await startWorkday(email);
    revalidatePath("/my-work");
    return { action, session };
  });
}
