import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { setDayMark } from "@/lib/work-store";
import { DAY_TYPES, type DayType } from "@/lib/work";

/**
 * POST /api/work/day-mark — { work_date, day_type: "Holiday" | "Leave" | null, note? }
 *
 * Marks a day as one that should not be counted, or clears the mark with day_type: null. One
 * endpoint for both directions because it is a single toggle in the UI, and splitting it into
 * POST/DELETE would mean the client picking a verb from the state it is trying to change.
 */
function invalidDate(value: unknown): string | null {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `Invalid date: ${raw}`;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const ok = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  return ok ? null : `Invalid date: ${raw}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const workDate = String(body.work_date ?? "").trim();
    const bad = invalidDate(workDate);
    if (bad) throw new Error(bad);

    const raw = body.day_type;
    // null and "" both mean "clear it" — the UI sends "" from a <select>, null from a toggle off.
    const dayType: DayType | null =
      raw === null || raw === undefined || raw === ""
        ? null
        : DAY_TYPES.includes(String(raw) as DayType)
          ? (String(raw) as DayType)
          : (() => {
              throw new Error(`Invalid day type: ${String(raw)}`);
            })();

    const mark = await setDayMark(email, workDate, dayType, (body.note as string) ?? null);
    revalidatePath("/my-work");
    return { work_date: workDate, mark };
  });
}
