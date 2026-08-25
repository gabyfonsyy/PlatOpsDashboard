import { cookies } from "next/headers";
import { handle } from "@/lib/work-route";
import { getOverview } from "@/lib/overview";
import { getBriefing } from "@/lib/overview-ai";
import { THEME_COOKIE } from "@/lib/theme";
import { viewForView } from "@/lib/overview-view";

/**
 * GET /api/overview/summary — the condensed Overview, for the quick-peek panel.
 *
 * READ ONLY, and never generates. The panel is a glance from another page: spending an AI request
 * because someone opened a popup would break the once-a-day contract the assessment is built on,
 * and would do it invisibly. If today's snapshot does not exist yet, the panel says so and points
 * at the Overview, where opening the page is what asks for one.
 *
 * Fetched on demand rather than server-rendered into the layout, so a button nobody presses costs
 * nothing. Every other page would otherwise pay for a full cross-module read on every navigation.
 */
export async function GET() {
  return handle(async (email) => {
    const view = viewForView(cookies().get(THEME_COOKIE)?.value);
    const data = await getOverview(email);
    const briefing = await getBriefing(email, data.today, view.voice);

    return {
      view: view.view,
      today: data.today,
      headline: briefing?.headline ?? "",
      generatedAt: briefing?.generatedAt ?? null,
      // Only what the panel renders. Sending the whole OverviewData would make this the second
      // place that decides what the Overview means, which is exactly the duplication the
      // aggregation layer exists to avoid.
      attention: data.attention.slice(0, 4).map((a) => ({
        id: a.id,
        priority: a.priority,
        title: a.title,
        action: a.action,
        href: a.href,
      })),
      priorityAttention: (briefing?.priorityAttention ?? []).map((p) => ({
        title: p.title,
        urgency: p.urgency,
        action: p.action,
      })),
      recommendedFocus: briefing?.recommendedFocus ?? [],
      stable: [...data.stable.map((s) => s.text), ...(briefing?.noIntervention ?? [])].slice(0, 4),
      myDay: {
        openTasks: data.myDay.openTasks,
        doneToday: data.myDay.doneToday,
        overdueCount: data.myDay.overdueCount,
        workdayOpen: data.myDay.workdayOpen,
      },
    };
  });
}
